import { Router, Request, Response } from 'express';
import prisma from '../db';
import { computeLeadScore, scoreAllContacts } from '../leadScore';

const router = Router();

// No plan-based contact limits — single-client deployment
async function checkContactLimit(_req: any, _res: Response): Promise<boolean> {
  return true;
}

// GET /api/contacts
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, source, limit = '100', offset = '0' } = req.query;

    // includeDnc=true bypasses the default DNC filter (used by Pipeline)
    const includeDnc = req.query.includeDnc === 'true';

    const contacts = await prisma.contact.findMany({
      where: {
        ...(source ? { source: String(source) } : {}),
        ...(!includeDnc && !status ? { NOT: { status: 'dnc' } } : {}),
        ...(status ? { status: String(status) } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
      include: { calls: { orderBy: { calledAt: 'desc' }, take: 3 } },
    });

    res.json(contacts);
  } catch (e: any) {
    console.error('[contacts] GET /:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/contacts/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: req.params.id },
      include: { calls: { orderBy: { calledAt: 'desc' } } },
    });
    if (!contact) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(contact);
  } catch (e: any) {
    console.error('[contacts] GET /:id:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/contacts
router.post('/', async (req: Request, res: Response) => {
  if (!await checkContactLimit(req, res)) return;
  try {
    const { name: _name, ...body } = req.body;
    // Auto-format phone to E.164, or null if empty
    if (body.phone && String(body.phone).trim()) {
      const digits = String(body.phone).replace(/\D/g, '');
      body.phone = digits.length === 10 ? `+1${digits}` : (digits ? `+${digits}` : null);
    } else {
      body.phone = null;
    }
    // Pre-check for duplicate phone before hitting the unique constraint
    if (body.phone) {
      const dup = await prisma.contact.findUnique({
        where: { phone: body.phone },
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
    const contact = await prisma.contact.create({ data: body });
    res.status(201).json(contact);
  } catch (e: any) {
    console.error('[contacts] create error:', e.message);
    if (e.code === 'P2002') {
      const target = e.meta?.target;
      const field = Array.isArray(target) ? target.join(', ') : (target ?? 'phone or email');
      res.status(409).json({ error: `A contact with that ${field} already exists.` });
    } else {
      res.status(400).json({ error: e.message });
    }
  }
});

// POST /api/contacts/import
// Accepts either a raw array [ {...}, ... ] or { contacts: [ {...}, ... ] }
router.post('/import', async (req: Request, res: Response) => {
  if (!await checkContactLimit(req, res)) return;
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
  }).filter(c => c.phone || c.email); // require at least phone OR email

  const phones = data.map(c => c.phone).filter(Boolean) as string[];
  const existing = phones.length
    ? await prisma.contact.count({ where: { phone: { in: phones } } })
    : 0;
  const result = await (prisma as any).contact.createMany({ data, skipDuplicates: true });
  res.json({ count: result.count, imported: result.count, skipped: existing });
});

// PATCH /api/contacts/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const contact = await prisma.contact.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(contact);
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Contact not found' }); return; }
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/contacts/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    // Delete related required-FK records first (schema has no cascade)
    await prisma.call.deleteMany({ where: { contactId: id } });
    await prisma.appointment.deleteMany({ where: { contactId: id } });
    await prisma.contact.delete({ where: { id } });
    res.sendStatus(204);
  } catch (e: any) {
    if (e.code === 'P2025') { res.status(404).json({ error: 'Contact not found' }); return; }
    res.status(500).json({ error: e.message });
  }
});

// POST /api/contacts/:id/calls
router.post('/:id/calls', async (req: Request, res: Response) => {
  const { duration, disposition, notes, recordingUrl, twilioSid } = req.body;

  const call = await prisma.call.create({
    data: {
      contactId: req.params.id,
      duration: Number(duration) || 0,
      disposition,
      notes,
      recordingUrl,
      twilioSid,
    },
  });

  const statusMap: Record<string, string> = {
    'hot-lead':          'hot',
    'callback':          'callback',
    'callback-scheduled':'callback',
    'dnc':               'dnc',
    'not-interested':    'contacted',
    'left-voicemail':    'contacted',
    'not-home':          'contacted',
    'appointment':       'appointment',
    'closed':            'closed',
  };

  if (disposition && statusMap[disposition]) {
    await prisma.contact.update({
      where: { id: req.params.id },
      data: { status: statusMap[disposition] },
    });
  }

  res.status(201).json(call);

  // Recompute lead score async after each call
  computeLeadScore(req.params.id)
    .then(score => prisma.contact.update({ where: { id: req.params.id }, data: { leadScore: score } }))
    .catch(console.error);
});

// POST /api/contacts/score-all — recompute all lead scores
router.post('/score-all', async (_req: Request, res: Response) => {
  // Fire async
  res.json({ started: true });
  scoreAllContacts().then(r => console.log(`[LeadScore] Scored ${r.updated} contacts`)).catch(console.error);
});

// POST /api/contacts/bulk — bulk operations
router.post('/bulk', async (req: Request, res: Response) => {
  const { ids, action, value } = req.body as {
    ids: string[];
    action: 'setStatus' | 'setGroup' | 'delete';
    value?: string;
  };

  if (!ids || !ids.length) { res.status(400).json({ error: 'ids required' }); return; }

  if (action === 'setStatus' && value) {
    await prisma.contact.updateMany({ where: { id: { in: ids } }, data: { status: value } });
    res.json({ updated: ids.length });
  } else if (action === 'setGroup') {
    await prisma.contact.updateMany({ where: { id: { in: ids } }, data: { contactGroup: value || null } });
    res.json({ updated: ids.length });
  } else if (action === 'delete') {
    // Delete related required-FK records first (schema has no cascade)
    await prisma.call.deleteMany({ where: { contactId: { in: ids } } });
    await prisma.appointment.deleteMany({ where: { contactId: { in: ids } } });
    await prisma.contact.deleteMany({ where: { id: { in: ids } } });
    res.json({ deleted: ids.length });
  } else {
    res.status(400).json({ error: 'Invalid action' });
  }
});

export default router;
