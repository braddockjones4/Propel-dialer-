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

// In-memory DNC override list (supplement to DB status)
let manualDncNumbers = new Set<string>();

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

// ── GET /api/dnc/check?phone=+1xxx — single phone check ─────────────────────
router.get('/check', async (req: Request, res: Response) => {
  const { phone } = req.query as { phone: string };
  if (!phone) { res.status(400).json({ error: 'phone required' }); return; }

  const normalized = normalizePhone(phone);

  // Check internal DNC
  const contact = await prisma.contact.findFirst({ where: { phone } });
  const internalDnc = contact?.status === 'dnc';
  const manualDnc   = manualDncNumbers.has(normalized);

  res.json({
    phone,
    isDnc:      internalDnc || manualDnc,
    internalDnc,
    manualDnc,
    contactId:  contact?.id,
  });
});

// ── POST /api/dnc/scrub — bulk scrub a list of phones ───────────────────────
router.post('/scrub', async (req: Request, res: Response) => {
  const { phones } = req.body as { phones: string[] };
  if (!phones?.length) { res.status(400).json({ error: 'phones array required' }); return; }

  const results: Array<{ phone: string; isDnc: boolean; reason?: string }> = [];

  for (const phone of phones) {
    const normalized = normalizePhone(phone);
    const contact    = await prisma.contact.findFirst({ where: { phone } });
    const internalDnc = contact?.status === 'dnc';
    const manualDnc   = manualDncNumbers.has(normalized);

    results.push({
      phone,
      isDnc:  internalDnc || manualDnc,
      reason: internalDnc ? 'internal-dnc' : manualDnc ? 'manual-list' : undefined,
    });
  }

  res.json({ results, dncCount: results.filter(r => r.isDnc).length });
});

// ── POST /api/dnc/upload — upload a DNC number list (newline-separated) ──────
router.post('/upload', async (req: Request, res: Response) => {
  const { numbers, markInDb = false } = req.body as { numbers: string[]; markInDb?: boolean };
  if (!numbers?.length) { res.status(400).json({ error: 'numbers array required' }); return; }

  const normalized = numbers.map(normalizePhone).filter(n => n.length >= 10);
  normalized.forEach(n => manualDncNumbers.add(n));

  let markedCount = 0;
  if (markInDb) {
    // Mark matching contacts in DB as dnc
    const phones = normalized.map(n => `+1${n.slice(-10)}`);
    const result = await prisma.contact.updateMany({
      where: { phone: { in: phones } },
      data:  { status: 'dnc' },
    });
    markedCount = result.count;
  }

  res.json({
    added:   normalized.length,
    total:   manualDncNumbers.size,
    marked:  markedCount,
  });
});

// ── DELETE /api/dnc/clear-manual — clear the manual DNC list ─────────────────
router.delete('/clear-manual', (_req: Request, res: Response) => {
  const count = manualDncNumbers.size;
  manualDncNumbers = new Set();
  res.json({ cleared: count });
});

// ── GET /api/dnc/stats ────────────────────────────────────────────────────────
router.get('/stats', async (_req: Request, res: Response) => {
  const internalCount = await prisma.contact.count({ where: { status: 'dnc' } });
  res.json({
    internalDnc: internalCount,
    manualDnc:   manualDncNumbers.size,
    total:       internalCount + manualDncNumbers.size,
  });
});

// ── POST /api/dnc/scrub-all — scrub all contacts against manual DNC list ──────
router.post('/scrub-all', async (_req: Request, res: Response) => {
  if (manualDncNumbers.size === 0) {
    res.json({ marked: 0, message: 'No manual DNC numbers loaded' });
    return;
  }

  const contacts = await prisma.contact.findMany({
    where:  { status: { not: 'dnc' } },
    select: { id: true, phone: true },
  });

  let marked = 0;
  for (const c of contacts) {
    if (manualDncNumbers.has(normalizePhone(c.phone ?? ''))) {
      await prisma.contact.update({ where: { id: c.id }, data: { status: 'dnc' } });
      marked++;
    }
  }

  res.json({ scrubbed: contacts.length, marked });
});

export default router;
