// ── iCloud Contacts Import via CardDAV ────────────────────────────────────────
import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';
import * as crypto from 'crypto';
import prisma from '../db';

const router = Router();

const ENC_KEY = (process.env.ENCRYPTION_KEY || 'propel-dialer-icloud-key-32chars!').slice(0, 32);
const IV_LEN  = 16;

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENC_KEY), iv);
  return iv.toString('hex') + ':' + Buffer.concat([cipher.update(text), cipher.final()]).toString('hex');
}
function decrypt(text: string): string {
  const [ivHex, encHex] = text.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENC_KEY), Buffer.from(ivHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString();
}

// Pull the first <href> value from an XML block
function firstHref(xml: string): string {
  const m = xml.match(/<(?:[A-Za-z]+:)?href[^>]*>([^<]+)<\/(?:[A-Za-z]+:)?href>/i);
  return m ? m[1].trim() : '';
}

// Extract ALL hrefs from a multistatus response
function allHrefs(xml: string): string[] {
  const results: string[] = [];
  const re = /<(?:[A-Za-z]+:)?href[^>]*>([^<]+)<\/(?:[A-Za-z]+:)?href>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

function extractVCards(xml: string): string[] {
  const results: string[] = [];
  const re = /<(?:[a-zA-Z]+:)?address-data[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?address-data>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1]
      .replace(/&#13;/g, '\r').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    if (/BEGIN:VCARD/i.test(block)) results.push(block);
  }
  // Fallback: raw BEGIN:VCARD blocks
  if (!results.length) {
    results.push(...(xml.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || []));
  }
  return results;
}

function parseVCard(text: string): Record<string, string> | null {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\r/g, '').split('\n');
  const c: Record<string, string> = {};
  for (const raw of lines) {
    const line = raw.trim();
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const prop = line.slice(0, ci).toUpperCase();
    const val  = line.slice(ci + 1).trim();
    if (prop === 'FN' && val) c._fn = val;
    if (prop === 'N'  && val) {
      const p = val.split(';');
      if (p[0]?.trim()) c.lastName  = p[0].trim();
      if (p[1]?.trim()) c.firstName = p[1].trim();
    }
    if ((prop === 'TEL' || prop.startsWith('TEL;')) && val && !c.phone) {
      let d = val.replace(/[^\d+]/g, '');
      if (/^\d{10}$/.test(d))                    d = '+1' + d;
      else if (/^\d{11}$/.test(d) && d[0]==='1') d = '+' + d;
      if (d.length >= 10) c.phone = d;
    }
    if ((prop === 'EMAIL' || prop.startsWith('EMAIL;')) && val && !c.email) c.email = val;
    if ((prop === 'ADR'   || prop.startsWith('ADR;'))   && val && !c.address) {
      const p = val.split(';');
      c.address = p[2]?.trim() || '';
      c.city    = p[3]?.trim() || '';
      c.state   = p[4]?.trim() || '';
      c.zip     = p[5]?.trim() || '';
    }
  }
  if (!c.firstName && !c.lastName && c._fn) {
    const p = c._fn.split(' ');
    c.firstName = p[0] || '';
    c.lastName  = p.slice(1).join(' ') || '';
  }
  delete c._fn;
  if (!c.phone) return null;
  return {
    firstName: c.firstName || '', lastName: c.lastName || '',
    phone: c.phone,
    email: c.email || '', address: c.address || '',
    city: c.city || '', state: c.state || '', zip: c.zip || '',
    source: 'manual',
  };
}

