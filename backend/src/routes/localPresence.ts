import { Router, Request, Response } from 'express';
import twilio from 'twilio';
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

// Pick best local number for a given destination phone
// Returns the matching local number or falls back to default caller ID
export async function pickCallerId(destinationPhone: string): Promise<string> {
  const areaCode = extractAreaCode(destinationPhone);
  const defaultCallerId = process.env.TWILIO_CALLER_ID || '';

  if (!areaCode) return defaultCallerId;

  // Try exact area code match first
  const match = await prisma.localNumber.findFirst({
    where: { areaCode, active: true },
  });

  if (match) return match.number;

  // Fall back to any active local number (still better than your real number)
  const any = await prisma.localNumber.findFirst({ where: { active: true } });
  if (any) return any.number;

  return defaultCallerId;
}

// ─── GET /api/local-presence ──────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  try {
    const numbers = await prisma.localNumber.findMany({ orderBy: { areaCode: 'asc' } });
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

    const saved = await prisma.localNumber.create({
      data: { number: purchased.phoneNumber, areaCode, state: state || null, label: label || null, active: true },
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
    const saved = await prisma.localNumber.create({
      data: { number, areaCode, state: state || null, label: label || null, active: true },
    });
    res.status(201).json(saved);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/local-presence/:id ───────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { active, label } = req.body;
    const updated = await prisma.localNumber.update({
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
  const number = await prisma.localNumber.findUnique({ where: { id: req.params.id } });
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
    await prisma.localNumber.delete({ where: { id: req.params.id } });
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
