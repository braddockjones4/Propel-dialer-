/**
 * Multi-agent Team Mode
 * GET  /api/team/members          — list all team members (admin only)
 * POST /api/team/invite           — invite new agent by email (admin only)
 * PATCH /api/team/members/:id     — update role/plan
 * DELETE /api/team/members/:id    — remove agent
 * GET  /api/team/stats            — per-agent call/text stats (admin only)
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth } from './auth';
import prisma from '../db';

const router  = Router();
const db      = prisma as any;

// ── Middleware: admin only ────────────────────────────────────────────────────
function requireAdmin(req: any, res: Response, next: any) {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  next();
}

// ── GET /api/team/members ─────────────────────────────────────────────────────
router.get('/members', requireAuth, requireAdmin, async (req: any, res: Response) => {
  try {
    const users = await db.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true, plan: true, createdAt: true },
    });
    res.json(users);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/team/invite ─────────────────────────────────────────────────────
router.post('/invite', requireAuth, requireAdmin, async (req: any, res: Response) => {
  try {
    const { email, name, role = 'agent', tempPassword } = req.body;
    if (!email || !tempPassword) { res.status(400).json({ error: 'email and tempPassword required' }); return; }

    const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) { res.status(409).json({ error: 'Email already registered' }); return; }

    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const user = await db.user.create({
      data: { email: email.toLowerCase(), passwordHash, name: name || '', role },
      select: { id: true, email: true, name: true, role: true, plan: true, createdAt: true },
    });

    res.status(201).json({ user, tempPassword });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/team/members/:id ───────────────────────────────────────────────
router.patch('/members/:id', requireAuth, requireAdmin, async (req: any, res: Response) => {
  try {
    const { role, plan } = req.body;
    const updated = await db.user.update({
      where: { id: req.params.id },
      data: {
        ...(role ? { role } : {}),
        ...(plan ? { plan } : {}),
      },
      select: { id: true, email: true, name: true, role: true, plan: true },
    });
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/team/members/:id ──────────────────────────────────────────────
router.delete('/members/:id', requireAuth, requireAdmin, async (req: any, res: Response) => {
  try {
    if (req.params.id === req.user.id) { res.status(400).json({ error: 'Cannot remove yourself' }); return; }
    await db.user.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/team/stats ───────────────────────────────────────────────────────
// Returns per-agent activity for the last 30 days
router.get('/stats', requireAuth, requireAdmin, async (_req: any, res: Response) => {
  try {
    const since = new Date(Date.now() - 30 * 86400000);
    const users = await db.user.findMany({
      select: { id: true, email: true, name: true, role: true },
    });

    // For now, aggregate all calls/messages (multi-agent contact assignment comes in a future update)
    const [totalCalls, totalMessages, hotLeads, appointments] = await Promise.all([
      prisma.call.count({ where: { calledAt: { gte: since } } }),
      prisma.message.count({ where: { direction: 'outbound', sentAt: { gte: since } } }),
      prisma.call.count({ where: { calledAt: { gte: since }, disposition: 'hot-lead' } }),
      db.appointment.count({ where: { createdAt: { gte: since } } }).catch(() => 0),
    ]);

    res.json({
      period: '30 days',
      team:   users,
      totals: { calls: totalCalls, messages: totalMessages, hotLeads, appointments },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
