/**
 * Lead Scoring Engine
 * Scores each contact 0-100 based on multiple signals.
 * Higher = more likely to convert. Dialers queue by score desc.
 *
 * Scoring factors:
 *  - Source type        (0-25 pts)  Expired/FSBO are highest intent
 *  - Call history       (0-20 pts)  Answered calls > voicemails > no-answer
 *  - Text reply         (0-20 pts)  Replied to SMS = huge intent signal
 *  - Status             (0-20 pts)  Hot > callback > contacted > new
 *  - Recency            (0-15 pts)  Newer leads are hotter
 */

import prisma from './db';

const SOURCE_SCORE: Record<string, number> = {
  expired:       25,
  fsbo:          22,
  circle:        15,
  'past-client': 18,
  manual:        10,
};

const STATUS_SCORE: Record<string, number> = {
  hot:         20,
  callback:    15,
  appointment: 20,
  contacted:   8,
  new:         5,
  dnc:         0,
  closed:      0,
};

const DISP_SCORE: Record<string, number> = {
  'hot-lead':          20,
  'callback-scheduled':12,
  'not-interested':     2,
  'left-voicemail':     4,
  'no-answer':          2,
  'not-home':           3,
};

function recencyScore(updatedAt: Date): number {
  const days = (Date.now() - updatedAt.getTime()) / 86400000;
  if (days < 1)  return 15;
  if (days < 3)  return 12;
  if (days < 7)  return 8;
  if (days < 14) return 5;
  if (days < 30) return 2;
  return 0;
}

export async function computeLeadScore(contactId: string): Promise<number> {
  const contact = await prisma.contact.findUnique({
    where:   { id: contactId },
    include: {
      calls:    { orderBy: { calledAt: 'desc' }, take: 10 },
      messages: { where: { direction: 'inbound' }, orderBy: { sentAt: 'desc' }, take: 5 },
    },
  });

  if (!contact) return 0;

  let score = 0;

  // 1. Source type
  score += SOURCE_SCORE[contact.source] ?? 10;

  // 2. Status
  score += STATUS_SCORE[contact.status] ?? 5;

  // 3. Call history — best disposition from recent calls
  const bestDisp = contact.calls[0]?.disposition;
  if (bestDisp) score += DISP_SCORE[bestDisp] ?? 0;

  // Called and answered = signal
  const answeredCalls = contact.calls.filter(c =>
    c.duration > 10 &&
    !['no-answer', 'left-voicemail'].includes(c.disposition || '')
  );
  if (answeredCalls.length > 0) score += 10;

  // 4. Text reply signal (biggest indicator of interest)
  if (contact.messages.length > 0) {
    score += 20;
    // Recent reply = extra boost
    const daysSinceReply = (Date.now() - new Date(contact.messages[0].sentAt).getTime()) / 86400000;
    if (daysSinceReply < 1)  score += 10;
    else if (daysSinceReply < 3)  score += 5;
  }

  // 5. Recency
  score += recencyScore(contact.updatedAt);

  // Cap at 100
  return Math.min(100, Math.max(0, score));
}

// Batch-score all contacts (run on demand or on schedule)
export async function scoreAllContacts(): Promise<{ updated: number }> {
  const contacts = await prisma.contact.findMany({
    where: { status: { not: 'dnc' } },
    select: { id: true },
  });

  let updated = 0;
  for (const c of contacts) {
    const score = await computeLeadScore(c.id);
    await prisma.contact.update({ where: { id: c.id }, data: { leadScore: score } });
    updated++;
  }

  return { updated };
}
