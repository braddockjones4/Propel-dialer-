import { Router, Request, Response } from 'express';
import prisma from '../db';

const router = Router();

// cast to any — new Contact.userId field not in types until prisma generate on deploy
const db = prisma as any;

function startOf(unit: 'day' | 'week' | 'month'): Date {
  const now = new Date();
  if (unit === 'day')  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (unit === 'week') {
    const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// ─── GET /api/analytics ───────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;

    // Helper: scope Call queries through contact.userId
    const cw  = (extra: any = {}) => ({ contact: { userId }, ...extra });
    // Helper: scope Contact queries directly
    const ctw = (extra: any = {}) => ({ userId, ...extra });

    const [
      totalCalls, callsToday, callsWeek, callsMonth,
      totalContacts, hotLeads, dncCount,
      callsByDisposition, contactsByStatus, contactsBySource, recentCalls,
    ] = await Promise.all([
      db.call.count({ where: cw() }),
      db.call.count({ where: cw({ calledAt: { gte: startOf('day') } }) }),
      db.call.count({ where: cw({ calledAt: { gte: startOf('week') } }) }),
      db.call.count({ where: cw({ calledAt: { gte: startOf('month') } }) }),
      db.contact.count({ where: ctw() }),
      db.contact.count({ where: ctw({ status: 'hot' }) }),
      db.contact.count({ where: ctw({ status: 'dnc' }) }),
      db.call.groupBy({ by: ['disposition'], where: cw(), _count: { _all: true }, orderBy: { _count: { disposition: 'desc' } } }),
      db.contact.groupBy({ by: ['status'], where: ctw(), _count: { _all: true } }),
      db.contact.groupBy({ by: ['source'], where: ctw(), _count: { _all: true } }),
      db.call.findMany({ take: 10, where: cw(), orderBy: { calledAt: 'desc' }, include: { contact: { select: { firstName: true, lastName: true, phone: true } } } }),
    ]);

    // Calls per day for last 14 days — scoped via Contact join
    const callsByDayRaw = await prisma.$queryRaw<Array<{ day: string; count: bigint }>>`
      SELECT DATE(c."calledAt") as day, COUNT(*) as count
      FROM "Call" c
      JOIN "Contact" ct ON c."contactId" = ct.id
      WHERE c."calledAt" >= NOW() - INTERVAL '14 days'
        AND ct."userId" = ${userId}
      GROUP BY DATE(c."calledAt")
      ORDER BY day ASC
    `;

    const answered = callsByDisposition
      .filter((d: any) => d.disposition && !['no-answer', 'voicemail', 'dnc', null].includes(d.disposition))
      .reduce((sum: number, d: any) => sum + (d._count?._all ?? 0), 0);

    const answerRate = totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : 0;
    const hotRate    = totalCalls > 0 ? Math.round((hotLeads  / totalCalls) * 100) : 0;

    const days: Array<{ day: string; count: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key   = d.toISOString().split('T')[0];
      const found = (callsByDayRaw as any[]).find((r: any) => {
        const rowDay = r.day instanceof Date ? r.day.toISOString().split('T')[0] : String(r.day);
        return rowDay === key;
      });
      days.push({ day: key, count: found ? Number(found.count) : 0 });
    }

    res.json({
      calls:    { total: totalCalls, today: callsToday, week: callsWeek, month: callsMonth },
      contacts: { total: totalContacts, hot: hotLeads, dnc: dncCount },
      rates:    { answerRate, hotRate },
      dispositions:     callsByDisposition.map((d: any) => ({ label: d.disposition || 'unknown', count: d._count?._all ?? 0 })),
      callsByDay:       days,
      contactsByStatus: contactsByStatus.map((d: any) => ({ label: d.status,  count: d._count?._all ?? 0 })),
      contactsBySource: contactsBySource.map((d: any) => ({ label: d.source,  count: d._count?._all ?? 0 })),
      recentCalls,
    });
  } catch (e: any) {
    console.error('[analytics] GET /:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
