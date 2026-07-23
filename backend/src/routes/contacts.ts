import { Router, Request, Response } from 'express';
import prisma from '../db';
import { computeLeadScore, scoreAllContacts } from '../leadScore';

const router = Router();

// ─── GET /api/contacts ────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const { status, source, limit = '100', offset = '0' } = req.query;
    const cappedLimit = Math.min(Number(limit) || 100, 500);
    const includeDnc = req.query.includeDnc === 'true';

    const contacts = await (prisma.contact as any).findMany({
      where: {
        userId,
        ...(source ? { source: String(source) } : {}),
        ...(!includeDnc && !status ? { NOT: { status: 'dnc' } } : {}),
        ...(status ? { status: String(status) } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: cappedLimit,
      skip: Number(offset),
      include: { calls: { orderBy: { calledAt: 'desc' }, take: 3 } },
    });

    res.json(contacts);
  } catch (e: any) {
    console.error('[contacts] GET /:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/contacts/:id ────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const contact = await (prisma.contact as any).findFirst({
      where: { id: req.params.id, userId },
      include: { calls: { orderBy: { calledAt: 'desc' } } },
    });
    if (!contact) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(contact);
  } catch (e: any) {
    console.error('[contacts] GET /:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/contacts ───────────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const { name: _name, ...body } = req.body;

    if (body.phone && String(body.phone).trim()) {
      const digits = String(body.phone).replace(/\D/g, '');
      body.phone = digits.length === 10 ? `+1${digits}` : (digits ? `+${digits}` : null);
    } else {
      body.phone = null;
    }

    if (body.phone) {
      const dup = await (prisma.contact as any).findFirst({
        where: { phone: body.phone, userId },
        select: { id: true, firstName: true, lastName: true },
      });
      if (dup) {
        const name = [dup.firstName, dup.lastName].filter(Boolean).join(' ') || 'Unknown';
        res.status(409).json({
          error: `This number is already saved as "${name}".`,
          existingContactId: dup.id,
          existingContactName: name,
        });
        return;
      }
    }

    const contact = await (prisma.contact as any).create({ data: { ...body, userId } });
    res.status(201).json(contact);
  } catch (e: any) {
    console.error('[contacts] create error:', e.message);
    if (e.code === 'P2002') {
      res.status(409).json({ error: 'A contact with that phone or email already exists.' });
    } else {
      res.status(400).json({ error: e.message });
    }
  }
});

