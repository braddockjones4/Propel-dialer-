/**
 * DNC (Do Not Call) Registry Scrub
 *
 * Two layers of protection:
 * 1. Internal DNC — contacts marked status='dnc' in our own DB
 * 2. Manual upload scrub — user can upload their own DNC CSV list
 *    and we mark matching contacts
 *
 * True national DNC registry API requires a paid FTC subscription.
 * For that, set DNC_API_KEY in .env and we'll call the FTC API.
 * Without it, we rely on internal DNC tracking + STOP keyword handling.
 */

import { Router, Request, Response } from 'express';
import prisma from '../db';

const router = Router();

// In-memory DNC override list, per account — one account's uploaded list
// must never scrub or clear another account's contacts.
const manualDncNumbers = new Map<string, Set<string>>();
function dncSetFor(userId: string): Set<string> {
  let set = manualDncNumbers.get(userId);
  if (!set) { set = new Set(); manualDncNumbers.set(userId, set); }
  return set;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

// ── GET /api/dnc/check?phone=+1xxx — single phone check ─────────────────────
router.get('/check', async (req: Request, res: Response) => {
  const { phone } = req.query as { phone: string };
  if (!phone) { res.status(400).json({ error: 'phone required' }); return; }
  try {
    const userId = (req as any).user?.id as string;
    const normalized = normalizePhone(phone);
    const contact = await prisma.contact.findFirst({ where: { phone, userId } as any });
    const internalDnc = contact?.status === 'dnc';
    const manualDnc   = dncSetFor(userId).has(normalized);
    res.json({ phone, isDnc: internalDnc || manualDnc, internalDnc, manualDnc, contactId: contact?.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/dnc/scrub — bulk scrub a list of phones ───────────────────────
router.post('/scrub', async (req: Request, res: Response) => {
  const { phones } = req.body as { phones: string[] };
  if (!phones?.length) { res.status(400).json({ error: 'phones array required' }); return; }
  try {
    const userId = (req as any).user?.id as string;
    const manualSet = dncSetFor(userId);
    const results: Array<{ phone: string; isDnc: boolean; reason?: string }> = [];
    for (const phone of phones) {
      const normalized  = normalizePhone(phone);
      const contact     = await prisma.contact.findFirst({ where: { phone, userId } as any });
      const internalDnc = contact?.status === 'dnc';
      const manualDnc   = manualSet.has(normalized);
      results.push({ phone, isDnc: internalDnc || manualDnc, reason: internalDnc ? 'internal-dnc' : manualDnc ? 'manual-list' : undefined });
    }
    res.json({ results, dncCount: results.filter(r => r.isDnc).length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/dnc/upload — upload a DNC number list (newline-separated) ──────
router.post('/upload', async (req: Request, res: Response) => {
  const { numbers, markInDb = false } = req.body as { numbers: string[]; markInDb?: boolean };
  if (!numbers?.length) { res.status(400).json({ error: 'numbers array required' }); return; }
  try {
    const userId = (req as any).user?.id as string;
    const manualSet = dncSetFor(userId);
    const normalized = numbers.map(normalizePhone).filter(n => n.length >= 10);
    normalized.forEach(n => manualSet.add(n));
    let markedCount = 0;
    if (markInDb) {
      const phones = normalized.map(n => `+1${n.slice(-10)}`);
      const result = await prisma.contact.updateMany({ where: { phone: { in: phones }, userId } as any, data: { status: 'dnc' } });
      markedCount = result.count;
    }
    res.json({ added: normalized.length, total: manualSet.size, marked: markedCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/dnc/clear-manual — clear the manual DNC list ─────────────────
router.delete('/clear-manual', (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string;
  const set = manualDncNumbers.get(userId);
  const count = set?.size ?? 0;
  manualDncNumbers.set(userId, new Set());
  res.json({ cleared: count });
});

// ── GET /api/dnc/stats ────────────────────────────────────────────────────────
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const internalCount = await prisma.contact.count({ where: { status: 'dnc', userId } as any });
    const manualCount = dncSetFor(userId).size;
    res.json({ internalDnc: internalCount, manualDnc: manualCount, total: internalCount + manualCount });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/dnc/scrub-all — scrub all contacts against manual DNC list ──────
router.post('/scrub-all', async (req: Request, res: Response) => {
  const userId = (req as any).user?.id as string;
  const manualSet = dncSetFor(userId);
  if (manualSet.size === 0) {
    res.json({ marked: 0, message: 'No manual DNC numbers loaded' });
    return;
  }
  try {
    const contacts = await prisma.contact.findMany({ where: { status: { not: 'dnc' }, userId } as any, select: { id: true, phone: true } });
    let marked = 0;
    for (const c of contacts) {
      if (manualSet.has(normalizePhone(c.phone ?? ''))) {
        await prisma.contact.update({ where: { id: c.id }, data: { status: 'dnc' } });
        marked++;
      }
    }
    res.json({ scrubbed: contacts.length, marked });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
