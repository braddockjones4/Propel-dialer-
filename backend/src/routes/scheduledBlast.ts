import { Router, Request, Response } from 'express';
import cron from 'node-cron';
import twilio from 'twilio';
import prisma from '../db';

const router = Router();

// ─── Template interpolation (same as blast.ts) ───────────────────────────────
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

// ─── Fire a single scheduled blast ───────────────────────────────────────────
export async function fireScheduledBlast(blastId: string): Promise<void> {
  const blast = await prisma.scheduledBlast.findUnique({ where: { id: blastId } });
  if (!blast || blast.status !== 'pending') return;

  const filter = JSON.parse(blast.filter) as { source?: string; status?: string };
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID, AGENT_NAME, AGENT_PHONE, NGROK_URL } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_CALLER_ID) {
    console.error('[ScheduledBlast] Twilio not configured');
    return;
  }

  const contacts = await prisma.contact.findMany({
    where: {
      NOT: { status: 'dnc' },
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
  });

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  let sent = 0;
  let failed = 0;

  for (const contact of contacts) {
    try {
      const body = interpolate(blast.message, {
        firstName:  contact.firstName,
        fullName:   `${contact.firstName} ${contact.lastName}`.trim(),
        lastName:   contact.lastName,
        address:    contact.address || 'your property',
        city:       contact.city || '',
        agentName:  AGENT_NAME || 'Braddock',
        agentPhone: AGENT_PHONE || TWILIO_CALLER_ID,
      });

      const msg = await client.messages.create({
        body,
        from: TWILIO_CALLER_ID,
        to:   contact.phone!,
        statusCallback: `${NGROK_URL}/api/twilio/sms-status`,
      });

      await prisma.message.create({
        data: {
          contactId:  contact.id,
          direction:  'outbound',
          body,
          fromNumber: TWILIO_CALLER_ID,
          toNumber:   contact.phone!,
          twilioSid:  msg.sid,
          status:     'sent',
        },
      });

      sent++;
      await new Promise(r => setTimeout(r, 100));
    } catch {
      failed++;
    }
  }

  await prisma.scheduledBlast.update({
    where: { id: blastId },
    data: { status: 'sent', sentCount: sent, failCount: failed },
  });

  console.log(`[ScheduledBlast] ${blastId} fired — ${sent} sent, ${failed} failed`);
}

// ─── Cron: check every minute for blasts that are due ────────────────────────
cron.schedule('* * * * *', async () => {
  const due = await prisma.scheduledBlast.findMany({
    where: {
      status:      'pending',
      scheduledAt: { lte: new Date() },
    },
  });

  for (const blast of due) {
    console.log(`[ScheduledBlast] Firing scheduled blast ${blast.id}`);
    fireScheduledBlast(blast.id).catch(err =>
      console.error(`[ScheduledBlast] Error firing ${blast.id}:`, err)
    );
  }
});

console.log('[ScheduledBlast] Cron scheduler started (checks every minute)');

// ─── GET /api/blast/scheduled ─────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const blasts = await prisma.scheduledBlast.findMany({
    orderBy: { scheduledAt: 'desc' },
    take: 50,
  });
  res.json(blasts);
});

// ─── POST /api/blast/scheduled ────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { message, filter, scheduledAt, mediaUrl } = req.body as {
    message: string;
    filter: { source?: string; status?: string };
    scheduledAt: string;
    mediaUrl?: string;
  };

  if (!message?.trim())   { res.status(400).json({ error: 'message required' }); return; }
  if (!scheduledAt)       { res.status(400).json({ error: 'scheduledAt required' }); return; }

  const scheduledDate = new Date(scheduledAt);
  if (isNaN(scheduledDate.getTime())) {
    res.status(400).json({ error: 'Invalid scheduledAt date' }); return;
  }

  const blast = await prisma.scheduledBlast.create({
    data: {
      message,
      filter:      JSON.stringify(filter || {}),
      scheduledAt: scheduledDate,
      status:      'pending',
    },
  });

  res.status(201).json(blast);
});

// ─── DELETE /api/blast/scheduled/:id — cancel a pending blast ─────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const blast = await prisma.scheduledBlast.findUnique({ where: { id: req.params.id } });
  if (!blast)                    { res.status(404).json({ error: 'Not found' }); return; }
  if (blast.status !== 'pending') { res.status(400).json({ error: 'Can only cancel pending blasts' }); return; }

  await prisma.scheduledBlast.update({ where: { id: req.params.id }, data: { status: 'cancelled' } });
  res.json({ cancelled: true });
});

export default router;
