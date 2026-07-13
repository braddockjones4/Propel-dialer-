import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import crypto from 'crypto';
import { pickCallerId } from './localPresence';

const router = Router();

// ─── In-memory session store ──────────────────────────────────────────────────
interface TripleSession {
  calls: Array<{
    sid: string;
    contactId: string;
    phone: string;
    firstName: string;
    name: string;
    status: 'initiated' | 'ringing' | 'connected' | 'cancelled' | 'failed' | 'machine';
  }>;
  connectedSid: string | null;
  createdAt: number;
}

const sessions = new Map<string, TripleSession>();

// Cleanup old sessions (>5min) to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
}, 60_000);

// ─── POST /api/triple-dial/start ─────────────────────────────────────────────
// Initiates 3 simultaneous outbound calls
router.post('/start', async (req: Request, res: Response) => {
  const { contacts } = req.body as {
    contacts: Array<{ phone: string; contactId: string; firstName: string; name: string }>;
  };

  if (!contacts || contacts.length === 0) {
    res.status(400).json({ error: 'Contacts required' }); return;
  }

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID, NGROK_URL } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_CALLER_ID || !NGROK_URL) {
    res.status(500).json({ error: 'Twilio not configured' }); return;
  }

  const sessionId = crypto.randomUUID();
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  const callRecords: TripleSession['calls'] = [];

  for (const contact of contacts.slice(0, 3)) {
    try {
      const localCallerId = await pickCallerId(contact.phone).catch(() => TWILIO_CALLER_ID!);
      const call = await client.calls.create({
        to:   contact.phone,
        from: localCallerId,
        url:  `${NGROK_URL}/api/triple-dial/twiml?sessionId=${sessionId}&contactId=${encodeURIComponent(contact.contactId)}`,
        statusCallback:       `${NGROK_URL}/api/triple-dial/status-update`,
        statusCallbackMethod: 'POST',
        statusCallbackEvent:  ['initiated', 'ringing', 'answered', 'completed'],
        machineDetection:           'Enable',
        asyncAmdStatusCallback:       `${NGROK_URL}/api/triple-dial/amd`,
        asyncAmdStatusCallbackMethod: 'POST',
      } as any);

      callRecords.push({
        sid:       call.sid,
        contactId: contact.contactId,
        phone:     contact.phone,
        firstName: contact.firstName,
        name:      contact.name,
        status:    'initiated',
      });
    } catch (err: any) {
      console.error(`[Triple] Failed to call ${contact.phone}:`, err.message);
      callRecords.push({
        sid:       `failed-${Date.now()}`,
        contactId: contact.contactId,
        phone:     contact.phone,
        firstName: contact.firstName,
        name:      contact.name,
        status:    'failed',
      });
    }
  }

  sessions.set(sessionId, { calls: callRecords, connectedSid: null, createdAt: Date.now() });
  console.log(`[Triple] Session ${sessionId} — ${callRecords.length} calls initiated`);

  res.json({ sessionId, calls: callRecords });
});

// ─── GET /api/triple-dial/session/:id ────────────────────────────────────────
// Frontend polls this to know which call connected
router.get('/session/:id', (req: Request, res: Response) => {
  const session = sessions.get(req.params.id);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  res.json(session);
});

// ─── POST /api/triple-dial/twiml ─────────────────────────────────────────────
// Called when a contact answers — connects them to the agent browser
router.post('/twiml', (req: Request, res: Response) => {
  const { sessionId } = req.query as { sessionId: string; contactId: string };
  const { CallSid } = req.body;

  const session = sessions.get(sessionId);
  if (session) {
    // Mark this call as connected if nothing else is yet
    if (!session.connectedSid) {
      session.connectedSid = CallSid;
      const callRecord = session.calls.find(c => c.sid === CallSid);
      if (callRecord) callRecord.status = 'connected';

      // Cancel the other calls async
      const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      for (const c of session.calls) {
        if (c.sid !== CallSid && !c.sid.startsWith('failed') && c.status !== 'cancelled') {
          c.status = 'cancelled';
          client.calls(c.sid).update({ status: 'completed' }).catch(err =>
            console.error(`[Triple] Failed to cancel ${c.sid}:`, err.message)
          );
        }
      }
    } else {
      // Another call connected but we already have one — hang this one up
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.hangup();
      res.type('text/xml').send(twiml.toString());
      return;
    }
  }

  // Connect to agent browser client
  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial({ callerId: process.env.TWILIO_CALLER_ID || '' });
  dial.client('agent');

  res.type('text/xml').send(twiml.toString());
});

// ─── POST /api/triple-dial/amd ───────────────────────────────────────────────
// AMD result for triple-dial calls
router.post('/amd', async (req: Request, res: Response) => {
  const { CallSid, AnsweredBy } = req.body;
  console.log(`[Triple AMD] ${CallSid} — ${AnsweredBy}`);

  const isMachine = ['machine_end_beep', 'machine_end_silence', 'machine_end_other', 'machine_start'].includes(AnsweredBy);

  if (isMachine) {
    // Find session for this call
    for (const [, session] of sessions.entries()) {
      const callRecord = session.calls.find(c => c.sid === CallSid);
      if (callRecord) {
        callRecord.status = 'machine';
        // Drop voicemail then end call
        try {
          const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, AGENT_NAME, AGENT_PHONE } = process.env;
          const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
          const vmScript = `Hi ${callRecord.firstName}, this is ${AGENT_NAME || 'Braddock'} calling about your property. Please call me back at ${AGENT_PHONE || 'my office'}. Thank you!`;
          const dropTwiml = `<Response><Say voice="Polly.Joanna">${vmScript}</Say><Hangup/></Response>`;
          await client.calls(CallSid).update({ twiml: dropTwiml });
        } catch (err: any) {
          console.error('[Triple AMD] VM drop failed:', err.message);
        }
        break;
      }
    }
  }

  res.sendStatus(204);
});

// ─── POST /api/triple-dial/status-update ─────────────────────────────────────
// Call status webhook — track ringing/completed
router.post('/status-update', (req: Request, res: Response) => {
  const { CallSid, CallStatus } = req.body;

  for (const [, session] of sessions.entries()) {
    const callRecord = session.calls.find(c => c.sid === CallSid);
    if (callRecord) {
      if (CallStatus === 'ringing')   callRecord.status = 'ringing';
      if (CallStatus === 'no-answer' || CallStatus === 'busy' || CallStatus === 'failed') {
        callRecord.status = 'failed';
      }
      break;
    }
  }

  res.sendStatus(204);
});

// ─── POST /api/triple-dial/cancel ────────────────────────────────────────────
// Cancel all calls in a session (agent skips)
router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (!session) { res.sendStatus(204); return; }

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    for (const c of session.calls) {
      if (!c.sid.startsWith('failed') && c.status !== 'cancelled') {
        c.status = 'cancelled';
        client.calls(c.sid).update({ status: 'completed' }).catch(() => {});
      }
    }

    sessions.delete(sessionId);
    res.json({ cancelled: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
