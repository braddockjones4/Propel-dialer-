/**
 * Email sequences — send HTML emails via SendGrid (or fallback to Twilio SendGrid)
 * Requires: SENDGRID_API_KEY and SENDGRID_FROM_EMAIL in .env
 *
 * If no SendGrid key: logs emails to console (dev mode)
 */
import { Router, Request, Response } from 'express';
import prisma from '../db';
import { getAgentName } from '../agent/settings';

const router = Router();
const db = prisma as any;

// ── Send a single email ───────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, htmlBody: string, contactId?: string): Promise<{ success: boolean; messageId?: string }> {
  const { SENDGRID_API_KEY, SENDGRID_FROM_EMAIL } = process.env;

  // Log to DB first so we have a record to track
  const log = await db.emailLog.create({
    data: { contactId: contactId || null, toEmail: to, subject, body: htmlBody, status: 'sent' },
  });

  // Inject open-tracking pixel
  const trackPixel = `<img src="${process.env.NGROK_URL || 'http://localhost:3001'}/api/email/track/${log.id}" width="1" height="1" style="display:none" alt="" />`;
  const trackedBody = htmlBody + trackPixel;

  if (!SENDGRID_API_KEY || !SENDGRID_FROM_EMAIL) {
    console.log(`[Email] DEV MODE — would send to ${to}: ${subject}`);
    return { success: true, messageId: log.id };
  }

  try {
    const fromName = await getAgentName();
    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: SENDGRID_FROM_EMAIL, name: fromName },
        subject,
        content: [{ type: 'text/html', value: trackedBody }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('[Email] SendGrid error:', err);
      await db.emailLog.update({ where: { id: log.id }, data: { status: 'failed' } });
      return { success: false };
    }

    const msgId = resp.headers.get('X-Message-Id') || log.id;
    await db.emailLog.update({ where: { id: log.id }, data: { twilioSid: msgId } });
    return { success: true, messageId: msgId };
  } catch (e: any) {
    console.error('[Email] Send error:', e.message);
    try { await db.emailLog.update({ where: { id: log.id }, data: { status: 'failed' } }); } catch {}
    return { success: false };
  }
}

// Interpolate template variables
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || '');
}

// ── POST /api/email/send ──────────────────────────────────────────────────────
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { contactId, subject, body, templateId } = req.body;
    let finalSubject = subject;
    let finalBody    = body;
    if (templateId) {
      const tpl = await db.emailTemplate.findUnique({ where: { id: templateId } });
      if (!tpl) { res.status(404).json({ error: 'Template not found' }); return; }
      finalSubject = tpl.subject;
      finalBody    = tpl.body;
    }
    if (!finalSubject || !finalBody) { res.status(400).json({ error: 'subject and body required' }); return; }
    let toEmail = req.body.toEmail;
    let contact: any = null;
    if (contactId) {
      contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact) { res.status(404).json({ error: 'Contact not found' }); return; }
      if (!toEmail) toEmail = contact.email;
      if (!toEmail) { res.status(400).json({ error: 'Contact has no email address' }); return; }
      const vars: Record<string, string> = {
        firstName: contact.firstName, lastName: contact.lastName,
        fullName: `${contact.firstName} ${contact.lastName}`,
        address: contact.address || '', city: contact.city || '',
        phone: contact.phone || '', agentName: await getAgentName(),
      };
      finalSubject = interpolate(finalSubject, vars);
      finalBody    = interpolate(finalBody, vars);
    }
    if (!toEmail) { res.status(400).json({ error: 'toEmail required' }); return; }
    const result = await sendEmail(toEmail, finalSubject, finalBody, contactId);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/email/blast ─────────────────────────────────────────────────────
router.post('/blast', async (req: Request, res: Response) => {
  try {
    const { templateId, filter } = req.body as { templateId: string; filter?: { source?: string; status?: string } };
    const tpl = await db.emailTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) { res.status(404).json({ error: 'Template not found' }); return; }
    const contacts = await prisma.contact.findMany({
      where: {
        NOT: [{ status: 'dnc' }, { email: null }],
        ...(filter?.source ? { source: filter.source } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      take: 500,
    });
    const withEmail = contacts.filter(c => c.email);
    res.json({ started: true, total: withEmail.length });
    let sent = 0; let failed = 0;
    for (const contact of withEmail) {
      const vars: Record<string, string> = {
        firstName: contact.firstName, lastName: contact.lastName,
        fullName: `${contact.firstName} ${contact.lastName}`,
        address: contact.address || '', city: contact.city || '',
        agentName: await getAgentName(),
      };
      const result = await sendEmail(contact.email!, interpolate(tpl.subject, vars), interpolate(tpl.body, vars), contact.id);
      result.success ? sent++ : failed++;
      await new Promise(r => setTimeout(r, 100));
    }
    console.log(`[EmailBlast] Done: ${sent} sent, ${failed} failed`);
  } catch (e: any) { console.error('[EmailBlast]', e.message); }
});

// ── GET /api/email/track/:logId — open tracking pixel ────────────────────────
router.get('/track/:logId', async (req: Request, res: Response) => {
  const { logId } = req.params;
  try {
    await db.emailLog.update({ where: { id: logId }, data: { status: 'opened', openedAt: new Date() } });
  } catch { /* ignore */ }
  // Return 1x1 transparent GIF
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.end(pixel);
});

// ── GET /api/email/logs ───────────────────────────────────────────────────────
router.get('/logs', async (_req: Request, res: Response) => {
  try {
    const logs = await db.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(logs);
  } catch (e: any) { console.error('[Email] logs:', e.message); res.json([]); }
});

// ── GET /api/email/templates ──────────────────────────────────────────────────
router.get('/templates', async (_req: Request, res: Response) => {
  try {
    const templates = await db.emailTemplate.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(templates);
  } catch (e: any) { console.error('[Email] templates:', e.message); res.json([]); }
});

// ── POST /api/email/templates ─────────────────────────────────────────────────
router.post('/templates', async (req: Request, res: Response) => {
  try {
    const { name, subject, body, trigger } = req.body;
    if (!name || !subject || !body) { res.status(400).json({ error: 'name, subject, body required' }); return; }
    const tpl = await db.emailTemplate.create({ data: { name, subject, body, trigger } });
    res.status(201).json(tpl);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/email/templates/:id ───────────────────────────────────────────
router.patch('/templates/:id', async (req: Request, res: Response) => {
  try {
    const { name, subject, body, trigger } = req.body;
    const tpl = await db.emailTemplate.update({
      where: { id: req.params.id },
      data: { ...(name ? { name } : {}), ...(subject ? { subject } : {}), ...(body ? { body } : {}), ...(trigger !== undefined ? { trigger } : {}) },
    });
    res.json(tpl);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/email/templates/:id ──────────────────────────────────────────
router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    await db.emailTemplate.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export { sendEmail };
export default router;
