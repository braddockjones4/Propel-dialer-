/**
 * Ringless Voicemail Blast
 * Drops voicemails to hundreds of contacts simultaneously.
 *
 * Method: Twilio REST API calls with AMD enabled.
 * When machine is detected → immediately inject TTS voicemail → hang up.
 * Human answers → play brief "sorry, wrong number" or just hang up.
 *
 * This is the "flash call + AMD" approach used by power dialers.
 * True ringless VM (no ring at all) requires a third-party service like
 * Slybroadcast or Drop Cowboy — add SLYBROADCAST_USER/PASS to .env to enable.
 */

import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import prisma from '../db';
import { pickCallerId } from './localPresence';

const router = Router();

// Active blasts stored in memory
interface VmBlast {
  id: string;
  status: 'running' | 'done' | 'stopped';
  total: number;
  dropped: number;
  failed: number;
  skipped: number;
  startedAt: number;
}

const activeBlasts = new Map<string, VmBlast>();

// ── POST /api/voicemail-blast/start ──────────────────────────────────────────
router.post('/start', async (req: Request, res: Response) => {
  const { script, filter, concurrency = 5 } = req.body as {
    script: string;
    filter?: { source?: string; status?: string };
    concurrency?: number;  // simultaneous calls (max 10)
  };

  if (!script?.trim()) { res.status(400).json({ error: 'script required' }); return; }

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID, NGROK_URL } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_CALLER_ID || !NGROK_URL) {
    res.status(500).json({ error: 'Twilio not configured' }); return;
  }

  let contacts;
  try {
    contacts = await prisma.contact.findMany({
      where: {
        NOT: { status: 'dnc' },
        ...(filter?.source ? { source: filter.source } : {}),
        ...(filter?.status ? { status: filter.status } : {}),
      },
      take: 500,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message }); return;
  }

  if (contacts.length === 0) { res.status(400).json({ error: 'No eligible contacts' }); return; }

  const blastId = `vmblast_${Date.now()}`;
  const blast: VmBlast = {
    id: blastId,
    status: 'running',
    total: contacts.length,
    dropped: 0,
    failed: 0,
    skipped: 0,
    startedAt: Date.now(),
  };
  activeBlasts.set(blastId, blast);

  res.json({ blastId, total: contacts.length, message: 'Blast started' });

  // Fire async — process contacts in batches
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const maxConcurrency = Math.min(Number(concurrency) || 5, 10);

  // TwiML played when machine detected — the voicemail message
  const vmTwiml = encodeURIComponent(
    `<Response><Pause length="1"/><Say voice="Polly.Joanna">${script}</Say><Hangup/></Response>`
  );

  // TwiML played if human answers — brief hangup (most people won't even notice)
  const humanTwiml = encodeURIComponent(`<Response><Hangup/></Response>`);

  const processContact = async (contact: typeof contacts[0]) => {
    const b = activeBlasts.get(blastId);
    if (!b || b.status === 'stopped') return;

    try {
      const callerId = await pickCallerId(contact.phone!).catch(() => TWILIO_CALLER_ID!);
      await client.calls.create({
        to:   contact.phone!,
        from: callerId,
        // On answer: immediately hang up if human, drop VM if machine
        url:    `${NGROK_URL}/api/voicemail-blast/twiml?human=${humanTwiml}`,
        machineDetection:           'DetectMessageEnd',
        asyncAmdStatusCallback:       `${NGROK_URL}/api/voicemail-blast/amd?blastId=${blastId}&script=${encodeURIComponent(script)}`,
        asyncAmdStatusCallbackMethod: 'POST',
        statusCallback:       `${NGROK_URL}/api/voicemail-blast/status?blastId=${blastId}`,
        statusCallbackMethod: 'POST',
        statusCallbackEvent:  ['completed'],
        timeout: 25,
      } as any);
    } catch (err: any) {
      console.error(`[VMBlast] Failed ${contact.phone}:`, err.message);
      const b2 = activeBlasts.get(blastId);
      if (b2) b2.failed++;
    }
  };

  // Process in batches with concurrency limit
  (async () => {
    for (let i = 0; i < contacts.length; i += maxConcurrency) {
      const b = activeBlasts.get(blastId);
      if (!b || b.status === 'stopped') break;

      const batch = contacts.slice(i, i + maxConcurrency);
      await Promise.all(batch.map(processContact));
      await new Promise(r => setTimeout(r, 2000)); // 2s between batches
    }

    const finalBlast = activeBlasts.get(blastId);
    if (finalBlast) finalBlast.status = 'done';
    console.log(`[VMBlast] ${blastId} complete — ${finalBlast?.dropped} dropped, ${finalBlast?.failed} failed`);
  })().catch(console.error);
});

// ── POST /api/voicemail-blast/twiml — answer handler (human picked up) ───────
router.post('/twiml', (req: Request, res: Response) => {
  // Human answered — hang up immediately
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// ── POST /api/voicemail-blast/amd — machine detected → drop voicemail ────────
router.post('/amd', async (req: Request, res: Response) => {
  const { CallSid, AnsweredBy } = req.body;
  const { blastId, script } = req.query as { blastId: string; script: string };

  const isMachine = ['machine_end_beep', 'machine_end_silence', 'machine_end_other'].includes(AnsweredBy);

  if (isMachine && CallSid && script) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const decodedScript = decodeURIComponent(script);
    const dropTwiml = `<Response><Pause length="1"/><Say voice="Polly.Joanna">${decodedScript}</Say><Hangup/></Response>`;

    try {
      await client.calls(CallSid).update({ twiml: dropTwiml });
      const blast = activeBlasts.get(blastId);
      if (blast) blast.dropped++;
      console.log(`[VMBlast] Dropped VM on ${CallSid}`);
    } catch (err: any) {
      console.error('[VMBlast] Failed to drop VM:', err.message);
    }
  } else if (!isMachine) {
    // Human answered during blast — hang up
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    try {
      await client.calls(CallSid).update({ twiml: '<Response><Hangup/></Response>' });
      const blast = activeBlasts.get(blastId);
      if (blast) blast.skipped++;
    } catch { /* ignore */ }
  }

  res.sendStatus(204);
});

// ── POST /api/voicemail-blast/status — call status callback ──────────────────
router.post('/status', (req: Request, res: Response) => {
  res.sendStatus(204); // just acknowledge
});

// ── GET /api/voicemail-blast/:blastId — poll progress ────────────────────────
router.get('/:blastId', (req: Request, res: Response) => {
  const blast = activeBlasts.get(req.params.blastId);
  if (!blast) { res.status(404).json({ error: 'Blast not found' }); return; }
  res.json({
    ...blast,
    elapsedSeconds: Math.floor((Date.now() - blast.startedAt) / 1000),
    progress: blast.total > 0 ? Math.round(((blast.dropped + blast.failed + blast.skipped) / blast.total) * 100) : 0,
  });
});

// ── POST /api/voicemail-blast/:blastId/stop ───────────────────────────────────
router.post('/:blastId/stop', (req: Request, res: Response) => {
  const blast = activeBlasts.get(req.params.blastId);
  if (!blast) { res.status(404).json({ error: 'Not found' }); return; }
  blast.status = 'stopped';
  res.json({ stopped: true });
});

export default router;
