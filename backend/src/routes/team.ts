/**
 * Team endpoints — retired.
 *
 * Every account is fully independent (own contacts, own numbers, own
 * everything) with no cross-account visibility or management. This file used
 * to let an 'admin' role list/invite/edit every user system-wide and claim
 * other users' contacts — that directly caused a real data leak between two
 * separate accounts, so the whole "team mode" concept is retired rather than
 * re-scoped. GET endpoints below return only the caller's own data so
 * nothing that might still poll them breaks; mutating endpoints are gone.
 */
import { Router, Response } from 'express';
import prisma from '../db';

const router = Router();
const db = prisma as any;

// ── GET /api/team/members — always just yourself, never another account ─────
router.get('/members', async (req: any, res: Response) => {
  try {
    const { passwordHash, ...self } = req.user;
    res.json([self]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/team/stats — scoped to only the caller's own activity ──────────
router.get('/stats', async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const since = new Date(Date.now() - 30 * 86400000);
    const [totalCalls, totalMessages, hotLeads, appointments] = await Promise.all([
      prisma.call.count({ where: { contact: { userId } as any, calledAt: { gte: since } } }).catch(() => 0),
      prisma.message.count({ where: { contact: { userId } as any, direction: 'outbound', sentAt: { gte: since } } }).catch(() => 0),
      prisma.call.count({ where: { contact: { userId } as any, calledAt: { gte: since }, disposition: 'hot-lead' } }).catch(() => 0),
      db.appointment.count({ where: { contact: { userId }, createdAt: { gte: since } } }).catch(() => 0),
    ]);

    res.json({
      period: '30 days',
      team:   [{ id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role }],
      totals: { calls: totalCalls, messages: totalMessages, hotLeads, appointments },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Retired: inviting/editing/removing other accounts ────────────────────────
router.post('/invite', (_req: any, res: Response) => {
  res.status(410).json({ error: 'Team accounts are not supported — every account is fully independent.' });
});
router.patch('/members/:id', (_req: any, res: Response) => {
  res.status(410).json({ error: 'Team accounts are not supported — every account is fully independent.' });
});
router.delete('/members/:id', (_req: any, res: Response) => {
  res.status(410).json({ error: 'Team accounts are not supported — every account is fully independent.' });
});

export default router;
