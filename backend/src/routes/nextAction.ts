/**
 * AI Next-Action Engine
 * After each call, analyzes the contact and recommends the single best next step.
 * Returns a recommended action + one-click execute endpoint.
 */
import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import prisma from '../db';
import { getAgentName } from '../agent/settings';

const router = Router();

export interface NextAction {
  action: 'call-back' | 'send-sms' | 'send-email' | 'book-appointment' | 'drop-voicemail' | 'mark-dnc' | 'wait';
  label: string;
  message?: string;   // pre-filled SMS/email body
  scheduleIn?: number; // minutes until next action (for call-back)
  reasoning: string;
  urgency: 'high' | 'medium' | 'low';
}

async function computeNextAction(contactId: string): Promise<NextAction> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    include: {
      calls:    { orderBy: { calledAt: 'desc' }, take: 5 },
      messages: { orderBy: { sentAt: 'desc' },   take: 3 },
    },
  });

  if (!contact) throw new Error('Contact not found');

  const { OPENAI_API_KEY } = process.env;
  const agentName = await getAgentName();

  const lastCall = contact.calls[0];
  const lastDisp = lastCall?.disposition || 'none';
  const lastMsg  = contact.messages[0];
  const hasEmail = Boolean(contact.email);

  // Static logic fallback (always works, even without OpenAI)
  const staticAction = (): NextAction => {
    if (contact.status === 'dnc') return { action: 'wait', label: 'No action', reasoning: 'Contact is on DNC list.', urgency: 'low' };

    if (lastDisp === 'hot-lead' || contact.status === 'hot') {
      return {
        action: 'book-appointment',
        label: 'Book appointment now',
        reasoning: 'Hot lead — strike while the iron is hot. Book the appointment immediately.',
        urgency: 'high',
      };
    }
    if (lastDisp === 'callback-scheduled' || contact.status === 'callback') {
      return {
        action: 'call-back',
        label: 'Call back',
        scheduleIn: 60,
        reasoning: 'They requested a callback. Call within the hour.',
        urgency: 'high',
      };
    }
    if (lastDisp === 'left-voicemail' || lastDisp === 'no-answer') {
      const daysSince = lastCall ? (Date.now() - new Date(lastCall.calledAt).getTime()) / 86400000 : 99;
      if (daysSince < 1) {
        return {
          action: 'send-sms',
          label: 'Send follow-up text',
          message: `Hi ${contact.firstName}, this is ${agentName}. I just tried to reach you — give me a quick call back when you get a chance!`,
          reasoning: 'Left a voicemail. Follow up immediately with a text to increase response rate.',
          urgency: 'high',
        };
      }
      return {
        action: 'call-back',
        label: 'Try again tomorrow',
        scheduleIn: 1440,
        reasoning: 'Already sent a text after the voicemail. Give them a day before calling again.',
        urgency: 'medium',
      };
    }
    if (lastMsg?.direction === 'inbound') {
      return {
        action: 'call-back',
        label: 'Call — they texted you',
        scheduleIn: 5,
        reasoning: `${contact.firstName} replied to your text. Call them back right now while they're engaged.`,
        urgency: 'high',
      };
    }
    if (hasEmail && contact.calls.length >= 2) {
      return {
        action: 'send-email',
        label: 'Send email follow-up',
        message: `Hi ${contact.firstName}, I wanted to reach out again about your property at ${contact.address || 'your home'}. I'd love to share some information that could be valuable for you. When would be a good time to connect?`,
        reasoning: 'Multiple calls with no conversion. Try a different channel — email can be less intrusive.',
        urgency: 'medium',
      };
    }
    return {
      action: 'call-back',
      label: 'Call back',
      scheduleIn: 1440,
      reasoning: 'No strong signal yet. Continue the follow-up cycle.',
      urgency: 'low',
    };
  };

  if (!OPENAI_API_KEY) return staticAction();

  // AI-powered recommendation
  const callSummary = contact.calls.slice(0, 3).map(c =>
    `${new Date(c.calledAt).toLocaleDateString()}: ${c.disposition || 'no disposition'}, ${c.duration}s`
  ).join('; ') || 'No calls yet';

  const msgSummary = contact.messages.slice(0, 2).map(m =>
    `${m.direction} "${m.body.slice(0, 60)}"`
  ).join('; ') || 'No messages yet';

  const prompt = `You are an elite real estate sales coach. Analyze this lead and recommend the SINGLE best next action.

LEAD: ${contact.firstName} ${contact.lastName} | Source: ${contact.source} | Status: ${contact.status} | Score: ${contact.leadScore ?? 'unscored'}/100
ADDRESS: ${contact.address || 'unknown'}, ${contact.city || ''}, ${contact.state || ''}
HAS EMAIL: ${hasEmail}
LAST CALL: ${lastDisp} (${lastCall ? new Date(lastCall.calledAt).toLocaleDateString() : 'never'})
CALL HISTORY: ${callSummary}
TEXT HISTORY: ${msgSummary}

Return ONLY valid JSON (no markdown, no extra text):
{
  "action": "call-back" | "send-sms" | "send-email" | "book-appointment" | "drop-voicemail" | "mark-dnc" | "wait",
  "label": "<5-7 word action label>",
  "message": "<pre-written SMS or email body if action is send-sms or send-email, else null>",
  "scheduleIn": <minutes until action, integer, or null>,
  "reasoning": "<1-2 sentence explanation>",
  "urgency": "high" | "medium" | "low"
}`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 300 }),
    });
    const data = await resp.json() as any;
    const text = data.choices?.[0]?.message?.content?.trim() || '{}';
    const parsed = JSON.parse(text);
    return parsed as NextAction;
  } catch (e: any) {
    console.warn('[NextAction] OpenAI failed, using static:', e.message);
    return staticAction();
  }
}

// ── GET /api/next-action/:contactId ──────────────────────────────────────────
router.get('/:contactId', async (req: Request, res: Response) => {
  try {
    const action = await computeNextAction(req.params.contactId);
    res.json(action);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/next-action/:contactId/execute ──────────────────────────────────
// One-click execute the recommended action
router.post('/:contactId/execute', async (req: Request, res: Response) => {
  try {
    const { action, message } = req.body as { action: NextAction['action']; message?: string };
    const { contactId } = req.params;

    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) { res.status(404).json({ error: 'Contact not found' }); return; }

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID } = process.env;

    switch (action) {
      case 'send-sms': {
        if (!message) { res.status(400).json({ error: 'message required for send-sms' }); return; }
        if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_CALLER_ID) {
          res.status(500).json({ error: 'Twilio not configured' }); return;
        }
        const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        await client.messages.create({ to: contact.phone!, from: TWILIO_CALLER_ID, body: message });
        await prisma.message.create({
          data: { contactId, direction: 'outbound', body: message, fromNumber: TWILIO_CALLER_ID, toNumber: contact.phone! },
        });
        res.json({ executed: true, action });
        break;
      }
      case 'mark-dnc': {
        await prisma.contact.update({ where: { id: contactId }, data: { status: 'dnc' } });
        res.json({ executed: true, action });
        break;
      }
      default:
        res.json({ executed: false, action, requiresFrontend: true });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export { computeNextAction };
export default router;
