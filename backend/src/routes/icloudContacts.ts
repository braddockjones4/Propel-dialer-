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

function xmlHref(xml: string, nearTag: string): string {
  const idx = xml.search(new RegExp(`<[a-zA-Z]+:${nearTag}|<${nearTag}`, 'i'));
  if (idx < 0) return '';
  const slice = xml.slice(Math.max(0, idx - 100), idx + 700);
  const m = slice.match(/<(?:[a-zA-Z]+:)?href[^>]*>([^<]+)<\/(?:[a-zA-Z]+:)?href>/i);
  return m ? m[1].trim() : '';
}

function extractVCards(xml: string): string[] {
  const results: string[] = [];
  const re = /<(?:[a-zA-Z]+:)?address-data[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?address-data>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1].replace(/&#13;/g,'\r').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();
    if (/BEGIN:VCARD/i.test(block)) results.push(block);
  }
  if (!results.length) results.push(...(xml.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || []));
  return results;
}

function parseVCard(text: string): Record<string,string> | null {
  const lines = text.replace(/\r\n[ \t]/g,'').replace(/\r/g,'').split('\n');
  const c: Record<string,string> = {};
  for (const raw of lines) {
    const line = raw.trim(); const ci = line.indexOf(':');
    if (ci < 0) continue;
    const prop = line.slice(0,ci).toUpperCase(); const val = line.slice(ci+1).trim();
    if (prop==='FN' && val) c._fn=val;
    if (prop==='N' && val) { const p=val.split(';'); if(p[0]?.trim()) c.lastName=p[0].trim(); if(p[1]?.trim()) c.firstName=p[1].trim(); }
    if ((prop==='TEL'||prop.startsWith('TEL;')) && val && !c.phone) {
      let d=val.replace(/[^\d+]/g,'');
      if(/^\d{10}$/.test(d)) d='+1'+d; else if(/^\d{11}$/.test(d)&&d[0]==='1') d='+'+d;
      if(d.length>=10) c.phone=d;
    }
    if ((prop==='EMAIL'||prop.startsWith('EMAIL;')) && val && !c.email) c.email=val;
    if ((prop==='ADR'||prop.startsWith('ADR;')) && val && !c.address) {
      const p=val.split(';'); c.address=p[2]?.trim()||''; c.city=p[3]?.trim()||''; c.state=p[4]?.trim()||''; c.zip=p[5]?.trim()||'';
    }
  }
  if (!c.firstName && !c.lastName && c._fn) { const p=c._fn.split(' '); c.firstName=p[0]||''; c.lastName=p.slice(1).join(' ')||''; }
  delete c._fn;
  if (!c.phone) return null;
  return { firstName:c.firstName||'', lastName:c.lastName||'', phone:c.phone, email:c.email||'', address:c.address||'', city:c.city||'', state:c.state||'', zip:c.zip||'', source:'manual' };
}

async function fetchIcloudContacts(appleId: string, appPassword: string) {
  const authHeader = `Basic ${Buffer.from(`${appleId}:${appPassword}`).toString('base64')}`;
  const hdrs = { Authorization: authHeader, 'Content-Type': 'application/xml; charset=utf-8', Accept: '*/*', 'User-Agent': 'PropelDialer/1.0' };
  const propfindPrincipal = `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>`;
  const propfindHomeSet   = `<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><C:addressbook-home-set/></D:prop></D:propfind>`;
  const reportAll         = `<?xml version="1.0" encoding="utf-8"?><C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/><C:address-data/></D:prop></C:addressbook-query>`;

  let serverBase = 'https://contacts.icloud.com'; let principalPath = '';
  const wkResp = await fetch(`${serverBase}/.well-known/carddav`, { method:'PROPFIND', headers:{...hdrs,Depth:'0'}, body:propfindPrincipal, redirect:'manual' });
  if (wkResp.status===401) throw new Error('AUTH_FAILED');
  if ([301,302,307,308].includes(wkResp.status)) {
    const loc = wkResp.headers.get('location')||'';
    if (loc) {
      try { const u=new URL(loc); serverBase=`${u.protocol}//${u.host}`; } catch {}
      const r2 = await fetch(loc, { method:'PROPFIND', headers:{...hdrs,Depth:'0'}, body:propfindPrincipal, redirect:'manual' });
      if (r2.status===401) throw new Error('AUTH_FAILED');
      if (r2.status===207) { const xml=await r2.text(); principalPath=xmlHref(xml,'current-user-principal'); }
      else if ([301,302,307,308].includes(r2.status)) {
        const loc2=r2.headers.get('location')||'';
        if (loc2) { try { const u2=new URL(loc2); serverBase=`${u2.protocol}//${u2.host}`; principalPath=u2.pathname; } catch {} }
      }
    }
  } else if (wkResp.status===207) { const xml=await wkResp.text(); principalPath=xmlHref(xml,'current-user-principal'); }
  if (!principalPath) throw new Error('DISCOVERY_FAILED');
  const principalUrl = principalPath.startsWith('http') ? principalPath : `${serverBase}${principalPath}`;

  const homeSetResp = await fetch(principalUrl, { method:'PROPFIND', headers:{...hdrs,Depth:'0'}, body:propfindHomeSet, redirect:'follow' });
  if (homeSetResp.status===401) throw new Error('AUTH_FAILED');
  const homeSetXml = await homeSetResp.text();
  let homeSetPath = xmlHref(homeSetXml,'addressbook-home-set');
  if (!homeSetPath) { const m=homeSetXml.match(/addressbook-home-set[\s\S]{0,400}<(?:[a-zA-Z]+:)?href[^>]*>([^<]+)</i); homeSetPath=m?.[1]?.trim()||''; }
  if (!homeSetPath) throw new Error('NO_ADDRESSBOOK');
  const homeSetUrl = homeSetPath.startsWith('http') ? homeSetPath : `${serverBase}${homeSetPath}`;

  const reportResp = await fetch(homeSetUrl, { method:'REPORT', headers:{...hdrs,Depth:'1'}, body:reportAll, redirect:'follow' });
  if (reportResp.status===401) throw new Error('AUTH_FAILED');
  if (reportResp.status!==207 && !reportResp.ok) throw new Error(`HTTP_${reportResp.status}`);
  const reportXml = await reportResp.text();
  return extractVCards(reportXml).map(parseVCard).filter((c): c is NonNullable<typeof c> => c!==null);
}

