import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { getTwilioClient } from '../twilioClient';
import prisma from '../db';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractAreaCode(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // E.164: +1AAANNNNNNN → digits = 1AAANNNNNNN → area = chars 1-3
  if (digits.length === 11 && digits[0] === '1') return digits.substring(1, 4);
  if (digits.length === 10) return digits.substring(0, 3);
  return '';
}

/** Compare two phone numbers by their last 10 digits (format-agnostic). */
export function sameNumber(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const da = a.replace(/\D/g, '').slice(-10);
  const db = b.replace(/\D/g, '').slice(-10);
  return da.length === 10 && da === db;
}

// Pick best local number for a given destination phone, scoped to a user.
// Never returns a number equal to the destination (see resolveContactCallerId).
export async function pickCallerId(destinationPhone: string, userId?: string | null): Promise<string> {
  const areaCode = extractAreaCode(destinationPhone);
  const defaultCallerId = process.env.TWILIO_CALLER_ID || '';
  const notSelf = (n?: string | null) => (n && !sameNumber(n, destinationPhone) ? n : '');

  if (!areaCode) return notSelf(defaultCallerId);

  const userFilter = userId ? { userId } : {};

  const match = await (prisma.localNumber as any).findFirst({
    where: { areaCode, active: true, ...userFilter },
  });
  if (notSelf(match?.number)) return match.number;

  const any = await (prisma.localNumber as any).findFirst({ where: { active: true, ...userFilter } });
  if (notSelf(any?.number)) return any.number;

  return notSelf(defaultCallerId);
}

/**
 * Resolve the From number for an outbound leg to a contact.
 *
 * CRITICAL: the caller ID must never equal the number being dialed. When they
 * match, carriers treat the call as the subscriber phoning their own mailbox and
 * answer with voicemail RETRIEVAL ("press # and enter your password") instead of
 * the outgoing greeting + beep. No message can be left, and AMD can never detect
 * a machine because there is no greeting to detect.
 *
 * Preference order (first candidate that isn't the destination wins):
 *   1. agent's verified personal phone  — best answer rates, callbacks reach them
 *   2. local-presence number matching the destination's area code
 *   3. account default caller ID (TWILIO_CALLER_ID)
 */
export async function resolveContactCallerId(opts: {
  destination: string;
  personalPhone?: string | null;
  phoneVerified?: boolean | null;
  userId?: string | null;
  fallback?: string;
}): Promise<string> {
  const { destination, personalPhone, phoneVerified, userId, fallback } = opts;

  const local = await pickCallerId(destination, userId).catch(() => '');

  const candidates = [
    phoneVerified && personalPhone ? personalPhone : '',
    local,
    process.env.TWILIO_CALLER_ID || '',
    fallback || '',
  ];

  for (const c of candidates) {
    if (c && !sameNumber(c, destination)) return c;
  }

  // Every candidate matched the destination (e.g. agent dialing their own
  // number as a test). Returning '' lets the caller surface a clear error
  // rather than placing a self-call that lands in voicemail retrieval.
  return '';
}

// ─── GET /api/local-presence ──────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const numbers = await (prisma.localNumber as any).findMany({
      where: { userId },
      orderBy: { areaCode: 'asc' },
    });
    res.json(numbers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/local-presence/buy ────────────────────────────────────────────
// Purchase a new local number from Twilio for a given area code
router.post('/buy', async (req: Request, res: Response) => {
  const { areaCode, state, label } = req.body as { areaCode: string; state?: string; label?: string };
  if (!areaCode || areaCode.length !== 3) {
    res.status(400).json({ error: 'areaCode must be 3 digits' }); return;
  }

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    res.status(500).json({ error: 'Twilio not configured' }); return;
  }

  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    const available = await client.availablePhoneNumbers('US').local.list({
      areaCode: parseInt(areaCode, 10),
      voiceEnabled: true,
      smsEnabled: true,
      limit: 1,
    });

    if (available.length === 0) {
      res.status(404).json({ error: `No numbers available for area code ${areaCode}` }); return;
    }

    const BACKEND_BASE = process.env.BACKEND_URL || process.env.NGROK_URL || 'https://propel-dialer-backend.onrender.com';

    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber:   available[0].phoneNumber,
      voiceUrl:      `${BACKEND_BASE}/api/twilio/voice`,
      voiceMethod:   'POST',
      smsUrl:        `${BACKEND_BASE}/api/twilio/sms-inbound`,
      smsMethod:     'POST',
      friendlyName:  label || `Propel Local — ${areaCode}`,
    });

    const userId = (req as any).user?.id as string | null;
    const saved = await (prisma.localNumber as any).create({
      data: { number: purchased.phoneNumber, areaCode, state: state || null, label: label || null, active: true, userId },
    });

    res.status(201).json(saved);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/local-presence/add ────────────────────────────────────────────
// Manually add an existing Twilio number to the pool (no purchase)
router.post('/add', async (req: Request, res: Response) => {
  const { number, areaCode, state, label } = req.body as {
    number: string; areaCode: string; state?: string; label?: string;
  };

  if (!number || !areaCode) {
    res.status(400).json({ error: 'number and areaCode required' }); return;
  }

  try {
    const userId = (req as any).user?.id as string | null;
    const saved = await (prisma.localNumber as any).create({
      data: { number, areaCode, state: state || null, label: label || null, active: true, userId },
    });
    res.status(201).json(saved);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/local-presence/:id ───────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const owns = await (prisma.localNumber as any).findFirst({ where: { id: req.params.id, userId } });
    if (!owns) { res.status(404).json({ error: 'Not found' }); return; }
    const { active, label } = req.body;
    const updated = await (prisma.localNumber as any).update({
      where: { id: req.params.id },
      data: { active, label },
    });
    res.json(updated);
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Not found' }); return; }
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/local-presence/:id ──────────────────────────────────────────
// Soft-delete (deactivate) — actual Twilio release requires manual action
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string;
  const number = await (prisma.localNumber as any).findFirst({ where: { id: req.params.id, userId } });
  if (!number) { res.status(404).json({ error: 'Not found' }); return; }

  // Optionally release from Twilio
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    try {
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      const incomingNumbers = await client.incomingPhoneNumbers.list({ phoneNumber: number.number });
      if (incomingNumbers[0]) {
        await client.incomingPhoneNumbers(incomingNumbers[0].sid).remove();
      }
    } catch (e: any) {
      console.warn('[LocalPresence] Failed to release from Twilio:', e.message);
    }
  }

  try {
    await (prisma.localNumber as any).delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Not found' }); return; }
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/local-presence/match/:phone ────────────────────────────────────
// Preview which number would be used for a given destination phone
router.get('/match/:phone', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const callerId = await pickCallerId(phone);
    const areaCode = extractAreaCode(phone);
    res.json({ phone, areaCode, callerId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
