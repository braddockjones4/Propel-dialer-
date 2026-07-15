// ─── Sequential Dialer ────────────────────────────────────────────────────────
// Single-contact dialer with two call modes:
//   webrtc  — browser handles audio via Twilio Device (existing token flow)
//   bridge  — Twilio calls agent's personal cell, then bridges to contact
//             via a conference room with AMD + pre-recorded voicemail drop
//
// Bridge call flow:
//   1. POST /call       → Twilio calls agent's personal phone (Leg A)
//   2. /bridge-a-twiml  → Agent picks up → plays "Calling [Name]…" → joins conf
//   3. /bridge-a-status → Twilio fires "in-progress" → backend creates Leg B (contact)
//                         with AMD enabled
//   4. /bridge-b-twiml  → Contact picks up → joins same conference (connected!)
//   5. /bridge-amd      → AMD result:
//        human   → already connected via conference (do nothing extra)
//        machine → play voicemail on Leg B, say "VM dropped" to Leg A, both hangup
//
// Voicemail recording:
//   POST /record-vm → Twilio calls agent's phone → agent speaks → presses #
//   → /vm-done fires → saves Twilio recording URL to DialerSettings

import express, { Router, Request, Response } from 'express';
import twilio from 'twilio';
import crypto from 'crypto';
import prisma from '../db';
import { pickCallerId } from './localPresence';
import { io } from '../socket';
import { getAgentName } from '../agent/settings';

const router = Router();       // auth-protected endpoints
export const webhooks = Router(); // public Twilio webhook endpoints (no auth)

function BACKEND() {
  return process.env.BACKEND_URL || process.env.NGROK_URL || 'https://propel-dialer-backend.onrender.com';
}

function twilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) throw new Error('Twilio not configured');
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// ─── In-memory bridge session store ──────────────────────────────────────────
export interface BridgeSession {
  contactId: string;
  contactPhone: string;
  contactName: string;
  confName: string;
  agentCallSid: string | null;
  contactCallSid: string | null;
  userId: string;         // owner — used to scope settings in webhooks
  voicemailUrl: string | null; // pre-loaded so AMD never needs a DB round-trip
  status: 'waiting-agent' | 'calling-contact' | 'connected' | 'vm-dropped' | 'no-answer' | 'ended';
  createdAt: number;
}
export const bridges = new Map<string, BridgeSession>();
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, b] of bridges) if (b.createdAt < cutoff) bridges.delete(id);
}, 60_000);