async function importContacts(contacts: Record<string,string>[]) {
  if (!contacts.length) return { imported:0, skipped:0, total:0 };
  const phones = contacts.map(c=>c.phone);
  const existingCount = await prisma.contact.count({ where:{ phone:{ in:phones } } });
  const result = await (prisma as any).contact.createMany({ data:contacts, skipDuplicates:true });
  return { imported:result.count, skipped:existingCount, total:contacts.length };
}

router.get('/icloud-status', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const s = await (prisma as any).dialerSettings.findFirst({ where:{ userId } });
  res.json({ connected:!!(s?.icloudEmail && s?.icloudAppPwd), email:s?.icloudEmail||null });
});

router.post('/icloud-import', async (req: Request, res: Response) => {
  const { appleId, appPassword, saveCredentials } = req.body as { appleId?:string; appPassword?:string; saveCredentials?:boolean };
  if (!appleId?.trim() || !appPassword?.trim()) { res.status(400).json({ error:'Apple ID and App-Specific Password are required.' }); return; }
  try {
    const contacts = await fetchIcloudContacts(appleId.trim(), appPassword.trim());
    const result   = await importContacts(contacts);
    if (saveCredentials) {
      const userId = (req as any).user?.id;
      if (userId) {
        const encrypted = encrypt(appPassword.trim());
        await (prisma as any).dialerSettings.upsert({ where:{userId}, update:{ icloudEmail:appleId.trim(), icloudAppPwd:encrypted }, create:{ userId, icloudEmail:appleId.trim(), icloudAppPwd:encrypted } });
      }
    }
    res.json(result);
  } catch (err: any) {
    const msg = err?.message||'';
    if (msg==='AUTH_FAILED')      { res.status(401).json({ error:'Incorrect Apple ID or App-Specific Password.' }); return; }
    if (msg==='DISCOVERY_FAILED') { res.status(502).json({ error:'Could not reach iCloud. Please try again.' }); return; }
    if (msg==='NO_ADDRESSBOOK')   { res.status(502).json({ error:'No address book found. Enable Contacts in iCloud settings.' }); return; }
    console.error('[iCloud]', msg);
    res.status(500).json({ error:'iCloud connection failed. Check credentials and try again.' });
  }
});

router.post('/icloud-sync', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const s = await (prisma as any).dialerSettings.findFirst({ where:{ userId } });
  if (!s?.icloudEmail || !s?.icloudAppPwd) { res.status(400).json({ error:'No iCloud account connected. Set up iCloud sync first.' }); return; }
  try {
    const contacts = await fetchIcloudContacts(s.icloudEmail, decrypt(s.icloudAppPwd));
    res.json(await importContacts(contacts));
  } catch (err: any) {
    if (err?.message==='AUTH_FAILED') {
      await (prisma as any).dialerSettings.update({ where:{ userId }, data:{ icloudAppPwd:null } });
      res.status(401).json({ error:'iCloud credentials expired. Please reconnect in Import → From Phone.' }); return;
    }
    res.status(500).json({ error:'Sync failed. Please try again.' });
  }
});

router.delete('/icloud-disconnect', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  await (prisma as any).dialerSettings.updateMany({ where:{ userId }, data:{ icloudEmail:null, icloudAppPwd:null } });
  res.json({ ok:true });
});

export default router;