// ─── POST /api/contacts/import ────────────────────────────────────────────────
router.post('/import', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const body = req.body;
    const rows: Array<Record<string, string>> = Array.isArray(body)
      ? body
      : Array.isArray(body?.contacts)
        ? body.contacts
        : [];
    if (!rows.length) { res.status(400).json({ error: 'No contacts provided' }); return; }

    const data = rows.map(r => {
      const rawPhone = r.phone || r.Phone || r['Phone Number'] || '';
      const digits = rawPhone.replace(/\D/g, '');
      const phone = digits.length === 10 ? `+1${digits}` : (digits ? `+${digits}` : null);
      return {
        userId,
        firstName: r.firstName || r.first_name || r['First Name'] || '',
        lastName:  r.lastName  || r.last_name  || r['Last Name']  || '',
        phone,
        address:   r.address   || r.Address    || '',
        city:      r.city      || r.City       || '',
        state:     r.state     || r.State      || '',
        zip:       r.zip       || r.Zip        || '',
        email:     r.email     || r.Email      || '',
        source:    r.source    || 'manual',
      };
    }).filter((c: any) => c.phone || c.email);

    const phones = data.map(c => c.phone).filter(Boolean) as string[];
    let existing = 0;
    const CHUNK = 1000;
    for (let i = 0; i < phones.length; i += CHUNK) {
      existing += await (prisma.contact as any).count({ where: { phone: { in: phones.slice(i, i + CHUNK) }, userId } });
    }

    let imported = 0;
    for (let i = 0; i < data.length; i += CHUNK) {
      const r = await (prisma as any).contact.createMany({ data: data.slice(i, i + CHUNK), skipDuplicates: true });
      imported += r.count;
    }
    res.json({ count: imported, imported, skipped: existing });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/contacts/:id ──────────────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const owned = await (prisma.contact as any).findFirst({ where: { id: req.params.id, userId }, select: { id: true } });
    if (!owned) { res.status(404).json({ error: 'Contact not found' }); return; }

    const { firstName, lastName, phone, address, city, state, zip, email,
            source, status, notes, contactGroup, agentPaused } = req.body as any;
    const data: any = {};
    if (firstName    !== undefined) data.firstName    = firstName;
    if (lastName     !== undefined) data.lastName     = lastName;
    if (phone        !== undefined) data.phone        = phone || null;
    if (address      !== undefined) data.address      = address;
    if (city         !== undefined) data.city         = city;
    if (state        !== undefined) data.state        = state;
    if (zip          !== undefined) data.zip          = zip;
    if (email        !== undefined) data.email        = email || null;
    if (source       !== undefined) data.source       = source;
    if (status       !== undefined) data.status       = status;
    if (notes        !== undefined) data.notes        = notes;
    if (contactGroup !== undefined) data.contactGroup = contactGroup;
    if (agentPaused  !== undefined) data.agentPaused  = agentPaused;

    const contact = await (prisma.contact as any).update({ where: { id: req.params.id }, data });
    res.json(contact);
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Contact not found' }); return; }
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/contacts/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const id = req.params.id;
    const owned = await (prisma.contact as any).findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) { res.status(404).json({ error: 'Contact not found' }); return; }

    await prisma.call.deleteMany({ where: { contactId: id } });
    await prisma.appointment.deleteMany({ where: { contactId: id } });
    await (prisma.contact as any).delete({ where: { id } });
    res.sendStatus(204);
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Contact not found' }); return; }
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/contacts/:id/calls ─────────────────────────────────────────────
router.post('/:id/calls', async (req: Request, res: Response) => {
  try {
    const { duration, disposition, notes, recordingUrl, twilioSid } = req.body;
    const call = await prisma.call.create({
      data: {
        contactId: req.params.id,
        duration: Number(duration) || 0,
        disposition, notes, recordingUrl, twilioSid,
      },
    });

    const statusMap: Record<string, string> = {
      'hot-lead':           'hot',
      'callback':           'callback',
      'callback-scheduled': 'callback',
      'dnc':                'dnc',
      'not-interested':     'contacted',
      'left-voicemail':     'contacted',
      'not-home':           'contacted',
      'appointment':        'appointment',
      'closed':             'closed',
    };

    if (disposition && statusMap[disposition]) {
      await (prisma.contact as any).update({ where: { id: req.params.id }, data: { status: statusMap[disposition] } });
    }

    res.status(201).json(call);
    computeLeadScore(req.params.id)
      .then(score => prisma.contact.update({ where: { id: req.params.id }, data: { leadScore: score } }))
      .catch(console.error);
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Contact not found' }); return; }
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/contacts/score-all ────────────────────────────────────────────
router.post('/score-all', async (_req: Request, res: Response) => {
  res.json({ started: true });
  scoreAllContacts().then(r => console.log(`[LeadScore] Scored ${r.updated} contacts`)).catch(console.error);
});

// ─── POST /api/contacts/bulk ──────────────────────────────────────────────────
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const { ids, action, value } = req.body as { ids: string[]; action: 'setStatus' | 'setGroup' | 'delete'; value?: string };
    if (!ids || !ids.length) { res.status(400).json({ error: 'ids required' }); return; }

    const owned = await (prisma.contact as any).findMany({ where: { id: { in: ids }, userId }, select: { id: true } });
    const ownedIds = owned.map((c: any) => c.id);

    if (action === 'setStatus' && value) {
      await (prisma.contact as any).updateMany({ where: { id: { in: ownedIds } }, data: { status: value } });
      res.json({ updated: ownedIds.length });
    } else if (action === 'setGroup') {
      await (prisma.contact as any).updateMany({ where: { id: { in: ownedIds } }, data: { contactGroup: value || null } });
      res.json({ updated: ownedIds.length });
    } else if (action === 'delete') {
      await prisma.call.deleteMany({ where: { contactId: { in: ownedIds } } });
      await prisma.appointment.deleteMany({ where: { contactId: { in: ownedIds } } });
      await (prisma.contact as any).deleteMany({ where: { id: { in: ownedIds } } });
      res.json({ deleted: ownedIds.length });
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/contacts/claim — one-time admin migration ─────────────────────
// Assigns all legacy (un-owned) contacts to the requesting admin user.
router.post('/claim', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const role   = (req as any).user?.role as string;
    if (role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
    const result = await (prisma.contact as any).updateMany({ where: { userId: null }, data: { userId } });
    res.json({ claimed: result.count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
