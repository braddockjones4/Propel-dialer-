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
      'https://www.googleapis.com/auth/contacts.readonly',
      'https://www.googleapis.com/auth/contacts.other.readonly',
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

// ── GET /api/gmail/contacts ───────────────────────────────────────────────────
// Fetch the user's Google Contacts via the People API.
// Returns an array of { firstName, lastName, email, phone } objects.
// Requires contacts.readonly scope — user may need to re-authorize if they
// connected Gmail before this scope was added.
router.get('/contacts', requireAuth, async (req: any, res: Response) => {
  try {
    const user = await db.user.findUnique({ where: { id: req.user.id } });

    if (!user?.gmailAccessToken) {
      res.status(400).json({ error: 'Gmail not connected.', needsAuth: true });
      return;
    }

    const oauth2Client = getOAuthClient();
    oauth2Client.setCredentials({
      access_token:  user.gmailAccessToken,
      refresh_token: user.gmailRefreshToken,
    });

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

    const people = google.people({ version: 'v1', auth: oauth2Client });

    function parsePerson(person: any) {
      const name      = person.names?.[0];
      const emailObj  = person.emailAddresses?.[0];
      const phoneObj  = person.phoneNumbers?.[0];
      const email     = emailObj?.value?.trim() || null;
      const phone     = phoneObj?.value?.replace(/[^\d+]/g, '') || null;
      const firstName = name?.givenName?.trim()  || (name?.displayName?.split(' ')[0] ?? '');
      const lastName  = name?.familyName?.trim() || (name?.displayName?.split(' ').slice(1).join(' ') ?? '');
      return { firstName, lastName, email, phone };
    }

    const allContacts: any[] = [];
    const seen = new Set<string>();

    function addUnique(c: any) {
      const key = c.email || c.phone || `${c.firstName}${c.lastName}`;
      if (key && !seen.has(key)) { seen.add(key); allContacts.push(c); }
    }

    // 1. Regular address book (contacts.readonly)
    let pageToken: string | undefined;
    let connectionsCount = 0;
    let connectionsScopeError = false;
    for (let page = 0; page < 3; page++) {
      try {
        const { data } = await people.people.connections.list({
          resourceName: 'people/me',
          pageSize: 1000,
          personFields: 'names,emailAddresses,phoneNumbers',
          ...(pageToken ? { pageToken } : {}),
        });
        connectionsCount += (data.connections || []).length;
        for (const person of data.connections || []) addUnique(parsePerson(person));
        pageToken = data.nextPageToken ?? undefined;
        if (!pageToken) break;
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 403 || status === 401) connectionsScopeError = true;
        console.error('[Gmail] connections.list error:', status, e?.response?.data?.error?.message || e?.message);
        break;
      }
    }
    console.log(`[Gmail] connections.list returned ${connectionsCount} contacts, scopeError=${connectionsScopeError}`);

    // 2. "Other contacts" — auto-created by Gmail from email history (contacts.other.readonly)
    // Note: use google.people directly for otherContacts since the typed client
    // may not expose this resource; we call via the REST-style resource path instead.
    let otherPageToken: string | undefined;
    let otherScopeMissing = false;
    let otherContactsCount = 0;
    const peopleClient = (people as any);
    if (typeof peopleClient?.otherContacts?.list === 'function') {
      for (let page = 0; page < 10; page++) {
        try {
          const { data } = await peopleClient.otherContacts.list({
            pageSize: 1000,
            readMask: 'names,emailAddresses,phoneNumbers',
            ...(otherPageToken ? { pageToken: otherPageToken } : {}),
          });
          otherContactsCount += (data.otherContacts || []).length;
          for (const person of data.otherContacts || []) addUnique(parsePerson(person));
          otherPageToken = data.nextPageToken ?? undefined;
          if (!otherPageToken) break;
        } catch (e: any) {
          const status = e?.response?.status ?? e?.status ?? e?.code;
          if (status === 403 || status === 401 || String(status) === '403' || String(status) === '401') {
            otherScopeMissing = true;
          }
          console.error('[Gmail] otherContacts.list error:', status, e?.response?.data?.error?.message || e?.message);
          break;
        }
      }
    } else {
      // otherContacts not available on this client version — use REST directly via oauth2Client
      console.log('[Gmail] otherContacts not on people client, using direct REST call');
      try {
        const accessToken = (await oauth2Client.getAccessToken()).token;
        const fetchRes = await fetch(
          `https://people.googleapis.com/v1/otherContacts?pageSize=1000&readMask=names%2CemailAddresses%2CphoneNumbers`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (fetchRes.ok) {
          const data = await fetchRes.json() as any;
          otherContactsCount += (data.otherContacts || []).length;
          for (const person of data.otherContacts || []) addUnique(parsePerson(person));
          console.log(`[Gmail] REST otherContacts returned ${data.otherContacts?.length ?? 0} contacts`);
        } else {
          const errBody = await fetchRes.json().catch(() => ({}));
          console.error('[Gmail] REST otherContacts error:', fetchRes.status, JSON.stringify(errBody));
          if (fetchRes.status === 403 || fetchRes.status === 401) otherScopeMissing = true;
        }
      } catch (e: any) {
        console.error('[Gmail] REST otherContacts fetch error:', e?.message);
      }
    }
    console.log(`[Gmail] otherContacts returned ${otherContactsCount} contacts, scopeMissing=${otherScopeMissing}`);

    // If either scope is missing, prompt re-auth
    if (otherScopeMissing || connectionsScopeError) {
      if (allContacts.length === 0) {
        res.status(403).json({ error: 'Please re-authorize Gmail to load your full contact list.', needsReauth: true });
        return;
      }
    }

    // Only return contacts that have at least an email or phone
    const useful = allContacts.filter(c => c.email || c.phone);
    res.json({
      contacts: useful,
      total: useful.length,
      debug: {
        connectionsFound: connectionsCount,
        otherContactsFound: otherContactsCount,
        connectionsScopeError,
        otherScopeMissing,
      },
    });
  } catch (e: any) {
    // Log the full error so we can diagnose
    const status  = e?.response?.status;
    const errData = JSON.stringify(e?.response?.data || e?.message || e);
    console.error(`[Gmail] contacts fetch error — HTTP ${status}:`, errData);

    // "API not enabled" comes back as 403 with "People API has not been used"
    const body = JSON.stringify(e?.response?.data || '');
    if (status === 403 && body.includes('People API')) {
      res.status(403).json({
        error: 'The Google People API is not enabled in your Google Cloud project. Enable it at console.cloud.google.com → APIs & Services → Enable APIs → search "People API".',
        needsPeopleApi: true,
      });
      return;
    }
    // Insufficient scope → re-authorize
    if (status === 403 || e?.message?.includes('insufficient')) {
      res.status(403).json({ error: 'Contacts permission not granted. Please reconnect Gmail.', needsReauth: true });
      return;
    }
    console.error('[Gmail] contacts fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/gmail/import-contacts ──────────────────────────────────────────
// Smart Gmail import:
//  1. Phone match + existing has no email → ENRICH (write the email in)
//  2. Email already in DB → SKIP (true duplicate)
//  3. No match at all → CREATE new contact
router.post('/import-contacts', requireAuth, async (req: any, res: Response) => {
  const { contacts, groupName } = req.body as {
    contacts: { firstName: string; lastName: string; email: string | null; phone: string | null }[];
    groupName?: string;
  };
  if (!Array.isArray(contacts) || contacts.length === 0) {
    res.status(400).json({ error: 'No contacts provided' });
    return;
  }

  const group = (groupName?.trim() || 'Gmail Contacts');

  function normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    return digits.length === 10 ? `+1${digits}` : `+${digits}`;
  }

  // Filter out contacts with no identifier at all
  const validContacts = contacts.filter(c => c.email || c.phone);

  const emailList = validContacts.filter(c => c.email).map(c => c.email!.toLowerCase().trim());
  const phoneList = validContacts.map(c => normalizePhone(c.phone)).filter(Boolean) as string[];

  // Look up existing contacts by phone (need id + email so we know if they're missing an email)
  // Look up existing contacts by email (to detect true duplicates)
  const [existByEmail, existByPhone] = await Promise.all([
    emailList.length
      ? db.contact.findMany({ where: { email: { in: emailList } }, select: { id: true, email: true } })
      : Promise.resolve([] as { id: string; email: string | null }[]),
    phoneList.length
      ? db.contact.findMany({ where: { phone: { in: phoneList } }, select: { id: true, phone: true, email: true } })
      : Promise.resolve([] as { id: string; phone: string | null; email: string | null }[]),
  ]);

  // Map existing emails (true duplicates — skip these)
  const emailDupes = new Set<string>(
    (existByEmail as { email: string | null }[])
      .map(c => c.email?.toLowerCase().trim() ?? '').filter(Boolean)
  );

  // Map phone → existing contact (for enrichment)
  const phoneToExisting = new Map<string, { id: string; email: string | null }>();
  for (const c of existByPhone as { id: string; phone: string | null; email: string | null }[]) {
    if (c.phone) phoneToExisting.set(c.phone, { id: c.id, email: c.email });
  }

  const toCreate: any[]   = [];
  const toEnrich: { id: string; email: string }[] = [];
  let   trueSkipped = 0;

  for (const c of validContacts) {
    const email = c.email?.toLowerCase().trim() || null;
    const phone = normalizePhone(c.phone);

    // 1. Email already in DB → true duplicate, skip
    if (email && emailDupes.has(email)) { trueSkipped++; continue; }

    // 2. Phone matches an existing contact
    if (phone && phoneToExisting.has(phone)) {
      const existing = phoneToExisting.get(phone)!;
      if (email && !existing.email) {
        // Existing contact has no email → enrich it
        toEnrich.push({ id: existing.id, email: c.email!.trim() });
      } else {
        // Existing contact already has email or Gmail contact has no email → skip
        trueSkipped++;
      }
      continue;
    }

    // 3. Genuinely new contact → create
    toCreate.push({
      firstName:    c.firstName?.trim() || '',
      lastName:     c.lastName?.trim()  || '',
      phone,
      email:        c.email?.trim()     || null,
      source:       'gmail',
      contactGroup: group,
      status:       'new',
    });
  }

  // Run enrichments (patch email onto existing phone contacts)
  let enriched = 0;
  if (toEnrich.length > 0) {
    await Promise.all(
      toEnrich.map(({ id, email }) =>
        db.contact.update({ where: { id }, data: { email } }).then(() => { enriched++; }).catch(() => {})
      )
    );
  }

  // Bulk create new contacts
  let created = 0;
  if (toCreate.length > 0) {
    try {
      const result = await db.contact.createMany({ data: toCreate, skipDuplicates: true });
      created = result.count;
    } catch (e: any) {
      console.error('[Gmail] import-contacts createMany error:', e.message);
    }
  }

  console.log(`[Gmail] import-contacts: created=${created}, enriched=${enriched}, skipped=${trueSkipped} (group="${group}")`);
  res.json({
    imported:  created,
    enriched,
    skipped:   trueSkipped,
    total:     validContacts.length,
  });
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
