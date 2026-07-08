/**
 * Gmail Blast — send email blasts directly from the user's personal Gmail account
 *
 * OAuth flow:
 *   GET  /api/gmail/auth        → redirects to Google consent screen
 *   GET  /api/gmail/callback    → stores tokens, redirects to frontend
 *
 * Blast:
 *   GET  /api/gmail/status      → { connected: bool, email: string|null }
 *   POST /api/gmail/blast       → send emails to selected contacts
 *   DELETE /api/gmail/disconnect → clear stored tokens
 */

import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import prisma from '../db';
import { requireAuth } from './auth';

const router = Router();
const db = prisma as any;

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://propeldialer.com';
const BACKEND_URL  = process.env.BACKEND_URL  || 'https://propel-dialer-backend.onrender.com';

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BACKEND_URL}/api/gmail/callback`,
  );
}

// ── GET /api/gmail/auth ───────────────────────────────────────────────────────
// Starts OAuth. Encodes userId in state param so callback can identify user.
router.get('/auth', requireAuth, (req: any, res: Response) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',               // always get refresh token
    scope: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state: req.user.id,              // passed back in callback
  });
  res.redirect(url);
});

// ── GET /api/gmail/callback ───────────────────────────────────────────────────
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state: userId, error } = req.query as Record<string, string>;

  if (error || !code || !userId) {
    return res.redirect(`${FRONTEND_URL}?gmailError=access_denied`);
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get the Gmail address for this account
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    await db.user.update({
      where: { id: userId },
      data: {
        gmailAccessToken:  tokens.access_token,
        gmailRefreshToken: tokens.refresh_token || undefined,
        gmailEmail:        userInfo.email,
        gmailTokenExpiry:  tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      },
    });

    res.redirect(`${FRONTEND_URL}?gmailConnected=true`);
  } catch (e: any) {
    console.error('[Gmail] callback error:', e.message);
    res.redirect(`${FRONTEND_URL}?gmailError=callback_failed`);
  }
});

// ── GET /api/gmail/status ─────────────────────────────────────────────────────
router.get('/status', requireAuth, async (req: any, res: Response) => {
  const user = await db.user.findUnique({ where: { id: req.user.id } });
  res.json({
    connected: !!user?.gmailAccessToken,
    email:     user?.gmailEmail || null,
  });
});

// ── DELETE /api/gmail/disconnect ──────────────────────────────────────────────
router.delete('/disconnect', requireAuth, async (req: any, res: Response) => {
  await db.user.update({
    where: { id: req.user.id },
    data: { gmailAccessToken: null, gmailRefreshToken: null, gmailEmail: null, gmailTokenExpiry: null },
  });
  res.json({ ok: true });
});

// ── POST /api/gmail/blast ─────────────────────────────────────────────────────
// Body: { subject: string, body: string, contactIds?: string[], group?: string, allContacts?: bool }
router.post('/blast', requireAuth, async (req: any, res: Response) => {
  try {
    const user = await db.user.findUnique({ where: { id: req.user.id } });

    if (!user?.gmailAccessToken) {
      res.status(400).json({ error: 'Gmail not connected. Connect your Gmail account first.' });
      return;
    }

    const { subject, body, contactIds, group, allContacts } = req.body;
    if (!subject?.trim() || !body?.trim()) {
      res.status(400).json({ error: 'Subject and message body are required.' });
      return;
    }

    // Build recipient list
    let where: any = { NOT: { email: null }, email: { not: '' } };
    if (!allContacts) {
      if (group)       where.contactGroup = group;
      if (contactIds?.length) where.id = { in: contactIds };
    }

    const contacts = await db.contact.findMany({
      where,
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const withEmail = contacts.filter((c: any) => c.email?.includes('@'));
    if (withEmail.length === 0) {
      res.status(400).json({ error: 'No contacts with valid email addresses found.' });
      return;
    }

    // Set up Gmail client with token refresh
    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({
      access_token:  user.gmailAccessToken,
      refresh_token: user.gmailRefreshToken,
    });

    // Auto-refresh token if expired
    oauth2Client.on('tokens', async (newTokens: any) => {
      await db.user.update({
        where: { id: user.id },
        data: {
          gmailAccessToken: newTokens.access_token || user.gmailAccessToken,
          gmailTokenExpiry: newTokens.expiry_date ? new Date(newTokens.expiry_date) : undefined,
          ...(newTokens.refresh_token ? { gmailRefreshToken: newTokens.refresh_token } : {}),
        },
      });
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    const errorDetails: { email: string; reason: string }[] = [];

    // Build From header — avoid leading space when name is empty
    const fromName = (user.name || '').trim();
    const fromHeader = fromName
      ? `"${fromName}" <${user.gmailEmail}>`
      : `<${user.gmailEmail}>`;

    // Send one at a time with a short delay to stay within Gmail rate limits
    for (const contact of withEmail) {
      try {
        // Personalize body — replace {{firstName}} token
        const personalizedBody = body
          .replace(/\{\{firstName\}\}/gi, contact.firstName || 'there')
          .replace(/\{\{lastName\}\}/gi, contact.lastName || '')
          .replace(/\{\{fullName\}\}/gi, `${contact.firstName} ${contact.lastName}`.trim());

        const htmlBody = buildEmailHtml(personalizedBody, fromName || user.gmailEmail);

        const personalizedSubject = subject
          .replace(/\{\{firstName\}\}/gi, contact.firstName || 'there')
          .replace(/\{\{lastName\}\}/gi, contact.lastName || '')
          .replace(/\{\{fullName\}\}/gi, `${contact.firstName} ${contact.lastName}`.trim());

        const raw = buildRawMessage({
          from:    fromHeader,
          to:      contact.email!,
          subject: personalizedSubject,
          html:    htmlBody,
        });

        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw },
        });

        sent++;
      } catch (e: any) {
        const reason = e?.response?.data?.error?.message || e?.message || 'Unknown error';
        console.error(`[Gmail] Failed to send to ${contact.email}:`, reason);
        errors.push(contact.email!);
        errorDetails.push({ email: contact.email!, reason });
        failed++;
      }

      // 350ms delay between sends — stays well within Gmail's rate limit
      await delay(350);
    }

    res.json({ ok: true, sent, failed, total: withEmail.length, errors, errorDetails });
  } catch (e: any) {
    console.error('[Gmail] blast error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Build a base64url-encoded RFC 2822 email message */
function buildRawMessage({ from, to, subject, html }: {
  from: string; to: string; subject: string; html: string;
}): string {
  const boundary = `boundary_${Date.now()}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    html.replace(/<[^>]+>/g, '').replace(/\n\n+/g, '\n\n').trim(),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    html,
    '',
    `--${boundary}--`,
  ];
  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Wrap plain body text in a clean HTML email template */
function buildEmailHtml(body: string, senderName: string): string {
  // Convert newlines to <br> tags
  const htmlBody = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
          <!-- Body -->
          <tr>
            <td style="padding:40px 48px;">
              <p style="margin:0;font-size:15px;line-height:1.75;color:#1f2937;">
                ${htmlBody}
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 48px 32px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                Sent by ${senderName || 'your agent'} via Propel Dialer.<br />
                You received this because you are a contact of ${senderName || 'your agent'}.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export default router;