// ── Full CardDAV import: discover → enumerate all hrefs → multiget in batches ──
async function fetchIcloudContacts(appleId: string, appPassword: string): Promise<Record<string, string>[]> {
  const auth = `Basic ${Buffer.from(`${appleId}:${appPassword}`).toString('base64')}`;
  const xml_ct = 'application/xml; charset=utf-8';

  function hdrs(depth = '0') {
    return { Authorization: auth, 'Content-Type': xml_ct, Accept: '*/*', 'User-Agent': 'PropelDialer/1.0', Depth: depth };
  }

  const PROPFIND_PRINCIPAL    = `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`;
  const PROPFIND_HOMESET      = `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><C:addressbook-home-set/></D:prop></D:propfind>`;
  const PROPFIND_RESOURCETYPE = `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:displayname/></D:prop></D:propfind>`;
  const PROPFIND_HREFS_ONLY   = `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>`;
  // sync-collection: designed to return ALL items without server-side limits
  const SYNC_COLLECTION_ETAGS = `<?xml version="1.0" encoding="utf-8"?><D:sync-collection xmlns:D="DAV:"><D:sync-token/><D:sync-level>1</D:sync-level><D:prop><D:getetag/></D:prop></D:sync-collection>`;
  const REPORT_ALL_ETAGS      = `<?xml version="1.0" encoding="utf-8"?><C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/></D:prop></C:addressbook-query>`;

  // ── STEP 1: well-known → follow redirect(s) → get principal path ──────────
  let serverBase = 'https://contacts.icloud.com';
  const wk0 = await fetch(`${serverBase}/.well-known/carddav`, {
    method: 'PROPFIND', headers: hdrs('0'), body: PROPFIND_PRINCIPAL, redirect: 'manual',
  });
  if (wk0.status === 401) throw new Error('AUTH_FAILED');

  async function followRedirects(resp: Awaited<ReturnType<typeof fetch>>, body: string, depth = '0', maxHops = 3): Promise<{ status: number; text: string }> {
    if ([301, 302, 307, 308].includes(resp.status) && maxHops > 0) {
      const loc = resp.headers.get('location') || '';
      if (!loc) throw new Error('DISCOVERY_FAILED');
      try { const u = new URL(loc); serverBase = `${u.protocol}//${u.host}`; } catch { /* keep current */ }
      const r2 = await fetch(loc, { method: 'PROPFIND', headers: hdrs(depth), body, redirect: 'manual' });
      if (r2.status === 401) throw new Error('AUTH_FAILED');
      return followRedirects(r2, body, depth, maxHops - 1);
    }
    return { status: resp.status, text: await resp.text() };
  }

  const wk = await followRedirects(wk0, PROPFIND_PRINCIPAL);
  if (wk.status !== 207) throw new Error('DISCOVERY_FAILED');

  const principalPath = firstHref(wk.text);
  if (!principalPath) throw new Error('DISCOVERY_FAILED');
  const principalUrl = principalPath.startsWith('http') ? principalPath : `${serverBase}${principalPath}`;

  // ── STEP 2: PROPFIND principal → addressbook-home-set ────────────────────
  const hs0 = await fetch(principalUrl, { method: 'PROPFIND', headers: hdrs('0'), body: PROPFIND_HOMESET });
  if (hs0.status === 401) throw new Error('AUTH_FAILED');
  const hsXml = await hs0.text();

  const hsMatch = hsXml.match(/addressbook-home-set[\s\S]{0,600}?<(?:[A-Za-z]+:)?href[^>]*>([^<]+)<\/(?:[A-Za-z]+:)?href>/i);
  const homeSetPath = hsMatch ? hsMatch[1].trim() : firstHref(hsXml);
  if (!homeSetPath) throw new Error('NO_ADDRESSBOOK');
  const homeSetUrl = homeSetPath.startsWith('http') ? homeSetPath : `${serverBase}${homeSetPath}`;

  // ── STEP 3: PROPFIND home-set Depth:1 → discover addressbook collections ──
  const disc = await fetch(homeSetUrl, { method: 'PROPFIND', headers: hdrs('1'), body: PROPFIND_RESOURCETYPE });
  let addressbookUrls: string[] = [];
  if (disc.status === 207 || disc.ok) {
    const discXml = await disc.text();
    const responseBlocks = discXml.match(/<(?:[A-Za-z]+:)?response\b[\s\S]*?<\/(?:[A-Za-z]+:)?response>/gi) || [];
    for (const block of responseBlocks) {
      if (/<(?:[A-Za-z]+:)?addressbook\b/i.test(block)) {
        const href = firstHref(block);
        if (href) addressbookUrls.push(href);
      }
    }
  }
  if (!addressbookUrls.length) addressbookUrls = [homeSetUrl];

  // ── STEP 4a: Enumerate ALL contact hrefs — try sync-collection, then PROPFIND ──
  // sync-collection (RFC 6578) is designed to return ALL items without server limits

  function extractHrefsFromXml(xml: string, excludePath: string): string[] {
    const blocks = xml.match(/<(?:[A-Za-z]+:)?response\b[\s\S]*?<\/(?:[A-Za-z]+:)?response>/gi) || [];
    const out: string[] = [];
    const excNorm = excludePath.replace(/\/$/, '');
    for (const b of blocks) {
      const href = firstHref(b);
      if (!href) continue;
      if (href.replace(/\/$/, '') === excNorm || href.endsWith('/')) continue;
      if (/<(?:[A-Za-z]+:)?status[^>]*>HTTP\/1\.[01]\s+404/i.test(b)) continue;
      out.push(href);
    }
    return out;
  }

  const abHrefMap: Array<{ abUrl: string; hrefs: string[] }> = [];

  for (const abPath of addressbookUrls) {
    const abUrl = abPath.startsWith('http') ? abPath : `${serverBase}${abPath}`;
    let hrefs: string[] = [];

    // Method 1: sync-collection REPORT — returns ALL items without pagination
    try {
      const r1 = await fetch(abUrl, { method: 'REPORT', headers: hdrs('1'), body: SYNC_COLLECTION_ETAGS });
      console.log(`[iCloud] sync-collection → ${r1.status}`);
      if (r1.status === 207) { hrefs = extractHrefsFromXml(await r1.text(), abPath); }
    } catch {}
    console.log(`[iCloud] sync-collection hrefs: ${hrefs.length}`);

    // Method 2: addressbook-query REPORT requesting only etags (no address-data body)
    if (!hrefs.length) {
      try {
        const r2 = await fetch(abUrl, { method: 'REPORT', headers: hdrs('1'), body: REPORT_ALL_ETAGS });
        console.log(`[iCloud] addressbook-query (etags) → ${r2.status}`);
        if (r2.status === 207) { hrefs = extractHrefsFromXml(await r2.text(), abPath); }
      } catch {}
      console.log(`[iCloud] addressbook-query hrefs: ${hrefs.length}`);
    }

    // Method 3: PROPFIND Depth:1
    if (!hrefs.length) {
      try {
        const r3 = await fetch(abUrl, { method: 'PROPFIND', headers: hdrs('1'), body: PROPFIND_HREFS_ONLY });
        console.log(`[iCloud] PROPFIND Depth:1 → ${r3.status}`);
        if (r3.status === 207 || r3.ok) { hrefs = extractHrefsFromXml(await r3.text(), abPath); }
      } catch {}
      console.log(`[iCloud] PROPFIND hrefs: ${hrefs.length}`);
    }

    if (hrefs.length) abHrefMap.push({ abUrl, hrefs });
  }

  const totalHrefs = abHrefMap.reduce((n, e) => n + e.hrefs.length, 0);
  console.log(`[iCloud] TOTAL hrefs across ${addressbookUrls.length} addressbook(s): ${totalHrefs}`);

  if (!totalHrefs) return [];

  // ── STEP 4b: addressbook-multiget in batches of 100 per addressbook ──────
  const BATCH = 100;
  const allVCards: string[] = [];

  for (const { abUrl, hrefs } of abHrefMap) {
    for (let i = 0; i < hrefs.length; i += BATCH) {
      const batch = hrefs.slice(i, i + BATCH);
      const hrefXml = batch.map(h => `<D:href>${h}</D:href>`).join('');
      const MULTIGET = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop><D:getetag/><C:address-data/></D:prop>
  ${hrefXml}
</C:addressbook-multiget>`;

      const rep = await fetch(abUrl, { method: 'REPORT', headers: hdrs('1'), body: MULTIGET });
      if (rep.status === 401) throw new Error('AUTH_FAILED');
      if (rep.status === 207 || rep.ok) {
        allVCards.push(...extractVCards(await rep.text()));
      }
    }
  }

  console.log(`[iCloud] parsed ${allVCards.length} vCards total`);
  return allVCards.map(parseVCard).filter((c): c is NonNullable<typeof c> => c !== null);
}

async function importContacts(contacts: Record<string, string>[]) {
  if (!contacts.length) return { imported: 0, skipped: 0, total: 0 };
  const phones = contacts.map(c => c.phone);
  const existingCount = await prisma.contact.count({ where: { phone: { in: phones } } });
  const result = await (prisma as any).contact.createMany({ data: contacts, skipDuplicates: true });
  return { imported: result.count, skipped: existingCount, total: contacts.length };
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/icloud-status', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  try {
    const s = await (prisma as any).dialerSettings.findFirst({ where: { userId } });
    res.json({ connected: !!(s?.icloudEmail && s?.icloudAppPwd), email: s?.icloudEmail || null });
  } catch {
    res.json({ connected: false, email: null });
  }
});

router.post('/icloud-import', async (req: Request, res: Response) => {
  const { appleId, appPassword, saveCredentials } = req.body as { appleId?: string; appPassword?: string; saveCredentials?: boolean };
  if (!appleId?.trim() || !appPassword?.trim()) {
    res.status(400).json({ error: 'Apple ID and App-Specific Password are required.' }); return;
  }
  try {
    const contacts = await fetchIcloudContacts(appleId.trim(), appPassword.trim());
    const result   = await importContacts(contacts);
    if (saveCredentials) {
      const userId = (req as any).user?.id;
      if (userId) {
        try {
          const encrypted = encrypt(appPassword.trim());
          await (prisma as any).dialerSettings.upsert({
            where:  { userId },
            update: { icloudEmail: appleId.trim(), icloudAppPwd: encrypted },
            create: { userId, icloudEmail: appleId.trim(), icloudAppPwd: encrypted },
          });
        } catch (saveErr: any) {
          console.warn('[iCloud] Could not save credentials:', saveErr?.message);
        }
      }
    }
    res.json(result);
  } catch (err: any) {
    const msg = err?.message || '';
    console.error('[iCloud] import error:', msg);
    if (msg === 'AUTH_FAILED')      { res.status(401).json({ error: 'Incorrect Apple ID or App-Specific Password.' }); return; }
    if (msg === 'DISCOVERY_FAILED') { res.status(502).json({ error: 'Could not reach iCloud. Please try again.' }); return; }
    if (msg === 'NO_ADDRESSBOOK')   { res.status(502).json({ error: 'No address book found in iCloud.' }); return; }
    res.status(500).json({ error: 'iCloud connection failed. Check credentials and try again.' });
  }
});

router.post('/icloud-sync', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  try {
    const s = await (prisma as any).dialerSettings.findFirst({ where: { userId } });
    if (!s?.icloudEmail || !s?.icloudAppPwd) {
      res.status(400).json({ error: 'No iCloud account connected. Set up iCloud sync first.' }); return;
    }
    const contacts = await fetchIcloudContacts(s.icloudEmail, decrypt(s.icloudAppPwd));
    res.json(await importContacts(contacts));
  } catch (err: any) {
    if (err?.message === 'AUTH_FAILED') {
      try { await (prisma as any).dialerSettings.update({ where: { userId }, data: { icloudAppPwd: null } }); } catch {}
      res.status(401).json({ error: 'iCloud credentials expired. Please reconnect.' }); return;
    }
    res.status(500).json({ error: 'Sync failed. Please try again.' });
  }
});

router.delete('/icloud-disconnect', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  try {
    await (prisma as any).dialerSettings.updateMany({ where: { userId }, data: { icloudEmail: null, icloudAppPwd: null } });
  } catch {}
  res.json({ ok: true });
});

export default router;
