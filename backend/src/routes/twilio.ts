import { Router, Request, Response, NextFunction } from 'express';
import twilio, { validateRequest as twilioValidate } from 'twilio';

import { runFollowUpSequence, ContactContext } from '../followUp';
import { SequenceTrigger } from '../sequenceStore';
import { pickCallerId } from './localPresence';
import prisma from '../db';
import { transcribeAndScoreCall } from './transcription';
import { bridges } from './dialer';
import { io } from '../socket';

const router = Router();

/** Validate that an inbound POST came from Twilio. Skipped in non-production. */
function validateTwilioSig(req: Request, res: Response, next: NextFunction): void {
  const { TWILIO_AUTH_TOKEN, NODE_ENV } = process.env;
  if (!TWILIO_AUTH_TOKEN || NODE_ENV !== 'production') { next(); return; }
  const signature = req.headers['x-twilio-signature'] as string | undefined;
  if (!signature) { res.status(403).json({ error: 'Missing Twilio signature' }); return; }
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const valid = twilioValidate(TWILIO_AUTH_TOKEN, signature, url, req.body || {});
  if (!valid) { res.status(403).json({ error: 'Invalid Twilio signature' }); return; }
  next();
}

// Track callSid → userId so AMD can use the user's recorded voicemail
const callToUser = new Map<string, string>();

