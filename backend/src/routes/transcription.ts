/**
 * AI Call Transcription & Scoring
 * Uses OpenAI Whisper to transcribe call recordings, then GPT-4o-mini to score
 * the call on rapport, objection handling, and close attempt.
 *
 * Triggered automatically when a recording lands (via twilio.ts recording-status webhook)
 * or manually via POST /api/transcription/:callId
 *
 * Requires: OPENAI_API_KEY in .env
 */

import { Router, Request, Response } from 'express';
import prisma from '../db';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function transcribeRecording(recordingUrl: string): Promise<string> {
  const { OPENAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');

  // Fetch the recording audio from Twilio with auth
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const audioRes = await fetch(recordingUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!audioRes.ok) throw new Error(`Failed to fetch recording: ${audioRes.statusText}`);

  const audioBuffer = await audioRes.arrayBuffer();
  const audioBlob   = new Blob([audioBuffer], { type: 'audio/mpeg' });

  // Prepare multipart form for Whisper
  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.mp3');
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body:    formData,
  });
  if (!whisperRes.ok) {
    const err = await whisperRes.text();
    throw new Error(`Whisper API error: ${err}`);
  }

  const data = await whisperRes.json() as { text: string };
  return data.text;
}

async function scoreCall(transcript: string, contactName: string): Promise<{
  score: number;
  notes: string;
}> {
  const { OPENAI_API_KEY } = process.env;
  if (!OPENAI_API_KEY) return { score: 0, notes: 'OpenAI not configured' };

  const prompt = `You are an expert real estate sales coach. Analyze this call transcript between a real estate agent and ${contactName}.

TRANSCRIPT:
${transcript.slice(0, 3000)}

Score the call 0-100 on these criteria:
- Rapport building (friendly opener, used their name, active listening)
- Value proposition clarity (what makes the agent different)
- Objection handling (addressed concerns professionally)
- Call to action / close attempt (tried to set an appointment or next step)
- Overall professionalism

Respond ONLY with valid JSON in this exact format:
{
  "score": <0-100 integer>,
  "notes": "<2-3 specific coaching tips to improve, separated by | character>"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:       'gpt-4o-mini',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens:  300,
    }),
  });

  const data = await res.json() as any;
  const text = data.choices?.[0]?.message?.content || '{"score":0,"notes":"Could not score"}';

  try {
    const parsed = JSON.parse(text.trim());
    return { score: Number(parsed.score) || 0, notes: parsed.notes || '' };
  } catch {
    return { score: 0, notes: 'Could not parse AI response' };
  }
}

// ── Main function: transcribe + score a call ──────────────────────────────────
export async function transcribeAndScoreCall(callId: string): Promise<void> {
  const call = await prisma.call.findUnique({
    where:   { id: callId },
    include: { contact: true },
  });

  if (!call || !call.recordingUrl) {
    console.log(`[Transcription] Call ${callId} has no recording — skipping`);
    return;
  }

  if (call.transcript) {
    console.log(`[Transcription] Call ${callId} already transcribed — skipping`);
    return;
  }

  console.log(`[Transcription] Starting transcription for call ${callId}`);

  try {
    const transcript = await transcribeRecording(call.recordingUrl);
    const contactName = `${call.contact.firstName} ${call.contact.lastName}`;
    const { score, notes } = await scoreCall(transcript, contactName);

    await prisma.call.update({
      where: { id: callId },
      data:  { transcript, aiScore: score, aiNotes: notes },
    });

    console.log(`[Transcription] Call ${callId} transcribed. Score: ${score}/100`);
  } catch (err: any) {
    console.error(`[Transcription] Failed for call ${callId}:`, err.message);
  }
}

// ── GET /api/transcription/:callId ────────────────────────────────────────────
router.get('/:callId', async (req: Request, res: Response) => {
  const call = await prisma.call.findUnique({
    where:   { id: req.params.callId },
    select:  { id: true, transcript: true, aiScore: true, aiNotes: true, recordingUrl: true, calledAt: true },
  });
  if (!call) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(call);
});

// ── POST /api/transcription/:callId — trigger manually ───────────────────────
router.post('/:callId', async (req: Request, res: Response) => {
  const call = await prisma.call.findUnique({
    where: { id: req.params.callId },
    include: { contact: true },
  });
  if (!call) { res.status(404).json({ error: 'Not found' }); return; }
  if (!call.recordingUrl) { res.status(400).json({ error: 'No recording on this call' }); return; }

  // Run async — don't block response
  transcribeAndScoreCall(call.id).catch(console.error);
  res.json({ started: true, callId: call.id });
});

// ── POST /api/transcription/score-all — backfill existing recordings ──────────
router.post('/score-all', async (_req: Request, res: Response) => {
  const calls = await prisma.call.findMany({
    where: { recordingUrl: { not: null }, transcript: null },
    take:  20,
  });

  res.json({ queued: calls.length });
  // Fire off async
  for (const call of calls) {
    await transcribeAndScoreCall(call.id);
    await new Promise(r => setTimeout(r, 2000)); // rate limit
  }
});

export default router;
