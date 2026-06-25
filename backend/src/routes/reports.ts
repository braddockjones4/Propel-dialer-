import { Router, Request, Response } from 'express';
import prisma from '../db';

const router = Router();
const db = prisma as any;

function csvEscape(val: any): string {
  if (val == null) return '';
  const str = String(val);
  return (str.includes(',') || str.includes('"') || str.includes('\n'))
    ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  return [headers.join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))].join('\n');
}

// ── GET /api/reports/contacts.csv ─────────────────────────────────────────────
router.get('/contacts.csv', async (_req: Request, res: Response) => {
  try {
    const contacts = await prisma.contact.findMany({
      orderBy: { createdAt: 'desc' },
      include: { calls: { orderBy: { calledAt: 'desc' }, take: 1 } },
    });
    const rows = contacts.map((c: any) => ({
      'First Name':       c.firstName,
      'Last Name':        c.lastName,
      'Phone':            c.phone,
      'Email':            c.email || '',
      'Address':          c.address || '',
      'City':             c.city || '',
      'State':            c.state || '',
      'Zip':              c.zip || '',
      'Source':           c.source,
      'Status':           c.status,
      'Lead Score':       c.leadScore ?? '',
      'Notes':            c.notes || '',
      'Last Call Date':   c.calls[0] ? new Date(c.calls[0].calledAt).toLocaleDateString() : '',
      'Last Disposition': c.calls[0]?.disposition || '',
      'Created':          new Date(c.createdAt).toLocaleDateString(),
    }));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="propel-contacts-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(toCSV(rows));
  } catch (e: any) {
    console.error('[Reports] contacts.csv:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/reports/calls.csv ────────────────────────────────────────────────
router.get('/calls.csv', async (req: Request, res: Response) => {
  try {
    const { days = '30' } = req.query as { days?: string };
    const since = new Date(Date.now() - Number(days) * 86400000);
    const calls = await prisma.call.findMany({
      where: { calledAt: { gte: since } },
      include: { contact: { select: { firstName: true, lastName: true, phone: true, address: true, source: true } } },
      orderBy: { calledAt: 'desc' },
    });
    const rows = calls.map((c: any) => ({
      'Date':         new Date(c.calledAt).toLocaleDateString(),
      'Time':         new Date(c.calledAt).toLocaleTimeString(),
      'Contact':      `${c.contact.firstName} ${c.contact.lastName}`,
      'Phone':        c.contact.phone,
      'Address':      c.contact.address || '',
      'Source':       c.contact.source,
      'Duration (s)': c.duration,
      'Disposition':  c.disposition || '',
      'AI Score':     c.aiScore ?? '',
      'Notes':        c.notes || '',
      'Recording':    c.recordingUrl || '',
    }));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="propel-calls-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(toCSV(rows));
  } catch (e: any) {
    console.error('[Reports] calls.csv:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/reports/daily ────────────────────────────────────────────────────
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { date } = req.query as { date?: string };
    const day   = date ? new Date(date) : new Date();
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const end   = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);

    const [calls, messages, newContacts, appointments] = await Promise.all([
      prisma.call.findMany({
        where: { calledAt: { gte: start, lt: end } },
        include: { contact: { select: { firstName: true, lastName: true, phone: true, source: true } } },
        orderBy: { calledAt: 'asc' },
      }),
      prisma.message.findMany({ where: { direction: 'outbound', sentAt: { gte: start, lt: end } } }),
      prisma.contact.count({ where: { createdAt: { gte: start, lt: end } } }),
      // Safe: appointments may not exist yet in the DB schema
      db.appointment.findMany({
        where: { scheduledAt: { gte: start, lt: end } },
        include: { contact: { select: { firstName: true, lastName: true, phone: true } } },
      }).catch(() => []),
    ]);

    const totalDuration = calls.reduce((s: number, c: any) => s + c.duration, 0);
    const dispositions  = calls.reduce((acc: Record<string, number>, c: any) => {
      const d = c.disposition || 'no-answer';
      acc[d] = (acc[d] || 0) + 1;
      return acc;
    }, {});
    const hotLeads    = calls.filter((c: any) => c.disposition === 'hot-lead').length;
    const callbacks   = calls.filter((c: any) => c.disposition === 'callback-scheduled').length;
    const avgDuration = calls.length ? Math.round(totalDuration / calls.length) : 0;
    const scored      = calls.filter((c: any) => c.aiScore);
    const avgScore    = scored.length ? Math.round(scored.reduce((s: number, c: any) => s + c.aiScore, 0) / scored.length) : null;

    res.json({
      date:      start.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      agentName: process.env.AGENT_NAME || 'Braddock',
      summary: { totalCalls: calls.length, totalDuration, avgDuration, hotLeads, callbacks, textsSent: messages.length, newContacts, appointments: appointments.length, avgAiScore: avgScore },
      dispositions,
      calls: calls.map((c: any) => ({
        time: new Date(c.calledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        name: `${c.contact.firstName} ${c.contact.lastName}`,
        phone: c.contact.phone, source: c.contact.source,
        duration: c.duration, disposition: c.disposition || '—', aiScore: c.aiScore, notes: c.notes || '',
      })),
      appointments: appointments.map((a: any) => ({
        time: new Date(a.scheduledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        name: `${a.contact.firstName} ${a.contact.lastName}`,
        phone: a.contact.phone, title: a.title, location: a.location || '',
      })),
    });
  } catch (e: any) {
    console.error('[Reports] daily:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
