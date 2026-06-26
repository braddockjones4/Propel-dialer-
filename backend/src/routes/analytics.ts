import { Router, Request, Response } from 'express';
import prisma from '../db';

const router = Router();

function startOf(unit: 'day' | 'week' | 'month'): Date {
  const now = new Date();
  if (unit === 'day') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (unit === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay()); // Sunday
    d.setHours(0, 0, 0, 0);
    return d;
  }
  // month
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// ─── GET /api/analytics ───────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const [
    totalCalls,
    callsToday,
    callsWeek,
    callsMonth,
    totalContacts,
    hotLeads,
    dncCount,
    totalMessages,
    messagesOutbound,
    callsByDisposition,
    callsByDay,
    contactsByStatus,
    contactsBySource,
    recentCalls,
  ] = await Promise.all([
    // Call counts
    prisma.call.count(),
    prisma.call.count({ where: { calledAt: { gte: startOf('day') } } }),
    prisma.call.count({ where: { calledAt: { gte: startOf('week') } } }),
    prisma.call.count({ where: { calledAt: { gte: startOf('month') } } }),

    // Contact counts
    prisma.contact.count(),
    prisma.contact.count({ where: { status: 'hot' } }),
    prisma.contact.count({ where: { status: 'dnc' } }),

    // Message counts
    prisma.message.count(),
    prisma.message.count({ where: { direction: 'outbound' } }),

    // Calls grouped by disposition
    prisma.call.groupBy({
      by: ['disposition'],
      _count: { _all: true },
      orderBy: { _count: { disposition: 'desc' } },
    }),

    // Calls per day for last 14 days — PostgreSQL date functions
    prisma.$queryRaw<Array<{ day: string; count: bigint }>>`
      SELECT DATE("calledAt") as day, COUNT(*) as count
      FROM "Call"
      WHERE "calledAt" >= NOW() - INTERVAL '14 days'
      GROUP BY DATE("calledAt")
      ORDER BY day ASC
    `,

    // Contacts by status
    prisma.contact.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),

    // Contacts by source
    prisma.contact.groupBy({
      by: ['source'],
      _count: { _all: true },
    }),

    // Recent 10 calls with contact info
    prisma.call.findMany({
      take: 10,
      orderBy: { calledAt: 'desc' },
      include: { contact: { select: { firstName: true, lastName: true, phone: true } } },
    }),
  ]);

  // Derived stats
  const answered = callsByDisposition
    .filter(d => d.disposition && !['no-answer', 'voicemail', 'dnc', null].includes(d.disposition))
    .reduce((sum, d) => sum + d._count._all, 0);

  const answerRate = totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : 0;
  const hotRate    = totalCalls > 0 ? Math.round((hotLeads / totalCalls) * 100) : 0;

  // Pad callsByDay to last 14 days so frontend always has 14 points
  const days: Array<{ day: string; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const found = (callsByDay as any[]).find((r: any) => {
      const rowDay = r.day instanceof Date ? r.day.toISOString().split('T')[0] : String(r.day);
      return rowDay === key;
    });
    days.push({ day: key, count: found ? Number(found.count) : 0 });
  }

  res.json({
    calls: { total: totalCalls, today: callsToday, week: callsWeek, month: callsMonth },
    contacts: { total: totalContacts, hot: hotLeads, dnc: dncCount },
    messages: { total: totalMessages, outbound: messagesOutbound },
    rates: { answerRate, hotRate },
    dispositions: callsByDisposition.map(d => ({ label: d.disposition || 'unknown', count: d._count._all })),
    callsByDay: days,
    contactsByStatus: contactsByStatus.map(d => ({ label: d.status, count: d._count._all })),
    contactsBySource: contactsBySource.map(d => ({ label: d.source, count: d._count._all })),
    recentCalls,
  });
});

export default router;
