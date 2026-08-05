// ─── Contact Groups API ───────────────────────────────────────────────────────
// CRUD for user-defined contact groups. Groups are stored in ContactGroup table;
// assignments live in Contact.contactGroup (plain string). This keeps queries
// simple while letting the agent create and populate groups server-side.
import { Router, Request, Response } from 'express';
import prisma from '../db';

const router = Router();

// ── GET /api/contact-groups ── list caller's groups with member counts ────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const groups = await (prisma as any).contactGroup.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    // Attach live contact counts in one query, scoped to this user's contacts
    const counts = await prisma.contact.groupBy({
      by: ['contactGroup'],
      _count: { id: true },
      where: { userId, contactGroup: { not: null } } as any,
    });
    const countMap: Record<string, number> = {};
    for (const row of counts as any[]) {
      if (row.contactGroup) countMap[row.contactGroup] = row._count.id;
    }

    res.json((groups as any[]).map((g: any) => ({ ...g, contactCount: countMap[g.name] || 0 })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/contact-groups ── create a new group ───────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const { name, color, position } = req.body as { name?: string; color?: string; position?: number };
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    // Determine next position if not supplied
    let pos = position;
    if (pos === undefined) {
      const last = await (prisma as any).contactGroup.findFirst({ where: { userId }, orderBy: { position: 'desc' } });
      pos = (last?.position ?? -1) + 1;
    }

    const group = await (prisma as any).contactGroup.create({
      data: { userId, name: name.trim(), color: color || '#9ca3af', position: pos },
    });
    res.status(201).json({ ...group, contactCount: 0 });
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ error: `Group "${req.body.name}" already exists` });
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/contact-groups/:id ── rename or recolor ───────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const existing = await (prisma as any).contactGroup.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) return res.status(404).json({ error: 'Group not found' });

    const { name, color, position } = req.body as { name?: string; color?: string; position?: number };
    const newName = name?.trim();

    // If renaming, cascade the new name to this user's contacts that have the old name
    if (newName && newName !== existing.name) {
      await prisma.contact.updateMany({
        where: { userId, contactGroup: existing.name } as any,
        data: { contactGroup: newName },
      });
    }

    const updated = await (prisma as any).contactGroup.update({
      where: { id: req.params.id },
      data: {
        ...(newName ? { name: newName } : {}),
        ...(color  ? { color }          : {}),
        ...(position !== undefined ? { position } : {}),
      },
    });

    // Return with fresh contact count
    const count = await prisma.contact.count({ where: { userId, contactGroup: updated.name } as any });
    res.json({ ...updated, contactCount: count });
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ error: `A group with that name already exists` });
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/contact-groups/:id ── delete group, ungroup members ───────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const existing = await (prisma as any).contactGroup.findFirst({ where: { id: req.params.id, userId } });
    if (!existing) return res.status(404).json({ error: 'Group not found' });

    // Ungroup all of this user's contacts belonging to this group
    const { count } = await prisma.contact.updateMany({
      where: { userId, contactGroup: existing.name } as any,
      data: { contactGroup: null },
    });

    await (prisma as any).contactGroup.delete({ where: { id: req.params.id } });
    res.json({ deleted: true, ungroupedCount: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/contact-groups/:id/assign ── bulk assign contacts to a group ───
// Body: { contactIds: string[] }
router.post('/:id/assign', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const group = await (prisma as any).contactGroup.findFirst({ where: { id: req.params.id, userId } });
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const { contactIds } = req.body as { contactIds?: string[] };
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ error: 'contactIds array required' });
    }

    const { count } = await prisma.contact.updateMany({
      where: { id: { in: contactIds }, userId } as any,
      data: { contactGroup: group.name },
    });

    res.json({ assigned: count, groupName: group.name });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/contact-groups/ensure ── idempotent create-or-get (used by agent)
// Body: { name: string, color?: string }  →  returns the group (created or found)
router.post('/ensure', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id as string;
    const { name, color } = req.body as { name?: string; color?: string };
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const last = await (prisma as any).contactGroup.findFirst({ where: { userId }, orderBy: { position: 'desc' } });
    const nextPos = (last?.position ?? -1) + 1;

    const group = await (prisma as any).contactGroup.upsert({
      where: { userId_name: { userId, name: name.trim() } },
      create: { userId, name: name.trim(), color: color || '#9ca3af', position: nextPos },
      update: {},   // already exists — no changes needed
    });

    const count = await prisma.contact.count({ where: { userId, contactGroup: group.name } as any });
    res.json({ ...group, contactCount: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
