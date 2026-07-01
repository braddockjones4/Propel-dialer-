// ─── Agent Engine ────────────────────────────────────────────────────────────
// The decision core. Given a contact and a goal, it reasons (via LLM tool-use,
// with a deterministic fallback) and proposes concrete ActionSpecs, which are
// then run through dispatch (autonomy mode + guardrails).
import prisma from '../db';
import { getAgentSettings, AgentConfig } from './settings';
import { buildContactContext } from './context';
import { llmChat, llmConfigured, LlmToolSchema, LlmMessage } from './llm';
import { dispatchSpec } from './dispatch';
import { ActionSpec } from './executor';
import { hasEscalationKeyword, agentRepliesSinceInbound } from './guardrails';

const STATUS_ENUM = ['new', 'contacted', 'callback', 'hot', 'appointment', 'closed', 'dnc'];

// Tool schemas exposed to the model.
function toolSchemas(): LlmToolSchema[] {
  return [
    {
      name: 'send_reply',
      description: 'Send a single SMS reply to the lead. Keep it under 300 characters, warm, human, no markdown.',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'The SMS text to send.' } },
        required: ['message'],
      },
    },
    {
      name: 'book_appointment',
      description: 'Book a listing/consultation appointment when the lead has agreed to a specific time.',
      parameters: {
        type: 'object',
        properties: {
          iso_datetime: { type: 'string', description: 'Appointment start in ISO 8601, e.g. 2026-07-03T15:00:00' },
          title: { type: 'string' },
          location: { type: 'string' },
          confirm_message: { type: 'string', description: 'SMS confirmation to send the lead.' },
        },
        required: ['iso_datetime'],
      },
    },
    {
      name: 'update_status',
      description: 'Update the lead pipeline status when the conversation clearly warrants it.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: STATUS_ENUM } },
        required: ['status'],
      },
    },
    {
      name: 'add_note',
      description: 'Record an internal note about the lead (not sent to them).',
      parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
    },
    {
      name: 'escalate_to_human',
      description: 'Hand off to the human agent when unsure, when the lead is upset, asks something you cannot answer, or requests a human.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
    {
      name: 'do_nothing',
      description: 'Take no action (e.g. the lead said thanks and no reply is needed).',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  ];
}

function systemPrompt(cfg: AgentConfig, ctx: Awaited<ReturnType<typeof buildContactContext>>, goal: string): string {
  const now = new Date();
  return `You are ${cfg.agentName}, an autonomous assistant working leads for a real estate agent.
PERSONA: ${cfg.persona}
TONE: ${cfg.tone}
GOALS: ${cfg.goals}

CURRENT TASK: ${goal}

Current date/time: ${now.toISOString()} (${now.toLocaleString('en-US')}).
When booking, propose concrete times in the near future during business hours.

LEAD PROFILE:
${ctx.profile}

CALL HISTORY: ${ctx.callSummary}
${ctx.hasUpcomingAppointment ? 'NOTE: This lead already has an upcoming appointment.' : ''}

CONVERSATION SO FAR:
${ctx.thread || '(no prior messages)'}

RULES:
- Use the provided tools to act. Prefer exactly ONE action.
- SMS must be concise (< 300 chars), natural, and never repeat yourself.
- Never invent facts about the property, pricing, or the market. If asked something you don't know, offer to have the agent follow up, or escalate.
- If the lead is upset, mentions legal action, or asks for a human — escalate_to_human.
- If the lead wants to stop being contacted — escalate_to_human with reason "opt-out".
- If the lead proposes or agrees to a specific time — book_appointment.`;
}

function mapToolCallToSpec(name: string, args: any): ActionSpec | null {
  switch (name) {
    case 'send_reply':
      if (!args.message) return null;
      return { type: 'sms', reasoning: 'Conversational reply to the lead.', payload: { message: String(args.message).slice(0, 480) } };
    case 'book_appointment':
      return {
        type: 'appointment',
        reasoning: 'Lead agreed to a time.',
        payload: {
          scheduledAt: args.iso_datetime,
          title: args.title || 'Listing Appointment',
          location: args.location,
          message: args.confirm_message,
        },
      };
    case 'update_status':
      if (!STATUS_ENUM.includes(args.status)) return null;
      return { type: 'status', reasoning: 'Pipeline update from conversation.', payload: { status: args.status } };
    case 'add_note':
      if (!args.note) return null;
      return { type: 'note', reasoning: 'Internal note.', payload: { note: args.note } };
    case 'escalate_to_human':
      return { type: 'escalate', reasoning: args.reason || 'needs human', payload: { note: args.reason } };
    case 'do_nothing':
      return null;
    default:
      return null;
  }
}