// ─── GET /api/dialer/settings ─────────────────────────────────────────────────
router.get('/settings', async (req: Request, res: Response) => {
  try {
  const userId = (req as any).user?.id as string;
  const s = await prisma.dialerSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });

  // Derive voicemailReady without sending the (potentially multi-MB) voicemailData blob.
  // true  = stored audio is WAV or MP3 → Twilio can play it
  // false = stored audio is webm (pre-WAV-fix recording) → user should re-record
  // null  = no browser recording stored (might have a legacy Twilio URL via voicemailUrl)
  let voicemailReady: boolean | null = null;
  if (s.voicemailData) {
    const mimeType = s.voicemailData.match(/^data:([^;]+)/)?.[1] || '';
    voicemailReady = mimeType === 'audio/wav' || mimeType.startsWith('audio/mp');
  } else if (s.voicemailUrl) {
    // Legacy Twilio recording — assume playable (mp3)
    voicemailReady = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { voicemailData: _omit, ...rest } = s as any;
  res.json({ ...rest, voicemailReady });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── PUT /api/dialer/settings ─────────────────────────────────────────────────
router.put('/settings', async (req: Request, res: Response) => {
  try {
  const userId = (req as any).user?.id as string;
  const { callMode, personalPhone, voicemailUrl, voicemailSid } = req.body;
  const s = await prisma.dialerSettings.upsert({
    where: { userId },
    create: { userId, callMode, personalPhone, voicemailUrl, voicemailSid },
    update: {
      ...(callMode !== undefined && { callMode }),
      // Reset phoneVerified if the phone number changes
      ...(personalPhone !== undefined && { personalPhone, phoneVerified: false }),
      ...(voicemailUrl !== undefined && { voicemailUrl }),
      ...(voicemailSid !== undefined && { voicemailSid }),
    },
  });
  res.json(s);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── POST /api/dialer/verify-phone ───────────────────────────────────────────
// Triggers a Twilio call to verify the user's personal phone as a caller ID.
// Twilio calls the number and reads a code — user presses keys to confirm.
router.post('/verify-phone', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string;
  const { phone } = req.body;
  if (!phone) { res.status(400).json({ error: 'phone required' }); return; }

  // Normalize to E.164
  const digits = phone.replace(/\D/g, '');
  const e164 = digits.startsWith('1') ? `+${digits}` : `+1${digits}`;

  const client = twilioClient();

  // Check if already verified in Twilio
  try {
    const existing = await client.outgoingCallerIds.list({ phoneNumber: e164 });
    if (existing.length > 0) {
      await prisma.dialerSettings.upsert({
        where: { userId },
        create: { userId, personalPhone: e164, phoneVerified: true },
        update: { personalPhone: e164, phoneVerified: true },
      });
      res.json({ status: 'already-verified', verified: true });
      return;
    }
  } catch (_) { /* not in list yet — proceed to verification */ }

  // Start Twilio verification call
  try {
    // Twilio will call the number and speak a code; user presses keys to confirm
    const vr = await (client as any).outgoingCallerIds.create({
      phoneNumber: e164,
      friendlyName: 'Propel Dialer',
    });
    await prisma.dialerSettings.upsert({
      where: { userId },
      create: { userId, personalPhone: e164, phoneVerified: false },
      update: { personalPhone: e164, phoneVerified: false },
    });
    res.json({ status: 'calling', validationCode: vr.validationCode });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/dialer/verify-status ───────────────────────────────────────────
// Poll to check if personalPhone has been verified in Twilio.
router.get('/verify-status', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string;
  const settings = await prisma.dialerSettings.findUnique({ where: { userId } });
  if (!settings?.personalPhone) { res.json({ verified: false }); return; }
  if (settings.phoneVerified) { res.json({ verified: true, phone: settings.personalPhone }); return; }

  try {
    const client = twilioClient();
    const callerIds = await client.outgoingCallerIds.list({ phoneNumber: settings.personalPhone });
    const verified = callerIds.length > 0;
    if (verified) {
      await prisma.dialerSettings.update({ where: { userId }, data: { phoneVerified: true } });
    }
    res.json({ verified, phone: settings.personalPhone });
  } catch (e: any) {
    res.json({ verified: false });
  }
});

// ─── POST /api/dialer/upload-vm ──────────────────────────────────────────────
// Receives a browser-recorded voicemail as base64-encoded JSON and stores in DB.
// Using JSON (not raw binary) avoids conflicts with the global express.json() parser.
router.post('/upload-vm', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id as string;
    const { audio, mimeType: rawMime = 'audio/wav' } = req.body || {};

    if (!audio || typeof audio !== 'string') {
      res.status(400).json({ error: 'No audio data received' }); return;
    }

    const ALLOWED_AUDIO = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg', 'audio/x-wav'];
    const mimeType = ALLOWED_AUDIO.includes(rawMime) ? rawMime : 'audio/wav';

    // Validate decoded size (base64 is ~4/3 raw size, so 10 MB raw ≈ 13.4 MB base64)
    const estimatedBytes = Math.ceil(audio.length * 0.75);
    if (estimatedBytes > 10 * 1024 * 1024) {
      res.status(400).json({ error: 'Voicemail too large (max 10 MB)' }); return;
    }

    // Validate it's actually valid base64
    let buffer: Buffer;
    try {
      buffer = Buffer.from(audio, 'base64');
      if (buffer.length === 0) throw new Error('empty');
    } catch {
      res.status(400).json({ error: 'Invalid audio data' }); return;
    }

    const voicemailData = `data:${mimeType};base64,${audio}`;
    const vmToken = makeVmToken(userId);
    const voicemailUrl = `${BACKEND()}/api/dialer/vm-audio/${userId}?token=${vmToken}`;

    try {
      await prisma.dialerSettings.upsert({
        where: { userId },
        create: { userId, voicemailUrl, voicemailData },
        update: { voicemailUrl, voicemailData },
      });
      io.emit('vm-recorded', { url: voicemailUrl, userId });
      res.json({ url: voicemailUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  }
);

// ─── GET /api/dialer/vm-audio/:userId (public — called by Twilio to play VM) ──
// C3: Protected with HMAC token to prevent unauthenticated enumeration
function makeVmToken(userId: string): string {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'propel-dialer-dev-secret')
    .update(userId).digest('hex').slice(0, 32);
}
function verifyVmToken(userId: string, token: string): boolean {
  const expected = makeVmToken(userId);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token.padEnd(32, '0').slice(0, 32), 'hex'));
}
webhooks.get('/vm-audio/:userId', async (req: Request, res: Response) => {
  const { token } = req.query as { token?: string };
  if (!token || !verifyVmToken(req.params.userId, token)) {
    res.status(403).json({ error: 'Forbidden' }); return;
  }
  const { userId } = req.params;
  const settings = await prisma.dialerSettings.findUnique({ where: { userId } }).catch(() => null);
  if (!settings?.voicemailData) { res.status(404).send('Not found'); return; }

  const [header, base64] = settings.voicemailData.split(',');
  const mimeType = header.match(/data:([^;]+)/)?.[1] || 'audio/webm';
  const buffer = Buffer.from(base64, 'base64');

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // allow <audio> from frontend domain
  res.send(buffer);
});

// ─── POST /api/dialer/vm-play-twiml/:userId (public — called by Twilio) ───────
// Dynamic TwiML endpoint for voicemail drop. Checks audio format at play time:
//   - audio/wav or audio/mpeg → <Play> the stored recording
//   - audio/webm or missing   → <Say> TTS fallback (Twilio can't decode webm)
// AMD handlers use calls(sid).update({ url: this }) so format issues never cause
// a silent drop (agent stuck on machine with no message playing).
webhooks.post('/vm-play-twiml/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  const twiml = new twilio.twiml.VoiceResponse();
  const fallbackText = process.env.VOICEMAIL_SCRIPT ||
    `Hi, this is ${await getAgentName()} calling about your property. ` +
    `Please give me a call back when you get a chance. Thank you!`;

  try {
    const settings = await prisma.dialerSettings.findUnique({ where: { userId } }).catch(() => null);
    const data = settings?.voicemailData;

    if (data) {
      const mimeType = data.match(/^data:([^;]+)/)?.[1] || '';
      const isPlayable = mimeType === 'audio/wav' || mimeType.startsWith('audio/mp');

      if (isPlayable) {
        // Valid format — serve the binary via vm-audio and let Twilio play it
        const audioUrl = `${BACKEND()}/api/dialer/vm-audio/${userId}?token=${makeVmToken(userId)}`;
        console.log(`[vm-play-twiml] Playing recorded VM (${mimeType}) for userId=${userId}`);
        twiml.play(audioUrl);
      } else {
        // Unplayable format (e.g. webm) — fall back to TTS
        console.warn(`[vm-play-twiml] Stored VM is ${mimeType || 'unknown'} — not playable by Twilio, using TTS. User should re-record.`);
        twiml.say({ voice: 'Polly.Joanna' }, fallbackText);
      }
    } else if (settings?.voicemailUrl && !settings.voicemailData) {
      // Legacy Twilio recording URL (stored before browser-recording was added) — still playable
      console.log(`[vm-play-twiml] Playing legacy Twilio recording URL for userId=${userId}`);
      twiml.play(settings.voicemailUrl);
    } else {
      // No recording at all
      console.warn(`[vm-play-twiml] No voicemail configured for userId=${userId}, using TTS`);
      twiml.say({ voice: 'Polly.Joanna' }, fallbackText);
    }
  } catch (e: any) {
    console.error('[vm-play-twiml] Error:', e.message);
    twiml.say({ voice: 'Polly.Joanna' }, fallbackText);
  }

  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// ─── POST /api/dialer/record-vm ───────────────────────────────────────────────
// Legacy: Calls agent's personal phone to record their voicemail greeting.
router.post('/record-vm', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string;
  const { personalPhone } = req.body;
  if (!personalPhone) { res.status(400).json({ error: 'personalPhone required' }); return; }
  const from = process.env.TWILIO_CALLER_ID || process.env.AGENT_PHONE || '';
  if (!from) { res.status(500).json({ error: 'TWILIO_CALLER_ID not set' }); return; }
  try {
    const call = await twilioClient().calls.create({
      to: personalPhone,
      from,
      url: `${BACKEND()}/api/dialer/vm-twiml?userId=${encodeURIComponent(userId)}`,
    });
    res.json({ callSid: call.sid, status: 'calling' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/dialer/vm-twiml (public — called by Twilio) ───────────────────
webhooks.post('/vm-twiml', (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' },
    'After the beep, record your voicemail message. Press pound when done, or wait 60 seconds.');
  twiml.record({
    maxLength: 60,
    finishOnKey: '#',
    action: `${BACKEND()}/api/dialer/vm-done?userId=${encodeURIComponent(userId || '')}`,
    playBeep: true,
  } as any);
  twiml.say({ voice: 'Polly.Joanna' }, 'No recording detected. Goodbye.');
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// ─── POST /api/dialer/vm-done (public — called by Twilio) ────────────────────
webhooks.post('/vm-done', async (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };
  const { RecordingUrl, RecordingSid } = req.body;
  if (RecordingUrl && userId) {
    const url = RecordingUrl.endsWith('.mp3') ? RecordingUrl : `${RecordingUrl}.mp3`;
    await prisma.dialerSettings.upsert({
      where: { userId },
      create: { userId, voicemailUrl: url, voicemailSid: RecordingSid },
      update: { voicemailUrl: url, voicemailSid: RecordingSid },
    });
    io.emit('vm-recorded', { url, userId });
  }
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'Voicemail saved. You can hang up now.');
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// ─── POST /api/dialer/call ────────────────────────────────────────────────────
// Initiate a call. Bridge mode starts the 2-leg flow; webrtc just returns contact info
// (the browser uses the Twilio Device token to handle audio itself).
router.post('/call', async (req: Request, res: Response) => {
  const { contactId, mode } = req.body;
  if (!contactId) { res.status(400).json({ error: 'contactId required' }); return; }

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) { res.status(404).json({ error: 'Contact not found' }); return; }

  if (mode === 'bridge') {
    const userId = (req as any).user?.id as string;
    const settings = await prisma.dialerSettings.findUnique({ where: { userId } });
    if (!settings?.personalPhone) {
      res.status(400).json({ error: 'Enter your personal phone number in dialer settings first.' });
      return;
    }
    if (!settings.phoneVerified) {
      res.status(400).json({ error: 'Verify your personal phone number before making calls.' });
      return;
    }

    const sessionId = crypto.randomUUID();
    const confName = `propel-${sessionId}`;
    const contactName = `${contact.firstName} ${contact.lastName}`.trim();

    if (!contact.phone) { res.status(400).json({ error: 'Contact has no phone number' }); return; }
    bridges.set(sessionId, {
      contactId,
      contactPhone: contact.phone,
      contactName,
      confName,
      agentCallSid: null,
      contactCallSid: null,
      userId,
      voicemailUrl: settings.voicemailUrl ?? null, // pre-loaded — no DB hit in AMD webhook
      status: 'waiting-agent',
      createdAt: Date.now(),
    });

    const from = process.env.TWILIO_CALLER_ID || process.env.AGENT_PHONE || '';
    try {
      const call = await twilioClient().calls.create({
        to: settings.personalPhone,
        from,
        url: `${BACKEND()}/api/dialer/bridge-a-twiml?sessionId=${sessionId}`,
        statusCallback: `${BACKEND()}/api/dialer/bridge-a-status?sessionId=${sessionId}`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      });
      bridges.get(sessionId)!.agentCallSid = call.sid;
      res.json({ sessionId, status: 'ringing-agent', agentCallSid: call.sid });
    } catch (e: any) {
      bridges.delete(sessionId);
      res.status(500).json({ error: e.message });
    }
  } else {
    // WebRTC conference mode — create a bridge session so the /voice webhook
    // can use REST API AMD (the only reliable way to auto-drop voicemails).
    // The browser joins a named conference; the backend dials the contact with AMD.
    const userId = (req as any).user?.id as string;
    const settings = await prisma.dialerSettings.findUnique({ where: { userId } }).catch(() => null);

    const sessionId = crypto.randomUUID();
    const confName  = `propel-webrtc-${sessionId}`;
    const contactName = `${contact.firstName} ${contact.lastName}`.trim();

    if (!contact.phone) { res.status(400).json({ error: 'Contact has no phone number' }); return; }
    bridges.set(sessionId, {
      contactId,
      contactPhone: contact.phone,
      contactName,
      confName,
      agentCallSid: null,   // set by /voice webhook when browser connects
      contactCallSid: null,  // set by /voice webhook when outbound call is created
      userId,
      voicemailUrl: settings?.voicemailUrl ?? null,
      status: 'waiting-agent',
      createdAt: Date.now(),
    });

    res.json({
      mode: 'webrtc',
      sessionId,
      confName,
      contact: {
        id: contact.id,
        phone: contact.phone,
        name: contactName,
      },
    });
  }
});

// ─── POST /api/dialer/bridge-a-twiml (public) ────────────────────────────────
// TwiML for agent's personal phone (Leg A). Agent hears contact name then waits in conf.
webhooks.post('/bridge-a-twiml', (req: Request, res: Response) => {
  const { sessionId } = req.query as { sessionId: string };
  const b = bridges.get(sessionId);
  const twiml = new twilio.twiml.VoiceResponse();

  if (!b) {
    twiml.say('Session expired.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    return;
  }

  twiml.say({ voice: 'Polly.Joanna' }, `Calling ${b.contactName} now.`);
  const dial = twiml.dial({
    action: `${BACKEND()}/api/dialer/bridge-a-done?sessionId=${sessionId}`,
  });
  (dial as any).conference(b.confName, {
    startConferenceOnEnter: 'true',
    endConferenceOnExit: 'false',
    waitUrl: 'https://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
    beep: 'false',
  });
  res.type('text/xml').send(twiml.toString());
});

// ─── POST /api/dialer/bridge-a-status (public) ───────────────────────────────
// Status webhook for agent leg. When in-progress → dial the contact.
webhooks.post('/bridge-a-status', async (req: Request, res: Response) => {
  const { sessionId } = req.query as { sessionId: string };
  const { CallStatus, CallSid } = req.body;
  const b = bridges.get(sessionId);

  if (!b) { res.sendStatus(204); return; }

  if (CallStatus === 'in-progress' && b.status === 'waiting-agent') {
    b.status = 'calling-contact';
    b.agentCallSid = CallSid;
    io.emit('bridge-status', { sessionId, status: 'calling-contact', contactName: b.contactName });

    // Dial the contact (Leg B) with AMD
    // Use agent's verified personal phone as caller ID.
    // Falls back to local presence number if personal phone isn't set/verified.
    const settings = await prisma.dialerSettings.findUnique({ where: { userId: b.userId } });
    const localFrom = await pickCallerId(b.contactPhone).catch(() => process.env.TWILIO_CALLER_ID || '');
    const contactFrom = (settings?.phoneVerified && settings?.personalPhone) ? settings.personalPhone : localFrom;

    try {
      const contactCall = await twilioClient().calls.create({
        to: b.contactPhone,
        from: contactFrom,
        machineDetection: 'DetectMessageEnd', // SYNC: Twilio calls url after beep with AnsweredBy
        // Embed userId/confName/agentCallSid in URL so bridge-b-twiml works even
        // if a rolling deploy routes the callback to a fresh server instance.
        url: `${BACKEND()}/api/dialer/bridge-b-twiml?sessionId=${sessionId}&userId=${encodeURIComponent(b.userId)}&confName=${encodeURIComponent(b.confName)}&agentCallSid=${encodeURIComponent(b.agentCallSid || '')}`,
        statusCallback: `${BACKEND()}/api/dialer/bridge-b-status?sessionId=${sessionId}`,
        statusCallbackEvent: ['answered', 'completed', 'no-answer', 'busy', 'failed'],
        statusCallbackMethod: 'POST',
      } as any);
      b.contactCallSid = contactCall.sid;
    } catch (e: any) {
      console.error('[Bridge] Failed to call contact:', e.message);
      b.status = 'ended';
      // Notify agent
      try {
        await twilioClient().calls(b.agentCallSid!).update({
          twiml: '<Response><Say voice="Polly.Joanna">Could not reach the contact. Goodbye.</Say><Hangup/></Response>',
        });
      } catch {}
      io.emit('bridge-status', { sessionId, status: 'error', error: e.message });
    }
  }

  if ((CallStatus === 'completed' || CallStatus === 'failed') && b.agentCallSid === CallSid) {
    // Agent hung up — end contact call if still going
    if (b.contactCallSid && b.status === 'connected') {
      try { await twilioClient().calls(b.contactCallSid).update({ status: 'completed' }); } catch {}
    }
    b.status = 'ended';
    io.emit('bridge-status', { sessionId, status: 'ended' });
  }

  res.sendStatus(204);
});

// ─── POST /api/dialer/bridge-b-twiml (public) ────────────────────────────────
// TwiML for contact (Leg B). Called by Twilio once AMD has a result (SYNC AMD).
//
// With machineDetection: 'DetectMessageEnd', Twilio waits for the full voicemail
// greeting + beep before fetching this URL, then includes AnsweredBy in the body.
//   AnsweredBy = 'human'              → join conference (live caller)
//   AnsweredBy = 'machine_end_beep'  → play pre-recorded voicemail inline
//   AnsweredBy = undefined            → fallback to conference join
webhooks.post('/bridge-b-twiml', async (req: Request, res: Response) => {
  const { sessionId } = req.query as { sessionId: string };
  // URL params are embedded at call-creation time so this webhook works even
  // when a rolling deploy routes the callback to a fresh server instance.
  const urlUserId       = req.query.userId       as string | undefined;
  const urlConfName     = req.query.confName     as string | undefined;
  const urlAgentCallSid = req.query.agentCallSid as string | undefined;

  const b = bridges.get(sessionId);
  const twiml = new twilio.twiml.VoiceResponse();
  const answeredBy = req.body.AnsweredBy as string | undefined;

  // Resolve: prefer live session, fall back to URL-embedded params
  const effectiveUserId       = b?.userId       || urlUserId       || null;
  const effectiveConfName     = b?.confName     || urlConfName     || null;
  const effectiveAgentCallSid = b?.agentCallSid || urlAgentCallSid || null;

  console.log(`[bridge-b-twiml] ▶ session=${sessionId} | AnsweredBy=${answeredBy || 'none'} | sessionFound=${!!b} | userId=${effectiveUserId || 'unknown'}`);

  if (!effectiveConfName) {
    console.error(`[bridge-b-twiml] ✗ No session or URL params — cannot proceed`);
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // ── Machine detected → drop voicemail ──────────────────────────────────────
  const isMachine = answeredBy && ['machine_end_beep', 'machine_end_silence', 'machine_end_other'].includes(answeredBy);

  if (isMachine) {
    if (b) { b.status = 'vm-dropped'; }
    io.emit('bridge-status', { sessionId, status: 'vm-dropped', contactName: b?.contactName });

    const fallbackText = process.env.VOICEMAIL_SCRIPT ||
      `Hi, this is ${process.env.AGENT_NAME || 'your agent'} calling about your property. ` +
      `Please give me a call back when you get a chance. Thank you!`;

    try {
      const settings = effectiveUserId
        ? await prisma.dialerSettings.findUnique({
            where:  { userId: effectiveUserId },
            select: { voicemailData: true, voicemailUrl: true },
          })
        : null;
      if (settings?.voicemailData) {
        const mimeType   = settings.voicemailData.match(/^data:([^;]+)/)?.[1] || '';
        const isPlayable = mimeType === 'audio/wav' || mimeType.startsWith('audio/mp');
        if (isPlayable && settings.voicemailUrl) {
          console.log(`[bridge-b-twiml] ✓ Playing WAV voicemail: ${settings.voicemailUrl}`);
          twiml.play(settings.voicemailUrl);
        } else {
          console.warn(`[bridge-b-twiml] ⚠ voicemail is ${mimeType || 'unknown'} — using TTS. Re-record in WAV format.`);
          twiml.say({ voice: 'Polly.Joanna' }, fallbackText);
        }
      } else if (settings?.voicemailUrl) {
        console.log(`[bridge-b-twiml] ✓ Playing legacy voicemail URL: ${settings.voicemailUrl}`);
        twiml.play(settings.voicemailUrl);
      } else {
        console.warn(`[bridge-b-twiml] ⚠ No voicemail configured — using TTS`);
        twiml.say({ voice: 'Polly.Joanna' }, fallbackText);
      }
    } catch (e: any) {
      console.error(`[bridge-b-twiml] DB error: ${e.message} — using TTS`);
      twiml.say({ voice: 'Polly.Joanna' }, fallbackText);
    }
    twiml.hangup();

    // Notify the agent that voicemail was dropped so they can move on
    if (effectiveAgentCallSid) {
      try {
        await twilioClient().calls(effectiveAgentCallSid).update({
          twiml: '<Response><Say voice="Polly.Joanna">Voicemail dropped. Moving to next contact.</Say><Hangup/></Response>',
        });
      } catch {}
    }

    res.type('text/xml').send(twiml.toString());
    return;
  }

  // ── Human (or AMD timed out) → join conference ──────────────────────────────
  if (b) {
    if (b.status === 'calling-contact') {
      b.status = 'connected';
      io.emit('bridge-status', { sessionId, status: 'connected', contactName: b.contactName });
    }
  }

  const dial = twiml.dial({
    action: `${BACKEND()}/api/dialer/bridge-b-done?sessionId=${sessionId}`,
  });
  (dial as any).conference(effectiveConfName, {
    startConferenceOnEnter: 'true',
    endConferenceOnExit: 'true',
    beep: 'false',
  });
  res.type('text/xml').send(twiml.toString());
});

// ─── POST /api/dialer/bridge-amd (public) ────────────────────────────────────
// AMD result for the contact leg (Leg B).
webhooks.post('/bridge-amd', async (req: Request, res: Response) => {
  const { sessionId } = req.query as { sessionId: string };
  const { AnsweredBy, CallSid } = req.body;
  const b = bridges.get(sessionId);

  console.log(`[Bridge AMD] ▶ session=${sessionId} | AnsweredBy=${AnsweredBy} | CallSid=${CallSid} | sessionFound=${!!b}`);

  const isMachine = ['machine_end_beep', 'machine_end_silence', 'machine_end_other'].includes(AnsweredBy);

  if (!isMachine) {
    console.log(`[Bridge AMD] Human detected — no action needed`);
    res.sendStatus(204);
    return;
  }

  if (!b) {
    console.error(`[Bridge AMD] ✗ session ${sessionId} not found in bridges map — cannot drop voicemail`);
    res.sendStatus(204);
    return;
  }

  b.status = 'vm-dropped';
  io.emit('bridge-status', { sessionId, status: 'vm-dropped', contactName: b.contactName });

  // Build voicemail TwiML INLINE (no URL fetch = no Render cold-start timeout).
  // Check voicemailData format from DB to decide Play vs TTS.
  const fallbackText = process.env.VOICEMAIL_SCRIPT ||
    `Hi, this is ${await getAgentName()} calling about your property. ` +
    `Please give me a call back when you get a chance. Thank you!`;

  let vmTwiml: string;
  try {
    const settings = await prisma.dialerSettings.findUnique({
      where:  { userId: b.userId },
      select: { voicemailData: true, voicemailUrl: true },
    });

    if (settings?.voicemailData) {
      const mimeType   = settings.voicemailData.match(/^data:([^;]+)/)?.[1] || '';
      const isPlayable = mimeType === 'audio/wav' || mimeType.startsWith('audio/mp');
      if (isPlayable && settings.voicemailUrl) {
        console.log(`[Bridge AMD] ✓ Playing WAV recording: ${settings.voicemailUrl}`);
        vmTwiml = `<Response><Play>${settings.voicemailUrl}</Play><Hangup/></Response>`;
      } else {
        console.warn(`[Bridge AMD] ⚠ voicemailData is ${mimeType || 'unknown'} — Twilio can't play this format, using TTS. Re-record the voicemail.`);
        vmTwiml = `<Response><Say voice="Polly.Joanna">${fallbackText}</Say><Hangup/></Response>`;
      }
    } else if (settings?.voicemailUrl) {
      // Legacy Twilio phone recording (mp3 URL) — still playable
      console.log(`[Bridge AMD] ✓ Playing legacy recording URL: ${settings.voicemailUrl}`);
      vmTwiml = `<Response><Play>${settings.voicemailUrl}</Play><Hangup/></Response>`;
    } else {
      console.warn(`[Bridge AMD] ⚠ No voicemail recording found for userId=${b.userId} — using TTS`);
      vmTwiml = `<Response><Say voice="Polly.Joanna">${fallbackText}</Say><Hangup/></Response>`;
    }
  } catch (e: any) {
    console.error(`[Bridge AMD] DB lookup failed: ${e.message} — using TTS fallback`);
    vmTwiml = `<Response><Say voice="Polly.Joanna">${fallbackText}</Say><Hangup/></Response>`;
  }

  // Update the contact's live call with the voicemail TwiML
  console.log(`[Bridge AMD] Calling calls(${CallSid}).update() with inline TwiML...`);
  try {
    await twilioClient().calls(CallSid).update({ twiml: vmTwiml });
    console.log(`[Bridge AMD] ✓ calls.update() succeeded — voicemail TwiML sent`);
  } catch (e: any) {
    console.error(`[Bridge AMD] ✗ calls.update() FAILED: ${e.message}`);
  }

  // Disconnect agent leg
  try {
    if (b.agentCallSid) {
      await twilioClient().calls(b.agentCallSid).update({
        twiml: '<Response><Say voice="Polly.Joanna">Voicemail dropped. Moving to next contact.</Say><Hangup/></Response>',
      });
    }
  } catch {}

  res.sendStatus(204);
});

// ─── POST /api/dialer/bridge-b-status (public) ───────────────────────────────
// Contact leg status — detect no-answer / busy.
webhooks.post('/bridge-b-status', async (req: Request, res: Response) => {
  const { sessionId } = req.query as { sessionId: string };
  const { CallStatus, CallSid } = req.body;
  const b = bridges.get(sessionId);
  console.log(`[bridge-b-status] session=${sessionId} | status=${CallStatus} | sid=${CallSid}`);

  // Contact's phone was answered (human or VM) — notify frontend so it knows AMD is running
  if (CallStatus === 'in-progress') {
    io.emit('bridge-status', { sessionId, status: 'contact-answered' });
  }

  if (b && (CallStatus === 'no-answer' || CallStatus === 'busy' || CallStatus === 'failed')) {
    b.status = 'no-answer';
    io.emit('bridge-status', { sessionId, status: 'no-answer' });
    // Release agent
    try {
      if (b.agentCallSid) {
        const msg = CallStatus === 'busy' ? 'Line busy.' : 'No answer.';
        await twilioClient().calls(b.agentCallSid).update({
          twiml: `<Response><Say voice="Polly.Joanna">${msg} Moving to next contact.</Say><Hangup/></Response>`,
        });
      }
    } catch {}
  }

  if (b && CallStatus === 'completed' && b.status === 'connected') {
    b.status = 'ended';
    io.emit('bridge-status', { sessionId, status: 'call-ended' });
  }

  // If call completed while AMD was still running (bridge-b-twiml never fired or returned error),
  // unblock the frontend so it doesn't freeze in "calling-contact" state.
  if (b && CallStatus === 'completed' && b.status === 'calling-contact') {
    b.status = 'no-answer';
    io.emit('bridge-status', { sessionId, status: 'no-answer' });
    try {
      if (b.agentCallSid) {
        await twilioClient().calls(b.agentCallSid).update({
          twiml: `<Response><Say voice="Polly.Joanna">Call ended. Moving to next contact.</Say><Hangup/></Response>`,
        });
      }
    } catch {}
  }

  res.sendStatus(204);
});

// ─── POST /api/dialer/bridge-a-done (public) ─────────────────────────────────
webhooks.post('/bridge-a-done', (_req: Request, res: Response) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// ─── POST /api/dialer/bridge-b-done (public) ─────────────────────────────────
webhooks.post('/bridge-b-done', (_req: Request, res: Response) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// ─── GET /api/dialer/bridge-session/:id ──────────────────────────────────────
router.get('/bridge-session/:id', (req: Request, res: Response) => {
  const b = bridges.get(req.params.id);
  if (!b) { res.status(404).json({ error: 'Session not found' }); return; }
  res.json({ sessionId: req.params.id, status: b.status, contactName: b.contactName });
});

// ─── POST /api/dialer/bridge-hangup ──────────────────────────────────────────
// Agent clicks "End Call" in app — hangup both legs.
router.post('/bridge-hangup', async (req: Request, res: Response) => {
  const { sessionId } = req.body;
  const b = bridges.get(sessionId);
  if (!b) { res.json({ ok: true }); return; }

  const c = twilioClient();
  if (b.agentCallSid) {
    try { await c.calls(b.agentCallSid).update({ status: 'completed' }); } catch {}
  }
  if (b.contactCallSid) {
    try { await c.calls(b.contactCallSid).update({ status: 'completed' }); } catch {}
  }
  b.status = 'ended';
  bridges.delete(sessionId);
  res.json({ ok: true });
});

// ─── POST /api/dialer/manual-vm-drop ─────────────────────────────────────────
// Agent manually triggers voicemail drop (for when AMD didn't auto-detect).
// Requires the contact's call to still be in progress (machine greeting playing).
router.post('/manual-vm-drop', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const { sessionId } = req.body;
  const b = bridges.get(sessionId);

  if (!b || !b.contactCallSid) {
    res.status(404).json({ error: 'No active contact call for this session' });
    return;
  }

  const fallbackText = process.env.VOICEMAIL_SCRIPT ||
    `Hi, this is ${await getAgentName()} calling about your property. ` +
    `Please give me a call back when you get a chance. Thank you!`;

  let vmTwiml: string;
  try {
    const settings = await prisma.dialerSettings.findUnique({
      where:  { userId: userId || b.userId },
      select: { voicemailData: true, voicemailUrl: true },
    });

    if (settings?.voicemailData) {
      const mimeType   = settings.voicemailData.match(/^data:([^;]+)/)?.[1] || '';
      const isPlayable = mimeType === 'audio/wav' || mimeType.startsWith('audio/mp');
      if (isPlayable && settings.voicemailUrl) {
        vmTwiml = `<Response><Play>${settings.voicemailUrl}</Play><Hangup/></Response>`;
      } else {
        vmTwiml = `<Response><Say voice="Polly.Joanna">${fallbackText}</Say><Hangup/></Response>`;
      }
    } else if (settings?.voicemailUrl) {
      vmTwiml = `<Response><Play>${settings.voicemailUrl}</Play><Hangup/></Response>`;
    } else {
      vmTwiml = `<Response><Say voice="Polly.Joanna">${fallbackText}</Say><Hangup/></Response>`;
    }
  } catch {
    vmTwiml = `<Response><Say voice="Polly.Joanna">${fallbackText}</Say><Hangup/></Response>`;
  }

  try {
    await twilioClient().calls(b.contactCallSid).update({ twiml: vmTwiml });
  } catch (e: any) {
    res.status(500).json({ error: `Could not update contact call: ${e.message}` });
    return;
  }

  b.status = 'vm-dropped';
  io.emit('bridge-status', { sessionId, status: 'vm-dropped', contactName: b.contactName });

  // Disconnect agent with notification
  if (b.agentCallSid) {
    try {
      await twilioClient().calls(b.agentCallSid).update({
        twiml: '<Response><Say voice="Polly.Joanna">Voicemail dropped. Moving to next contact.</Say><Hangup/></Response>',
      });
    } catch {}
  }

  res.json({ ok: true });
});

// ─── POST /api/dialer/log-call ───────────────────────────────────────────────
// Save a call record after the agent picks a disposition.
router.post('/log-call', async (req: Request, res: Response) => {
  const { contactId, disposition, notes, duration, twilioSid } = req.body;
  if (!contactId || !disposition) {
    res.status(400).json({ error: 'contactId and disposition required' }); return;
  }

  const STATUS_MAP: Record<string, string> = {
    'hot-lead':           'hot',
    'appointment':        'appointment',
    'callback':           'callback',
    'left-voicemail':     'contacted',
    'no-answer':          'contacted',
    'not-interested':     'contacted',
    'wrong-number':       'contacted',
    'dnc':                'dnc',
  };

  try {
    const [call] = await Promise.all([
      prisma.call.create({
        data: {
          contactId,
          disposition,
          notes: notes || null,
          duration: duration || 0,
          twilioSid: twilioSid || null,
        },
      }),
      prisma.contact.update({
        where: { id: contactId },
        data: { status: STATUS_MAP[disposition] || 'contacted' },
      }),
    ]);
    res.json({ callId: call.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/dialer/contacts ─────────────────────────────────────────────────
// Returns contacts for a session, ordered by lead score desc.
// ?status=new,hot,callback,all  (comma-separated)
router.get('/contacts', async (req: Request, res: Response) => {
  try {
  const { status = 'all', limit = '200' } = req.query as { status?: string; limit?: string };
  const cappedLimit = Math.min(parseInt(limit, 10) || 200, 500); // dial sessions capped at 500

  const where: any = { NOT: { status: 'dnc' } };
  if (status && status !== 'all') {
    where.status = { in: status.split(',').map(s => s.trim()) };
  }

  const contacts = await prisma.contact.findMany({
    where,
    orderBy: [{ leadScore: 'desc' }, { updatedAt: 'desc' }],
    take: cappedLimit,
    select: {
      id: true, firstName: true, lastName: true, phone: true,
      address: true, city: true, state: true, zip: true,
      source: true, status: true, notes: true, leadScore: true,
      contactGroup: true, lastReplyAt: true, updatedAt: true,
      calls: {
        orderBy: { calledAt: 'desc' },
        take: 1,
        select: { calledAt: true, disposition: true, duration: true },
      },
    },
  });

  res.json(contacts);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
