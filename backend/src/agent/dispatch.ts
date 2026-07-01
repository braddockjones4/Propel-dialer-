// ─── Dispatch ────────────────────────────────────────────────────────────────
// Turns an ActionSpec into a persisted AgentAction, applying the autonomy mode
// and guardrails. This is the ONLY place actions become real, so every path —
// inbox agent, follow-up sweep, manual trigger — shares the same safety logic.
import prisma from '../db';
import type { AgentConfig } from './settings';
import { canSendSms } from './guardrails';
import { executeActionSpec, ActionSpec, refreshLeadScore } from './executor';

const OUTBOUND = new Set(['sms', 'followup', 'appointment']);
const MUTATING = new Set(['status', 'dnc']);

export interface DispatchCtx {
  contact: { id: string; phone: string; status?: string | null; agentPaused?: boolean; timezone?: string | null };
  cfg: AgentConfig;
  source: 'inbox-agent' | 'followup-agent' | 'manual';
}

async function record(spec: ActionSpec, ctx: DispatchCtx, status: string, extra: Partial<{ error: string; scheduledFor: Date; executedAt: Date }> = {}) {
  return prisma.agentAction.create({
    data: {
      contactId: ctx.contact.id,
      type: spec.type,
      status,
      channel: spec.type === 'note' || spec.type === 'escalate' || spec.type === 'status' || spec.type === 'dnc' ? 'system' : 'sms',
      payload: JSON.stringify(spec.payload || {}),
      reasoning: spec.reasoning || null,
      source: ctx.source,
      scheduledFor: extra.scheduledFor || (spec.payload.scheduledFor ? new Date(spec.payload.scheduledFor) : null),
      error: extra.error || null,
      executedAt: extra.executedAt || null,
    },
  });
}

/** Apply autonomy mode + guardrails to a single proposed action. */
export async function dispatchSpec(spec: ActionSpec, ctx: DispatchCtx) {
  const { cfg, contact } = ctx;

  // Internal, non-messaging actions (note / escalate) always run — nothing leaves
  // the system, and escalation must reach the human even in review mode.
  if (spec.type === 'note' || spec.type === 'escalate') {
    try {
      await executeActionSpec(spec, contact.id);
      return record(spec, ctx, 'executed', { executedAt: new Date() });
    } catch (e: any) {
      return record(spec, ctx, 'failed', { error: e.message });
    }
  }

  // REVIEW mode → queue everything outbound/mutating for human approval.
  if (cfg.autonomyMode === 'review' && (OUTBOUND.has(spec.type) || MUTATING.has(spec.type))) {
    return record(spec, ctx, 'pending');
  }

  // AUTO mode (or mutating in any executing mode) → enforce guardrails, then run.
  if (spec.type === 'sms' || spec.type === 'followup') {
    const guard = await canSendSms(cfg, contact);
    if (!guard.ok) {
      if (guard.reason === 'quiet-hours' && guard.deferUntil) {
        return record(spec, ctx, 'scheduled', { scheduledFor: guard.deferUntil });
      }
      return record(spec, ctx, 'skipped', { error: guard.reason });
    }
  }
  if (spec.type === 'appointment') {
    if (!cfg.enabled || contact.status === 'dnc' || contact.agentPaused) {
      return record(spec, ctx, 'skipped', { error: 'blocked' });
    }
  }

  try {
    const result = await executeActionSpec(spec, contact.id);
    const row = await record(spec, ctx, spec.type === 'sms' || spec.type === 'followup' ? 'sent' : 'executed', { executedAt: new Date() });
    await refreshLeadScore(contact.id);
    return { ...row, result };
  } catch (e: any) {
    return record(spec, ctx, 'failed', { error: e.message });
  }
}

/** Execute a previously-queued (pending/approved/scheduled) AgentAction row. */
export async function executeQueuedAction(actionId: string, opts: { overrideMessage?: string } = {}) {
  const row = await prisma.agentAction.findUnique({ where: { id: actionId }, include: { contact: true } });
  if (!row) throw new Error('Action not found');
  if (!row.contactId || !row.contact) throw new Error('Action has no contact');

  const payload = JSON.parse(row.payload || '{}');
  if (opts.overrideMessage) payload.message = opts.overrideMessage;

  const spec: ActionSpec = { type: row.type as any, reasoning: row.reasoning || undefined, payload };
  try {
    const result = await executeActionSpec(spec, row.contactId);
    const updated = await prisma.agentAction.update({
      where: { id: actionId },
      data: {
        status: row.type === 'sms' || row.type === 'followup' ? 'sent' : 'executed',
        executedAt: new Date(),
        payload: JSON.stringify(payload),
      },
    });
    await refreshLeadScore(row.contactId);
    return { ...updated, result };
  } catch (e: any) {
    return prisma.agentAction.update({ where: { id: actionId }, data: { status: 'failed', error: e.message } });
  }
}