// ── Deterministic fallback (no LLM key, or LLM failure) ───────────────────────
function heuristicReply(ctx: Awaited<ReturnType<typeof buildContactContext>>, cfg: AgentConfig): ActionSpec {
  const text = (ctx.lastInboundText || '').toLowerCase();
  const first = ctx.contact.firstName || 'there';
  const agent = cfg.agentName;

  const opt = /(stop|unsubscribe|leave me alone|remove me)/.test(text);
  if (opt) return { type: 'escalate', reasoning: 'Possible opt-out', payload: { note: 'Lead may want to opt out.' } };

  const upset = hasEscalationKeyword(text, cfg.escalateKeywords);
  if (upset) return { type: 'escalate', reasoning: 'Escalation keyword detected', payload: { note: 'Lead message triggered escalation keywords.' } };

  const positive = /(yes|interested|sure|sounds good|ok|okay|let'?s|call me|please do|go ahead)/.test(text);
  if (positive) {
    return {
      type: 'sms',
      reasoning: 'Lead signaled interest — move toward booking.',
      payload: { message: `Great to hear, ${first}! I'd love to set up a quick 15-minute call to go over everything. Are you free tomorrow afternoon or would morning work better? — ${agent}` },
    };
  }

  const asksInfo = /(how much|price|value|worth|info|question|when|what|details|cost)/.test(text);
  if (asksInfo) {
    return {
      type: 'sms',
      reasoning: 'Lead asked a question — respond helpfully and offer a call.',
      payload: { message: `Good question, ${first}! I can pull together exactly what you need. The easiest way is a quick call — what time works for you today or tomorrow? — ${agent}` },
    };
  }

  return {
    type: 'sms',
    reasoning: 'General re-engagement nudge.',
    payload: { message: `Hi ${first}, thanks for the reply! I'd love to help however I can. When's a good time for a quick chat? — ${agent}` },
  };
}

export interface RunResult {
  ran: boolean;
  skipped?: string;
  actions: { type: string; status: string; id?: string }[];
  usedLlm: boolean;
}

/**
 * PURE DECISION CORE (no DB, no side-effects): given a contact context + config,
 * decide the best action(s). Shared by runInboxAgent and the eval harness so the
 * agent's real "brain" is what gets tested — not a copy that can drift.
 */
export async function decideActions(
  ctx: Awaited<ReturnType<typeof buildContactContext>>,
  cfg: AgentConfig,
): Promise<{ specs: ActionSpec[]; usedLlm: boolean }> {
  // Immediate keyword escalation on the latest inbound.
  if (ctx.lastInboundText && hasEscalationKeyword(ctx.lastInboundText, cfg.escalateKeywords)) {
    return {
      specs: [{ type: 'escalate', reasoning: 'Escalation keyword', payload: { note: `Flagged message: "${ctx.lastInboundText.slice(0, 120)}"` } }],
      usedLlm: false,
    };
  }

  const specs: ActionSpec[] = [];
  let usedLlm = false;

  if (llmConfigured()) {
    try {
      const messages: LlmMessage[] = [
        { role: 'system', content: systemPrompt(cfg, ctx, 'Respond to the latest inbound message and advance toward booking an appointment.') },
        { role: 'user', content: `The lead's latest message: "${ctx.lastInboundText || '(no text)'}"\nDecide the single best action using the tools.` },
      ];
      const result = await llmChat({ messages, tools: toolSchemas(), model: cfg.model, temperature: 0.5, maxTokens: 400 });
      usedLlm = true;
      for (const tc of result.toolCalls) {
        const spec = mapToolCallToSpec(tc.name, tc.arguments);
        if (spec) specs.push(spec);
      }
      if (specs.length === 0 && result.content.trim()) {
        specs.push({ type: 'sms', reasoning: 'Model free-text reply.', payload: { message: result.content.trim().slice(0, 480) } });
      }
    } catch (e: any) {
      console.warn('[Agent] LLM failed, using heuristic:', e.message);
    }
  }

  if (specs.length === 0) specs.push(heuristicReply(ctx, cfg));
  return { specs, usedLlm };
}

/**
 * Run the agent on a contact in response to an inbound message (or manual trigger).
 */
export async function runInboxAgent(contactId: string, opts: { source?: 'inbox-agent' | 'manual' } = {}): Promise<RunResult> {
  const cfg = await getAgentSettings();
  const source = opts.source || 'inbox-agent';
  if (!cfg.enabled || cfg.autonomyMode === 'off') return { ran: false, skipped: 'agent-off', actions: [], usedLlm: false };

  const ctx = await buildContactContext(contactId);
  const contact = ctx.contact;

  if (contact.status === 'dnc' || contact.agentPaused) {
    return { ran: false, skipped: 'contact-excluded', actions: [], usedLlm: false };
  }

  // Loop-guard: too many agent replies without a human/lead turn → escalate.
  const streak = await agentRepliesSinceInbound(contactId);
  if (streak >= cfg.maxAgentRepliesPerThread) {
    const esc: ActionSpec = { type: 'escalate', reasoning: 'Reply cap reached', payload: { note: 'Conversation exceeded auto-reply cap — needs human.' } };
    const row = await dispatchSpec(esc, { contact, cfg, source });
    return { ran: true, actions: [{ type: 'escalate', status: row.status, id: row.id }], usedLlm: false };
  }

  const { specs, usedLlm } = await decideActions(ctx, cfg);

  const actions: RunResult['actions'] = [];
  for (const spec of specs) {
    const row = await dispatchSpec(spec, { contact, cfg, source });
    actions.push({ type: spec.type, status: row.status, id: row.id });
  }

  return { ran: true, actions, usedLlm };
}

/**
 * Draft-only: produce a suggested reply WITHOUT sending or queuing. Used by the
 * Inbox "Draft with AI" button so the human can review, edit, and send.
 */
export async function draftReply(contactId: string): Promise<{ message: string; usedLlm: boolean }> {
  const cfg = await getAgentSettings();
  const ctx = await buildContactContext(contactId);

  if (llmConfigured()) {
    try {
      const messages: LlmMessage[] = [
        { role: 'system', content: systemPrompt(cfg, ctx, 'Draft the single best SMS reply to send this lead right now.') },
        { role: 'user', content: `Write ONLY the SMS reply text (no quotes, no preamble). Latest lead message: "${ctx.lastInboundText || '(none)'}"` },
      ];
      const r = await llmChat({ messages, model: cfg.model, temperature: 0.6, maxTokens: 200 });
      const text = r.content.trim();
      if (text) return { message: text.slice(0, 480), usedLlm: true };
    } catch (e: any) {
      console.warn('[Agent] draft LLM failed, heuristic:', e.message);
    }
  }
  const spec = heuristicReply(ctx, cfg);
  return { message: spec.payload.message || '', usedLlm: false };
}
