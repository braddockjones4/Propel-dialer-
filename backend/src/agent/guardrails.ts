// ─── Agent Guardrails ────────────────────────────────────────────────────────
// Hard safety rules enforced on EVERY outbound action, regardless of autonomy
// mode. These protect the user, the lead, and TCPA/consent compliance.
import prisma from '../db';
import type { AgentConfig } from './settings';

export interface GuardResult {
  ok: boolean;
  reason?: string;
  // If blocked only by quiet hours, when it may be retried:
  deferUntil?: Date;
}

// Rough timezone → UTC offset (hours). Good enough for quiet-hours gating.
const TZ_OFFSET: Record<string, number> = {
  'America/New_York': -5, 'America/Detroit': -5, 'America/Toronto': -5,
  'America/Chicago': -6, 'America/Denver': -7, 'America/Phoenix': -7,
  'America/Los_Angeles': -8, 'America/Anchorage': -9, 'Pacific/Honolulu': -10,
};

function localHourFor(tz: string | null | undefined): number {
  const offset = (tz && TZ_OFFSET[tz] !== undefined) ? TZ_OFFSET[tz] : -6; // default Central
  const utcH = new Date().getUTCHours();
  let h = (utcH + offset) % 24;
  if (h < 0) h += 24;
  return h;
}

/** Quiet hours: no outbound between quietHoursStart (e.g. 21) and quietHoursEnd (e.g. 8). */
export function quietHoursCheck(cfg: AgentConfig, tz?: string | null): GuardResult {
  const h = localHourFor(tz);
  const { quietHoursStart: start, quietHoursEnd: end } = cfg;
  const inQuiet = start > end
    ? (h >= start || h < end)   // wraps midnight (21 → 8)
    : (h >= start && h < end);
  if (!inQuiet) return { ok: true };

  // Compute next allowed time (roughly next local quietHoursEnd).
  const offset = (tz && TZ_OFFSET[tz] !== undefined) ? TZ_OFFSET[tz] : -6;
  const now = new Date();
  const defer = new Date(now);
  // hours until local end
  let delta = (end - h + 24) % 24;
  if (delta === 0) delta = 1;
  defer.setUTCHours(defer.getUTCHours() + delta, 0, 0, 0);
  return { ok: false, reason: 'quiet-hours', deferUntil: defer };
}

/** How many outbound SMS this contact has received today (human + agent). */
export async function outboundToday(contactId: string): Promise<number> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return prisma.message.count({
    where: { contactId, direction: 'outbound', sentAt: { gte: since } },
  });
}

/** Number of consecutive agent replies in a thread since the last inbound. */
export async function agentRepliesSinceInbound(contactId: string): Promise<number> {
  const recent = await prisma.message.findMany({
    where: { contactId },
    orderBy: { sentAt: 'desc' },
    take: 20,
  });
  let count = 0;
  for (const m of recent) {
    if (m.direction === 'inbound') break;
    if (m.direction === 'outbound') count++;
  }
  return count;
}

export function hasEscalationKeyword(text: string, csv: string): boolean {
  const words = csv.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  const t = (text || '').toLowerCase();
  return words.some((w) => w && t.includes(w));
}

/**
 * The master gate for sending an outbound SMS to a contact.
 * Enforces: agent enabled, contact not DNC/paused, daily cap, quiet hours.
 */
export async function canSendSms(
  cfg: AgentConfig,
  contact: { id: string; status?: string | null; agentPaused?: boolean; timezone?: string | null },
): Promise<GuardResult> {
  if (!cfg.enabled) return { ok: false, reason: 'agent-disabled' };
  if (contact.status === 'dnc') return { ok: false, reason: 'contact-dnc' };
  if (contact.agentPaused) return { ok: false, reason: 'contact-paused' };

  const sent = await outboundToday(contact.id);
  if (sent >= cfg.dailySmsCapPerContact) return { ok: false, reason: 'daily-cap' };

  const quiet = quietHoursCheck(cfg, contact.timezone);
  if (!quiet.ok) return quiet;

  return { ok: true };
}
