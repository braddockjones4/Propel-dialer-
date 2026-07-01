// ─── Agent API ───────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import prisma from '../db';
import { getAgentSettings, updateAgentSettings } from '../agent/settings';
import { runInboxAgent, draftReply } from '../agent/engine';
import { executeQueuedAction } from '../agent/dispatch';
import { runFollowupSweep, processDueActions } from '../agent/followupAgent';

const router = Router();

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', async (_req: Request, res: Response) => {
  res.json(await getAgentSettings(true));
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const updated = await updateAgentSettings(req.body || {});
    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ── Activity log ────────────────────────────────────────────────────────────
router.get('/actions', async (req: Request, res: Response) => {
  const status = (req.query.status as string) || undefined;
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
  const actions = await prisma.agentAction.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { contact: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } } },
  });
  res.json(actions.map((a) => ({ ...a, payload: safeParse(a.payload) })));
});

// ── Approval queue ──────────────────────────────────────────────────────────
router.get('/pending', async (_req: Request, res: Response) => {
  const actions = await prisma.agentAction.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    include: { contact: { select: { id: true, firstName: true, lastName: true, phone: true, status: true, leadScore: true } } },
  });
  res.json(actions.map((a) => ({ ...a, payload: safeParse(a.payload) })));
});

// Approve (optionally with an edited message) → executes now.
router.post('/actions/:id/approve', async (req: Request, res: Response) => {
  try {
    const { message } = req.body || {};
    const result = await executeQueuedAction(req.params.id, message ? { overrideMessage: message } : {});
    res.json({ ...result, payload: safeParse((result as any).payload) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/actions/:id/reject', async (req: Request, res: Response) => {
  const updated = await prisma.agentAction.update({
    where: { id: req.params.id },
    data: { status: 'rejected' },
  });
  res.json(updated);
});

// ── Manual trigger: run the agent on a specific contact now ────────────────────
router.post('/run/:contactId', async (req: Request, res: Response) => {
  try {
    const result = await runInboxAgent(req.params.contactId, { source: 'manual' });
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Draft-only: returns a suggested reply for the human to edit/send (no send).
router.post('/draft/:contactId', async (req: Request, res: Response) => {
  try {
    const result = await draftReply(req.params.contactId);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// ── Manual maintenance triggers (handy for demos) ──────────────────────────────
router.post('/sweep', async (_req: Request, res: Response) => {
  const swept = await runFollowupSweep();
  const due = await processDueActions();
  res.json({ ...swept, dueExecuted: due });
});

// ── Dashboard stats ────────────────────────────────────────────────────────────
router.get('/stats', async (_req: Request, res: Response) => {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const [pending, sentToday, appts, escalations, scheduled] = await Promise.all([
    prisma.agentAction.count({ where: { status: 'pending' } }),
    prisma.agentAction.count({ where: { type: { in: ['sms', 'followup'] }, status: { in: ['sent', 'executed'] }, executedAt: { gte: startOfDay } } }),
    prisma.agentAction.count({ where: { type: 'appointment', status: 'executed' } }),
    prisma.agentAction.count({ where: { type: 'escalate' } }),
    prisma.agentAction.count({ where: { status: 'scheduled' } }),
  ]);
  const settings = await getAgentSettings();
  res.json({ pending, sentToday, appointmentsBooked: appts, escalations, scheduled, enabled: settings.enabled, autonomyMode: settings.autonomyMode });
});

function safeParse(s: string) { try { return JSON.parse(s); } catch { return {}; } }

export default router;
