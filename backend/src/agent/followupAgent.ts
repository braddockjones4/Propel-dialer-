// ─── Proactive Follow-Up Agent ───────────────────────────────────────────────
// Runs on a schedule. Two jobs:
//   1) Re-engage active leads who have gone quiet (autonomous nudges).
//   2) Execute any scheduled/deferred actions that are now due.
import prisma from '../db';
import { getAgentSettings, AgentConfig } from './settings';
import { buildContactContext } from './context';
import { llmChat, llmConfigured, LlmMessage } from './llm';
import { dispatchSpec, executeQueuedAction } from './dispatch';
import { ActionSpec } from './executor';

const ACTIVE = ['new', 'contacted', 'callback', 'hot'];
const QUIET_HOURS_BEFORE_NUDGE = 20; // don't nudge if we messaged within this window
const MIN_HOURS_SINCE_ACTIVITY = 18; // wait this long after last activity before re-engaging
const BATCH = 12;

function heuristicNudge(ctx: Awaited<ReturnType<typeof buildContactContext>>, cfg: AgentConfig): ActionSpec | null {
  const first = ctx.contact.firstName || 'there';
  const agent = cfg.agentName;
  const status = ctx.contact.status;

  if (ctx.hasUpcomingAppointment) return null; // leave booked leads alone

  const msg =
    status === 'hot'
      ? `Hi ${first}, just following up — I have some time this week and would love to help you move forward. What day works for a quick call? — ${agent}`
      : status === 'callback'
      ? `Hi ${first}, circling back as promised! When's a good moment to connect for a few minutes? — ${agent}`
      : `Hi ${first}, checking in to see if you had any questions I can help with. Happy to jump on a quick call whenever suits you. — ${agent}`;

  return { type: 'sms', reasoning: `Proactive re-engagement (status: ${status}).`, payload: { message: msg } };
}

async function proposeNudge(contactId: string, cfg: AgentConfig): Promise<ActionSpec | null> {
  const ctx = await buildContactContext(contactId);
  if (ctx.hasUpcomingAppointment) return null;

  if (llmConfigured()) {
    try {
      const messages: LlmMessage[] = [
        { role: 'system', content: `You are ${cfg.agentName}, re-engaging a real estate lead who has gone quiet. Persona: ${cfg.persona}. Write ONE short, warm SMS (< 280 chars) that references their situation and invites a quick call. No markdown. End by signing "— ${cfg.agentName}".\n\nLEAD:\n${ctx.profile}\nCALLS: ${ctx.callSummary}\nRECENT THREAD:\n${ctx.thread || '(none)'}` },
        { role: 'user', content: 'Write the re-engagement text now. Reply with ONLY the SMS text.' },
      ];
      const r = await llmChat({ messages, model: cfg.model, temperature: 0.6, maxTokens: 160 });
      const text = r.content.trim();
      if (text) return { type: 'sms', reasoning: 'Proactive AI re-engagement.', payload: { message: text.slice(0, 480) } };
    } catch (e: any) {
      console.warn('[FollowupAgent] LLM nudge failed, heuristic:', e.message);
    }
  }
  return heuristicNudge(ctx, cfg);
}

/** Job 1 — re-engage quiet active leads. */
export async function runFollowupSweep(): Promise<{ considered: number; acted: number }> {
  const cfg = await getAgentSettings(true);
  if (!cfg.enabled || cfg.autonomyMode === 'off') return { considered: 0, acted: 0 };

  const activityCutoff = new Date(Date.now() - MIN_HOURS_SINCE_ACTIVITY * 3600_000);
  const recentMsgCutoff = new Date(Date.now() - QUIET_HOURS_BEFORE_NUDGE * 3600_000);

  const candidates = await prisma.contact.findMany({
    where: {
      status: { in: ACTIVE },
      agentPaused: false,
      updatedAt: { lte: activityCutoff },
    },
    orderBy: [{ leadScore: 'desc' }, { updatedAt: 'asc' }],
    take: 60,
  });

  let acted = 0;
  let considered = 0;
  for (const contact of candidates) {
    if (acted >= BATCH) break;
    considered++;

    // Skip if we already messaged them recently.
    const recent = await prisma.message.findFirst({
      where: { contactId: contact.id, direction: 'outbound', sentAt: { gte: recentMsgCutoff } },
    });
    if (recent) continue;

    // Skip if a pending action already exists for this contact.
    const pending = await prisma.agentAction.findFirst({
      where: { contactId: contact.id, status: { in: ['pending', 'scheduled'] } },
    });
    if (pending) continue;

    const spec = await proposeNudge(contact.id, cfg);
    if (!spec) continue;

    await dispatchSpec(spec, { contact, cfg, source: 'followup-agent' });
    acted++;
  }

  if (acted) console.log(`[FollowupAgent] swept ${considered}, acted on ${acted}`);
  return { considered, acted };
}

/** Job 2 — execute scheduled/deferred actions that are now due. */
export async function processDueActions(): Promise<number> {
  const due = await prisma.agentAction.findMany({
    where: { status: 'scheduled', scheduledFor: { lte: new Date() } },
    take: 40,
  });
  let done = 0;
  for (const a of due) {
    try { await executeQueuedAction(a.id); done++; }
    catch (e: any) { console.warn('[FollowupAgent] due action failed:', e.message); }
  }
  if (done) console.log(`[FollowupAgent] executed ${done} due actions`);
  return done;
}
