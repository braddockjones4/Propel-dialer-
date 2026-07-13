import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import prisma from '../db';
import { getAgentName } from '../agent/settings';

const router = Router();
const db = prisma as any; // cast so missing models don't cause TS errors before prisma generate

// ── GET /api/appointments/upcoming ───────────────────────────────────────────
router.get('/upcoming', async (_req: Request, res: Response) => {
  try {
    const appts = await db.appointment.findMany({
      where: { scheduledAt: { gte: new Date() }, status: 'confirmed' },
      include: { contact: { select: { id: true, firstName: true, lastName: true, phone: true, address: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 10,
    });
    res.json(appts);
  } catch (e: any) {
    console.error('[Appointments] upcoming:', e.message);
    res.json([]);
  }
});

// ── GET /api/appointments ─────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const { month, year } = req.query;
    let where: any = {};
    if (month && year) {
      const start = new Date(Number(year), Number(month) - 1, 1);
      const end   = new Date(Number(year), Number(month), 1);
      where.scheduledAt = { gte: start, lt: end };
    }
    const appts = await db.appointment.findMany({
      where,
      include: { contact: { select: { id: true, firstName: true, lastName: true, phone: true, address: true } } },
      orderBy: { scheduledAt: 'asc' },
    });
    res.json(appts);
  } catch (e: any) {
    console.error('[Appointments] GET /:', e.message);
    res.json([]);
  }
});

// ── POST /api/appointments ────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const { contactId, title, scheduledAt, duration, location, notes, sendSms } = req.body;
    if (!contactId || !scheduledAt) { res.status(400).json({ error: 'contactId and scheduledAt required' }); return; }

    const appt = await db.appointment.create({
      data: { contactId, title: title || 'Listing Appointment', scheduledAt: new Date(scheduledAt), duration: duration || 60, location, notes },
      include: { contact: true },
    });

    await prisma.contact.update({ where: { id: contactId }, data: { status: 'appointment' } });

    if (sendSms !== false) {
      const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID } = process.env;
      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_CALLER_ID) {
        try {
          const date = new Date(scheduledAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
          const time = new Date(scheduledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          const agentName = await getAgentName();
          const msg = `Hi ${appt.contact.firstName}! This confirms your appointment with ${agentName} on ${date} at ${time}${location ? ` at ${location}` : ''}. Reply STOP to opt out.`;
          const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
          await client.messages.create({ to: appt.contact.phone, from: TWILIO_CALLER_ID, body: msg });
          await db.appointment.update({ where: { id: appt.id }, data: { smsSent: true } });
        } catch (e: any) { console.error('[Appt] SMS failed:', e.message); }
      }
    }

    res.status(201).json(appt);
  } catch (e: any) {
    console.error('[Appointments] POST /:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/appointments/:id ───────────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { title, scheduledAt, duration, location, notes, status } = req.body;
    const appt = await db.appointment.update({
      where: { id: req.params.id },
      data: {
        ...(title       ? { title }                             : {}),
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}),
        ...(duration    ? { duration }                          : {}),
        ...(location !== undefined ? { location }               : {}),
        ...(notes    !== undefined ? { notes }                  : {}),
        ...(status      ? { status }                            : {}),
      },
      include: { contact: { select: { firstName: true, lastName: true, phone: true } } },
    });
    res.json(appt);
  } catch (e: any) {
    console.error('[Appointments] PATCH:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/appointments/:id ──────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.appointment.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (e: any) {
    console.error('[Appointments] DELETE:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
