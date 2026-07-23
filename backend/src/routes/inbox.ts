import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { getTwilioClient } from '../twilioClient';
import prisma from '../db';
import { io } from '../socket';
import { runInboxAgent } from '../agent/engine';

const router = Router();

// GET /api/inbox — list conversations (one per contact, latest message first)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const messages = await prisma.message.findMany({
      orderBy: { sentAt: 'desc' },
      include: { contact: true },
    });

    // Group by contact phone / toNumber
    const threads = new Map<string, any>();
    for (const msg of messages) {
      const key = msg.contactId || (msg.direction === 'inbound' ? msg.fromNumber : msg.toNumber);
      if (!threads.has(key)) {
        threads.set(key, {
          contactId:   msg.contactId,
          contact:     msg.contact,
          phone:       msg.direction === 'inbound' ? msg.fromNumber : msg.toNumber,
          lastMessage: msg,
          unread:      msg.direction === 'inbound' ? 1 : 0,
        });
      } else {
        if (msg.direction === 'inbound') threads.get(key).unread++;
      }
    }

    res.json(Array.from(threads.values()));
  } catch (e: any) {
    console.error('[inbox] GET /:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/inbox/:contactId — full thread for a contact
router.get('/:contactId', async (req: Request, res: Response) => {
  try {
    const messages = await prisma.message.findMany({
      where: { contactId: req.params.contactId },
      orderBy: { sentAt: 'asc' },
    });
    res.json(messages);
  } catch (e: any) {
    console.error('[inbox] GET /:contactId:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/inbox/:contactId/reply — send SMS to a contact
router.post('/:contactId/reply', async (req: Request, res: Response) => {
  const { body } = req.body;
  if (!body?.trim()) { res.status(400).json({ error: 'Body required' }); return; }

  const contact = await prisma.contact.findUnique({ where: { id: req.params.contactId } });
  if (!contact) { res.status(404).json({ error: 'Contact not found' }); return; }

  const userId = (req as any).user?.id as string | undefined;
  const { client, creds: inboxCreds } = await getTwilioClient(userId);
  const TWILIO_CALLER_ID = inboxCreds.callerId;

  const msg = await client.messages.create({
    body,
    from: TWILIO_CALLER_ID!,
    to:   contact.phone!,
  });

  const saved = await prisma.message.create({
    data: {
      contactId:  contact.id,
      direction:  'outbound',
      body,
      fromNumber: TWILIO_CALLER_ID!,
      toNumber:   contact.phone!,
      twilioSid:  msg.sid,
      status:     'sent',
    },
  });

  res.status(201).json(saved);
});

// POST /api/twilio/sms-inbound — Twilio webhook for incoming SMS
export async function handleInboundSms(req: Request, res: Response) {
  const { From, To, Body, MessageSid } = req.body;
  console.log(`[SMS] Inbound from ${From}: ${Body}`);

  const contact = await prisma.contact.findFirst({ where: { phone: From } });

  // ── STOP / Opt-out compliance (TCPA) ─────────────────────────────────────
  const STOP_KEYWORDS = ['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'];
  const START_KEYWORDS = ['START','YES','UNSTOP'];
  const normalized = Body.trim().toUpperCase();

  if (STOP_KEYWORDS.includes(normalized)) {
    console.log(`[OPT-OUT] ${From} opted out — marking DNC`);
    if (contact) {
      await prisma.contact.update({ where: { id: contact.id }, data: { status: 'dnc' } });
    }
    await prisma.message.create({
      data: { contactId: contact?.id || null, direction: 'inbound', body: Body,
              fromNumber: From, toNumber: To, twilioSid: MessageSid, status: 'received' },
    });
    const MessagingResponse = twilio.twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    twiml.message('You have been unsubscribed and will receive no further messages from this number. Reply START to resubscribe.');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  if (START_KEYWORDS.includes(normalized)) {
    console.log(`[OPT-IN] ${From} re-opted in`);
    if (contact && contact.status === 'dnc') {
      await prisma.contact.update({ where: { id: contact.id }, data: { status: 'new' } });
    }
    await prisma.message.create({
      data: { contactId: contact?.id || null, direction: 'inbound', body: Body,
              fromNumber: From, toNumber: To, twilioSid: MessageSid, status: 'received' },
    });
    const MessagingResponse = twilio.twiml.MessagingResponse;
    const twiml = new MessagingResponse();
    twiml.message('You have been resubscribed and will receive messages again. Reply STOP to unsubscribe at any time.');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // ── Regular inbound message ───────────────────────────────────────────────
  const saved = await prisma.message.create({
    data: {
      contactId:  contact?.id || null,
      direction:  'inbound',
      body:       Body,
      fromNumber: From,
      toNumber:   To,
      twilioSid:  MessageSid,
      status:     'received',
    },
  });

  // Update lastReplyAt on contact for lead scoring
  if (contact) {
    await prisma.contact.update({ where: { id: contact.id }, data: { lastReplyAt: new Date() } });
  }

  // ── Fire the autonomous agent (non-blocking so Twilio gets an instant reply) ─
  if (contact) {
    runInboxAgent(contact.id, { source: 'inbox-agent' })
      .catch((e) => console.warn('[Agent] inbound trigger failed:', e?.message || e));
  }

  // ── Emit real-time notification ───────────────────────────────────────────
  try {
    io.emit('new-sms', {
      id:          saved.id,
      from:        From,
      body:        Body,
      contactId:   contact?.id || null,
      contactName: contact ? `${contact.firstName} ${contact.lastName}` : From,
      sentAt:      saved.sentAt,
    });
  } catch { /* socket may not be init yet */ }

  res.type('text/xml').send('<Response/>');
}

export default router;
