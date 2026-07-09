/**
 * Google Contacts Import
 *
 * One-shot OAuth flow — authorizes, fetches all contacts from Google People API,
 * imports them into Propel, then redirects back to the app. Tokens are NOT stored.
 *
 * GET /api/contacts/google-auth     → redirects to Google consent screen
 * GET /api/contacts/google-callback → imports contacts, redirects to frontend
 */

import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import prisma from '../db';
import { requireAuth } from './auth';

const router  = Router();
const db      = prisma as any;

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://propeldialer.com';
const BACKEND_URL  = process.env.BACKEND_URL  || 'https://propel-dialer-backend.onrender.com';

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${BACKEND_URL}/api/contacts/google-callback`,
  );
}

function normalizePhone(raw: string): string {
  let digits = raw.replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(digits))                              digits = `+1${digits}`;
  else if (/^\d{11}$/.test(digits) && digits[0] === '1')   digits = `+${digits}`;
  return digits;
}

// ── GET /api/contacts/google-auth ─────────────────────────────────────────────
router.get('/google-auth', requireAuth, (req: any, res: Response) => {
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'online',          // one-shot — no refresh token needed
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/contacts.readonly',
    ],
    state: req.user.id,
  });
  res.redirect(url);
});

// ── GET /api/contacts/google-callback ─────────────────────────────────────────
router.get('/google-callback', async (req: Request, res: Response) => {
  const { code, state: userId, error } = req.query as Record<string, string>;

  if (error || !code || !userId) {
    return res.redirect(`${FRONTEND_URL}?googleContactsError=access_denied`);
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const people = google.people({ version: 'v1', auth: oauth2Client });

    // Fetch all contacts (paginate through up to 2000)
    const allConnections: any[] = [];
    let pageToken: string | undefined;

    do {
      const { data } = await people.people.connections.list({
        resourceName: 'people/me',
        pageSize: 1000,
        pageToken,
        personFields: 'names,phoneNumbers,emailAddresses,addresses',
      });
      if (data.connections) allConnections.push(...data.connections);
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);

    // Convert to Propel contact format
    const contacts: any[] = [];
    for (const person of allConnections) {
      const phones = (person.phoneNumbers || [])
        .map((p: any) => normalizePhone(p.value || ''))
        .filter((p: string) => p.length >= 10);

      if (!phones.length) continue;   // skip contacts with no phone

      const nameObj = (person.names || [])[0] || {};
      const email   = (person.emailAddresses || [])[0]?.value || '';
      const addr    = (person.addresses || [])[0];

      contacts.push({
        firstName: nameObj.givenName  || '',
        lastName:  nameObj.familyName || '',
        phone:     phones[0],
        email,
        address:   addr?.streetAddress || '',
        city:      addr?.city          || '',
        state:     addr?.region        || '',
        zip:       addr?.postalCode    || '',
        source:    'manual',
        status:    'new',
      });
    }

    // Bulk upsert — skip duplicates by phone
    let imported = 0;
    let skipped  = 0;

    for (const c of contacts) {
      try {
        const existing = await db.contact.findFirst({
          where: { userId, phone: c.phone },
        });
        if (existing) { skipped++; continue; }
        await db.contact.create({ data: { ...c, userId } });
        imported++;
      } catch {
        skipped++;
      }
    }

    return res.redirect(`${FRONTEND_URL}?googleContactsImported=${imported}&googleContactsSkipped=${skipped}`);
  } catch (err: any) {
    console.error('[Google Contacts] import error:', err?.message);
    return res.redirect(`${FRONTEND_URL}?googleContactsError=import_failed`);
  }
});

export default router;
