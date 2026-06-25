/**
 * AI-Personalized Call Script
 * Generates a custom opener + objection responses for each contact
 * using GPT-4o-mini. Takes 1-2 seconds.
 *
 * Requires: OPENAI_API_KEY in .env
 */

import { Router, Request, Response } from 'express';
import prisma from '../db';

const router = Router();

// Simple in-memory cache: contactId → { script, generatedAt }
const scriptCache = new Map<string, { script: AiScript; generatedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

interface AiScript {
  opener: string;
  objections: Array<{ trigger: string; response: string }>;
  closeAttempt: string;
  tip: string;
}

const AGENT_NAME = process.env.AGENT_NAME || 'Braddock';

async function generateScript(contactId: string): Promise<AiScript> {
  const contact = await prisma.contact.findUnique({
    where:   { id: contactId },
    include: {
      calls: { orderBy: { calledAt: 'desc' }, take: 5 },
      messages: { where: { direction: 'inbound' }, orderBy: { sentAt: 'desc' }, take: 3 },
    },
  });

  if (!contact) throw new Error('Contact not found');

  const { OPENAI_API_KEY } = process.env;

  // Fallback scripts if no OpenAI key
  if (!OPENAI_API_KEY) {
    return getStaticScript(contact.source, contact.firstName, contact.address ?? undefined);
  }

  const callHistory = contact.calls
    .map(c => `- ${new Date(c.calledAt).toLocaleDateString()}: ${c.disposition || 'no disposition'}, ${c.duration}s`)
    .join('\n') || 'No previous calls';

  const textReplies = contact.messages.map(m => `"${m.body}"`).join(', ') || 'None';

  const prompt = `You are an elite real estate sales coach writing a personalized call script for agent ${AGENT_NAME}.

CONTACT PROFILE:
- Name: ${contact.firstName} ${contact.lastName}
- Lead type: ${contact.source} (${getSourceDescription(contact.source)})
- Status: ${contact.status}
- Address: ${contact.address || 'Unknown'}, ${contact.city || ''}, ${contact.state || ''}
- Previous calls:\n${callHistory}
- Text replies from them: ${textReplies}
- Lead score: ${contact.leadScore ?? 'not scored'}/100

Write a PERSONALIZED script for this specific contact. Be concise and natural — this is spoken, not written.

Return ONLY valid JSON:
{
  "opener": "<30-50 word personalized opening line using their name and property address>",
  "objections": [
    { "trigger": "<common objection for this lead type>", "response": "<natural 20-30 word response>" },
    { "trigger": "<another objection>", "response": "<response>" },
    { "trigger": "<third objection>", "response": "<response>" }
  ],
  "closeAttempt": "<15-25 word close for an appointment or next step>",
  "tip": "<one specific coaching tip for this exact lead based on their history>"
}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:       'gpt-4o-mini',
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens:  600,
      }),
    });

    const data = await res.json() as any;
    const text = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(text.trim());
    return parsed as AiScript;
  } catch (err: any) {
    console.warn('[AIScript] OpenAI error, using static script:', err.message);
    return getStaticScript(contact.source, contact.firstName, contact.address ?? undefined);
  }
}

function getSourceDescription(source: string): string {
  const map: Record<string, string> = {
    expired:       'their listing expired without selling — they likely have frustration with their previous agent',
    fsbo:          'selling without an agent — they want to avoid commission but may be struggling',
    circle:        'a neighbor of a recently sold property — may be curious about their home\'s value',
    'past-client': 'they bought or sold with this agent before — warm relationship already exists',
    manual:        'manually added prospect',
  };
  return map[source] || source;
}

function getStaticScript(source: string, firstName: string, address?: string): AiScript {
  const scripts: Record<string, AiScript> = {
    expired: {
      opener: `Hi ${firstName}, this is ${AGENT_NAME} calling about ${address || 'your property'}. I noticed your listing came off the market and I had a few ideas I wanted to share with you real quick. Do you have just two minutes?`,
      objections: [
        { trigger: 'Not interested', response: `I completely understand. Before you go, can I ask — are you still hoping to sell, or have your plans changed?` },
        { trigger: 'Taking a break', response: `That makes a lot of sense. When you\'re ready to move forward, what would be most important to you in the agent you choose?` },
        { trigger: 'Already have an agent', response: `No problem at all. If things don\'t work out, I\'d love to be your backup. May I keep your info on file?` },
      ],
      closeAttempt: `I\'d love to swing by for just 20 minutes and share what I\'d do differently. Would ${new Date(Date.now() + 86400000).toLocaleDateString('en-US', { weekday: 'long' })} or Wednesday work for you?`,
      tip: `Expired listings are frustrated — acknowledge their pain first before pitching solutions.`,
    },
    fsbo: {
      opener: `Hi ${firstName}, my name\'s ${AGENT_NAME} and I work with a lot of buyers actively searching in your area. I saw your home at ${address || 'your address'} for sale and wanted to reach out — would you be open to working with a buyer\'s agent?`,
      objections: [
        { trigger: 'Don\'t want to pay commission', response: `Totally fair. If I brought you a pre-qualified buyer who\'d pay your full asking price, would saving time and stress be worth a conversation?` },
        { trigger: 'Already have showings', response: `That\'s great news! My buyers are very serious and move fast. Could I schedule a showing this week?` },
        { trigger: 'Want to try it myself first', response: `I respect that. Most FSBOs I talk to end up selling for 13% less than listed. Can I email you some data on this neighborhood?` },
      ],
      closeAttempt: `Can I bring a buyer by this week? I just need 30 minutes and I think you\'ll be impressed with what they can offer.`,
      tip: `FSBOs care about money, not service. Lead with buyer access and net proceeds, not your credentials.`,
    },
    circle: {
      opener: `Hi ${firstName}, this is ${AGENT_NAME}, I\'m a real estate agent who just helped a neighbor sell nearby. I\'m calling because I have buyers who love this neighborhood and not enough homes for them. Have you thought at all about selling in the next 6-12 months?`,
      objections: [
        { trigger: 'Not thinking about it', response: `No problem! Out of curiosity, if prices were right, would it even be something you\'d consider? Home values in your area have moved a lot.` },
        { trigger: 'Maybe in a few years', response: `That makes sense. Would it help to know what your home is worth now so you can plan? I can give you a quick estimate at no cost.` },
      ],
      closeAttempt: `Could I drop off a quick market report for your neighborhood? Takes 10 minutes and you\'ll know exactly where you stand.`,
      tip: `Circle prospects aren\'t in selling mode yet — your goal is a future appointment, not a listing now.`,
    },
  };

  return scripts[source] || scripts.expired;
}

// ── GET /api/ai-script/:contactId ─────────────────────────────────────────────
router.get('/:contactId', async (req: Request, res: Response) => {
  const { contactId } = req.params;
  const forceRefresh  = req.query.refresh === 'true';

  // Check cache
  const cached = scriptCache.get(contactId);
  if (cached && !forceRefresh && Date.now() - cached.generatedAt < CACHE_TTL) {
    res.json({ ...cached.script, cached: true });
    return;
  }

  try {
    const script = await generateScript(contactId);
    scriptCache.set(contactId, { script, generatedAt: Date.now() });
    res.json({ ...script, cached: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