// ─── POST /api/twilio/token ───────────────────────────────────────────────────
router.post('/token', (req: Request, res: Response) => {
  try {
    const { TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID } =
      process.env;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET || !TWILIO_TWIML_APP_SID) {
      res.status(500).json({ error: 'Twilio credentials not configured.' });
      return;
    }

    const identity = (req.body.identity as string) || 'agent';
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, {
      identity,
      ttl: 3600,
    });

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    token.addGrant(voiceGrant);
    res.json({ token: token.toJwt(), identity });
  } catch (err) {
    console.error('Token generation error:', err);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// ─── POST /api/twilio/voice ───────────────────────────────────────────────────
// TwiML webhook for Twilio Device (WebRTC browser calls).
//
// Two modes depending on what params the browser passes via device.connect():
//
// A) Live-audio WebRTC mode (SessionId, no ConfName):
//    Browser gets a <Dial callerId="..."><Number machineDetection="DetectMessageEnd" url="...">
//    Agent hears ringing → voicemail greeting → beep live through the browser.
//    After the beep, webrtc-number-url is called with AnsweredBy:
//      human  → <Response/> keeps the bridge alive
//      machine → <Play vmUrl/><Hangup/> drops the pre-recorded voicemail
//
// B) Legacy direct dial (fallback / inbound):
//    Browser passes To → plain <Dial> to the number. No AMD in this path.
router.post('/voice', validateTwilioSig, async (req: Request, res: Response) => {
  const { TWILIO_CALLER_ID } = process.env;
  const ngrokBase = process.env.NGROK_URL || process.env.BACKEND_URL || `https://propel-dialer-backend.onrender.com`;
  const twiml = new twilio.twiml.VoiceResponse();

  // ── A) Live-audio WebRTC <Dial> mode ─────────────────────────────────────
  // Browser sends SessionId only (no ConfName) → agent hears ringing + greeting live.
  // <Number machineDetection="DetectMessageEnd"> calls webrtc-number-url after the beep
  // with AnsweredBy so we can drop the pre-recorded VM inline — same as bridge mode but
  // the agent hears all audio live through the browser WebRTC connection.
  const confNameParam = req.body.ConfName as string | undefined;
  const sessionId     = req.body.SessionId as string | undefined;

  if (sessionId && !confNameParam) {
    const b = bridges.get(sessionId);
    if (!b) {
      twiml.say({ voice: 'Polly.Joanna' }, 'Session not found. Please try again.');
      twiml.hangup();
      res.type('text/xml').send(twiml.toString());
      return;
    }

    b.agentCallSid = req.body.CallSid as string;
    b.status = 'calling-contact';

    const settings = await prisma.dialerSettings.findUnique({ where: { userId: b.userId } }).catch(() => null);
    const localFrom = await pickCallerId(b.contactPhone).catch(() => TWILIO_CALLER_ID || '');
    const contactFrom = (settings?.phoneVerified && settings?.personalPhone)
      ? settings.personalPhone
      : localFrom;

    io.emit('bridge-status', { sessionId, status: 'calling-contact', contactName: b.contactName });

    // <Dial> bridges the agent's browser audio to the contact immediately.
    // Agent hears ringing → voicemail greeting → beep, all in real time.
    // <Number machineDetection="DetectMessageEnd"> waits for the full greeting + beep,
    // then calls webrtc-number-url with AnsweredBy in the body:
    //   human         → return <Response/> to keep the bridge alive
    //   machine_end_* → return <Play vmUrl/><Hangup/> + disconnect agent via REST API
    const sid = encodeURIComponent(sessionId);
    const dial = twiml.dial({
      callerId: contactFrom,
      action:   `${ngrokBase}/api/dialer/webrtc-dial-done?sessionId=${sid}`,
    } as any);

    (dial as any).number({
      machineDetection:          'DetectMessageEnd',
      asyncAmd:                  'true',
      asyncAmdStatusCallback:    `${ngrokBase}/api/dialer/webrtc-amd?sessionId=${sid}`,
      asyncAmdStatusCallbackMethod: 'POST',
      // url fires immediately on answer (AnsweredBy=undefined at this point — AMD not done yet)
      // Return <Response/> to keep the bridge alive; AMD result arrives via asyncAmdStatusCallback
      url:                       `${ngrokBase}/api/dialer/webrtc-number-url?sessionId=${sid}`,
      urlMethod:                 'POST',
      statusCallback:            `${ngrokBase}/api/dialer/webrtc-contact-status?sessionId=${sid}`,
      statusCallbackEvent:       'answered completed no-answer busy failed',
      statusCallbackMethod:      'POST',
    }, b.contactPhone);

    console.log(`[WebRTC Dial] session=${sessionId} | dialing ${b.contactPhone} | caller=${contactFrom}`);
    res.type('text/xml').send(twiml.toString());
    return;
  }

  // ── B) Legacy direct dial ─────────────────────────────────────────────────
  const to              = req.body.To as string;
  const personalCallerId = req.body.CallerId as string | undefined;

  if (!to || !TWILIO_CALLER_ID) {
    twiml.say('Configuration error.');
    res.type('text/xml').send(twiml.toString());
    return;
  }

  const localCallerId   = await pickCallerId(to).catch(() => TWILIO_CALLER_ID);
  const effectiveCallerId = personalCallerId || localCallerId;

  const dial = twiml.dial({
    callerId: effectiveCallerId,
    record: 'record-from-answer-dual',
    recordingStatusCallback:       `${ngrokBase}/api/twilio/recording-status`,
    recordingStatusCallbackMethod: 'POST',
    action: `${ngrokBase}/api/twilio/call-status`,
  } as Parameters<typeof twiml.dial>[0]);

  dial.number({
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallback:       `${ngrokBase}/api/twilio/call-status`,
    statusCallbackMethod: 'POST',
  } as Parameters<typeof dial.number>[0], to);

  res.type('text/xml').send(twiml.toString());
});

// ─── POST /api/twilio/amd-status ─────────────────────────────────────────────
router.post('/amd-status', validateTwilioSig, async (req: Request, res: Response) => {
  const { AnsweredBy, To, CallSid } = req.body;
  console.log(`[AMD] CallSid: ${CallSid} | AnsweredBy: ${AnsweredBy} | To: ${To}`);

  // Primary: userId embedded in callback URL at call-creation time (reliable — matches outbound SID)
  // Fallback: in-memory map (keyed on inbound SID, only works if same SID, kept for compat)
  const userId = (req.query.userId as string | undefined) || callToUser.get(CallSid) || null;
  callToUser.delete(CallSid); // cleanup
  console.log(`[AMD] userId=${userId ?? 'unknown'} — will ${userId ? 'use recorded VM' : 'use TTS fallback'}`);

  const contact: ContactContext = {
    firstName: 'there',
    fullName: To,
    address: 'your property',
    phone: To,
  };

  const isMachine = ['machine_end_beep', 'machine_end_silence', 'machine_end_other'].includes(AnsweredBy);

  if (isMachine && CallSid) {
    console.log(`[AMD] Machine detected — dropping voicemail for ${To}, userId=${userId ?? 'unknown'}`);
    try {
      const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, BACKEND_URL, NGROK_URL } = process.env;
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      const backendBase = BACKEND_URL || NGROK_URL || 'https://propel-dialer-backend.onrender.com';

      // Use format-aware TwiML endpoint if we have a userId.
      // It checks audio format at play time: WAV/MP3 → <Play>, webm/none → TTS <Say>.
      // Falls back to TTS-only TwiML if no userId (can't look up which user's recording to use).
      if (userId) {
        const vmPlayUrl = `${backendBase}/api/dialer/vm-play-twiml/${encodeURIComponent(userId)}`;
        console.log(`[AMD] Redirecting to vm-play-twiml: ${vmPlayUrl}`);
        await client.calls(CallSid).update({ url: vmPlayUrl, method: 'POST' } as any);
      } else {
        const vmScript = process.env.VOICEMAIL_SCRIPT ||
          `Hi, this is ${process.env.AGENT_NAME || 'your agent'} calling about your property. ` +
          `Please call me back when you get a chance. Thank you!`;
        await client.calls(CallSid).update({
          twiml: `<Response><Say voice="Polly.Joanna">${vmScript}</Say><Hangup/></Response>`,
        });
      }
    } catch (err) {
      console.error('[AMD] Failed to drop voicemail:', err);
    }
    await runFollowUpSequence('voicemail', contact);
  }

  res.sendStatus(204);
});

