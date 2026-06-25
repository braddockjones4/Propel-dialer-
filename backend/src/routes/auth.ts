/**
 * Auth routes — JWT-based login/register for Propel Dialer
 * POST /api/auth/register  — create account (first user becomes admin)
 * POST /api/auth/login     — returns JWT
 * GET  /api/auth/me        — returns current user (requires Authorization: Bearer <token>)
 * PATCH /api/auth/me       — update name/password
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db';

const router = Router();
const db = prisma as any;

const JWT_SECRET  = process.env.JWT_SECRET || 'propel-dialer-dev-secret-change-in-prod';
const JWT_EXPIRES = '30d';

// ── Middleware: verify JWT ────────────────────────────────────────────────────
export async function requireAuth(req: any, res: Response, next: any) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    const user = await db.user.findUnique({ where: { id: payload.userId } });
    if (!user) { res.status(401).json({ error: 'User not found' }); return; }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'email and password required' }); return; }
    if (password.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters' }); return; }

    const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) { res.status(409).json({ error: 'Email already registered' }); return; }

    // First user ever = admin
    const count = await db.user.count();
    const role  = count === 0 ? 'admin' : 'agent';

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: { email: email.toLowerCase(), passwordHash, name: name || '', role },
    });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.status(201).json({ token, user: safeUser(user) });
  } catch (e: any) {
    console.error('[Auth] register:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) { res.status(400).json({ error: 'email and password required' }); return; }

    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) { res.status(401).json({ error: 'Invalid email or password' }); return; }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { res.status(401).json({ error: 'Invalid email or password' }); return; }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ token, user: safeUser(user) });
  } catch (e: any) {
    console.error('[Auth] login:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: any, res: Response) => {
  res.json(safeUser(req.user));
});

// ── PATCH /api/auth/me ────────────────────────────────────────────────────────
router.patch('/me', requireAuth, async (req: any, res: Response) => {
  try {
    const { name, password } = req.body;
    const data: any = {};
    if (name) data.name = name;
    if (password) {
      if (password.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters' }); return; }
      data.passwordHash = await bcrypt.hash(password, 12);
    }
    const updated = await db.user.update({ where: { id: req.user.id }, data });
    res.json(safeUser(updated));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

function safeUser(u: any) {
  const { passwordHash, ...rest } = u;
  return rest;
}

export default router;
