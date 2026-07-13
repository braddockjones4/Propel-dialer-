import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import prisma from '../db';

const router = Router();

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

// POST /api/blast/send
router.post('/send', async (req: Request, res: Response) => {
  try {
  const { message, contactIds, filter, mediaUrl } = req.body as {
    message: string;
    contactIds?: string[];
    filter?: { source?: string; status?: string };
    mediaUrl?: string;  // MMS image URL
  };

  if (!message?.trim()) { res.status(400).json({ error: 'Message is required' }); return; }

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID, AGENT_NAME, AGENT_PHONE } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_CALLER_ID) {
    res.status(500).json({ error: 'Twilio not configured' }); return;
  }

  // Resolve contacts
  let contacts;
  if (contactIds && contactIds.length > 0) {
    contacts = await prisma.contact.findMany({ where: { id: { in: contactIds }, NOT: { status: 'dnc' } } });
  } else {
    contacts = await prisma.contact.findMany({
      where: {
        NOT: { status: 'dnc' },
        ...(filter?.source ? { source: filter.source } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
    });
  }

  if (contacts.length === 0) { res.status(400).json({ error: 'No eligible contacts' }); return; }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const results = { sent: 0, failed: 0, errors: [] as string[] };

  for (const contact of contacts) {
    try {
      const body = interpolate(message, {
        firstName:  contact.firstName,
        fullName:   `${contact.firstName} ${contact.lastName}`.trim(),
        lastName:   contact.lastName,
        address:    contact.address || 'your property',
        city:       contact.city || '',
        agentName:  AGENT_NAME || 'Braddock',
        agentPhone: AGENT_PHONE || TWILIO_CALLER_ID,
      });

      const msgParams: any = {
        body,
        from: TWILIO_CALLER_ID,
        to:   contact.phone!,
        statusCallback: `${process.env.NGROK_URL}/api/twilio/sms-status`,
      };
      if (mediaUrl) msgParams.mediaUrl = [mediaUrl];

      const msg = await client.messages.create(msgParams);

      // Log as outbound message
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

      results.sent++;
      // Rate limit: 1 per 100ms to avoid Twilio throttling
      await new Promise(r => setTimeout(r, 100));
    } catch (err: any) {
      results.failed++;
      results.errors.push(`${contact.phone}: ${err.message}`);
    }
  }

  res.json({ ...results, total: contacts.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/blast/ab-send — A/B test two message variants (50/50 split)
router.post('/ab-send', async (req: Request, res: Response) => {
  try {
  const { messageA, messageB, filter, mediaUrl } = req.body as {
    messageA: string;
    messageB: string;
    filter?: { source?: string; status?: string };
    mediaUrl?: string;
  };

  if (!messageA?.trim() || !messageB?.trim()) {
    res.status(400).json({ error: 'Both message variants required' }); return;
  }

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID, AGENT_NAME, AGENT_PHONE } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_CALLER_ID) {
    res.status(500).json({ error: 'Twilio not configured' }); return;
  }

  const contacts = await prisma.contact.findMany({
    where: {
      NOT: { status: 'dnc' },
      ...(filter?.source ? { source: filter.source } : {}),
      ...(filter?.status ? { status: filter.status } : {}),
    },
  });

  if (contacts.length === 0) { res.status(400).json({ error: 'No eligible contacts' }); return; }

  // Shuffle and split 50/50
  const shuffled = [...contacts].sort(() => Math.random() - 0.5);
  const midpoint = Math.floor(shuffled.length / 2);
  const groupA = shuffled.slice(0, midpoint);
  const groupB = shuffled.slice(midpoint);

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  const sendGroup = async (contacts: typeof groupA, template: string) => {
    let sent = 0; let failed = 0;
    for (const contact of contacts) {
      try {
        const body = interpolate(template, {
          firstName: contact.firstName,
          fullName:  `${contact.firstName} ${contact.lastName}`.trim(),
          lastName:  contact.lastName,
          address:   contact.address || 'your property',
          city:      contact.city || '',
          agentName: AGENT_NAME || 'Braddock',
          agentPhone: AGENT_PHONE || TWILIO_CALLER_ID,
        });
        const params: any = { body, from: TWILIO_CALLER_ID, to: contact.phone! };
        if (mediaUrl) params.mediaUrl = [mediaUrl];
        const msg = await client.messages.create(params);
        await prisma.message.create({
          data: { contactId: contact.id, direction: 'outbound', body,
                  fromNumber: TWILIO_CALLER_ID, toNumber: contact.phone!,
                  twilioSid: msg.sid, status: 'sent' },
        });
        sent++;
        await new Promise(r => setTimeout(r, 100));
      } catch { failed++; }
    }
    return { sent, failed };
  };

  const [resultsA, resultsB] = await Promise.all([
    sendGroup(groupA, messageA),
    sendGroup(groupB, messageB),
  ]);

  res.json({
    a: { ...resultsA, total: groupA.length, message: messageA },
    b: { ...resultsB, total: groupB.length, message: messageB },
  });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/blast/preview
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { message, filter } = req.body;
    const { AGENT_NAME, AGENT_PHONE, TWILIO_CALLER_ID } = process.env;

    const count = await prisma.contact.count({
      where: {
        NOT: { status: 'dnc' },
        ...(filter?.source ? { source: filter.source } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
    });

    const sample = await prisma.contact.findFirst({
      where: { NOT: { status: 'dnc' } },
    });

    const preview = sample
      ? interpolate(message, {
          firstName:  sample.firstName,
          fullName:   `${sample.firstName} ${sample.lastName}`.trim(),
          lastName:   sample.lastName,
          address:    sample.address || 'your property',
          city:       sample.city || '',
          agentName:  AGENT_NAME || 'Braddock',
          agentPhone: AGENT_PHONE || TWILIO_CALLER_ID || '',
        })
      : message;

    res.json({ count, preview });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