// ─── POST /api/twilio/voicemail-drop ─────────────────────────────────────────
// Manual voicemail drop — agent presses button mid-call
router.post('/voicemail-drop', validateTwilioSig, async (req: Request, res: Response) => {
  const { callSid } = req.body;
  if (!callSid) { res.status(400).json({ error: 'callSid required' }); return; }

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  const vmScript = process.env.VOICEMAIL_SCRIPT ||
    `Hi, this is ${process.env.AGENT_NAME || 'Braddock'} calling about your property. ` +
    `I'd love to connect — please call me back at ${process.env.AGENT_PHONE || 'my office'}. Thank you and have a great day!`;

  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const dropTwiml = `<Response><Say voice="Polly.Joanna">${vmScript}</Say><Hangup/></Response>`;
    await client.calls(callSid).update({ twiml: dropTwiml });
    res.json({ dropped: true });
  } catch (err: any) {
    console.error('[VM Drop] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/twilio/call-status ────────────────────────────────────────────
// Fires when call status changes. Used to detect no-answer and short calls.
router.post('/call-status', validateTwilioSig, async (req: Request, res: Response) => {
  const { CallSid, CallStatus, CallDuration, To } = req.body;
  console.log(`[Call] SID: ${CallSid} | Status: ${CallStatus} | Duration: ${CallDuration}s | To: ${To}`);

  try {
    const contact: ContactContext = { firstName: 'there', fullName: To, address: 'your property', phone: To };
    const duration = parseInt(CallDuration || '0', 10);

    if (CallStatus === 'no-answer' || CallStatus === 'busy') {
      console.log(`[Follow-up] No answer for ${To} — firing no-answer sequence`);
      await runFollowUpSequence('no-answer', contact);
    } else if (CallStatus === 'completed' && duration > 0 && duration < 30) {
      console.log(`[Follow-up] Short call (${duration}s) for ${To} — firing short-call sequence`);
      await runFollowUpSequence('short-call', contact);
    }
  } catch (e: any) {
    console.error('[call-status] error:', e.message);
  }

  res.sendStatus(204);
});

// ─── POST /api/twilio/recording-status ───────────────────────────────────────
router.post('/recording-status', validateTwilioSig, async (req: Request, res: Response) => {
  const { CallSid, RecordingUrl, RecordingSid, RecordingDuration } = req.body;
  console.log(`[Recording] Call: ${CallSid} | Sid: ${RecordingSid} | Duration: ${RecordingDuration}s`);

  if (CallSid && RecordingUrl) {
    // Store as mp3
    const mp3Url = RecordingUrl.endsWith('.mp3') ? RecordingUrl : RecordingUrl + '.mp3';
    try {
      await prisma.call.updateMany({
        where: { twilioSid: CallSid },
        data:  { recordingUrl: mp3Url },
      });
      console.log(`[Recording] Saved URL for call ${CallSid}`);

      // Auto-transcribe if OpenAI is configured
      if (process.env.OPENAI_API_KEY) {
        const call = await prisma.call.findFirst({ where: { twilioSid: CallSid } });
        if (call) {
          // Fire async — don't block webhook response
          setTimeout(() => transcribeAndScoreCall(call.id).catch(console.error), 3000);
        }
      }
    } catch (e: any) {
      console.warn('[Recording] Could not save URL:', e.message);
    }
  }

  res.sendStatus(204);
});

// ─── GET /api/twilio/recording-proxy ─────────────────────────────────────────
// Proxies a Twilio recording with auth so browser can play it
router.get('/recording-proxy', async (req: Request, res: Response) => {
  const { url } = req.query as { url: string };
  if (!url) { res.status(400).json({ error: 'url required' }); return; }

  // C2 fix: validate URL is a Twilio domain before forwarding credentials
  try {
    const parsed = new URL(url);
    const allowed = ['api.twilio.com', 'recordings.twilio.com', 'media.twiliocdn.com'];
    if (!allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
      res.status(400).json({ error: 'Invalid recording URL' }); return;
    }
  } catch { res.status(400).json({ error: 'Invalid URL' }); return; }

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    res.status(500).json({ error: 'Twilio not configured' }); return;
  }

  try {
    const https = await import('https');
    const http  = await import('http');
    const targetUrl = new URL(url);
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const lib  = targetUrl.protocol === 'https:' ? https : http;

    lib.get(url, { headers: { Authorization: `Basic ${auth}` } }, (upstream) => {
      res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      upstream.pipe(res);
    }).on('error', (e) => {
      console.error('[Proxy] Recording proxy error:', e.message);
      res.status(500).json({ error: 'Failed to fetch recording' });
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/twilio/disposition ────────────────────────────────────────────
// Frontend calls this when agent logs a manual disposition (Hot Lead, Callback, etc.)
router.post('/disposition', async (req: Request, res: Response) => {
  const { disposition, contact } = req.body as {
    disposition: SequenceTrigger;
    contact: ContactContext;
  };

  const validTriggers: SequenceTrigger[] = ['hot-lead', 'callback', 'no-answer', 'voicemail', 'short-call'];
  if (!validTriggers.includes(disposition)) {
    res.json({ sent: false, reason: 'No sequence for this disposition' });
    return;
  }

  try {
    await runFollowUpSequence(disposition, contact);
    res.json({ sent: true, disposition });
  } catch (e: any) {
    console.error('[disposition] sequence error:', e.message);
    res.json({ sent: false, reason: e.message });
  }
});

export default router;
