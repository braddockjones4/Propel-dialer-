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
  // Also accept ?token= query param for OAuth redirects (browser can't send headers)
  const token  = header.startsWith('Bearer ') ? header.slice(7) : (req.query?.token as string | undefined) || null;
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

// ── Middleware: require plan tier ────────────────────────────────────────────
// Plans in ascending order: trial > starter > pro > elite
// trial gets full access (7-day free trial)
// admin always passes
const PLAN_RANK: Record<string, number> = { trial: 99, starter: 1, pro: 2, elite: 3 };

export function requirePlan(...allowed: string[]) {
  return (req: any, res: Response, next: any) => {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const plan = req.user.plan || 'trial';
    const role = req.user.role;
    if (role === 'admin') { next(); return; }
    // Check trial expiry
    if (plan === 'trial') {
      const expires = req.user.planExpiresAt ? new Date(req.user.planExpiresAt) : null;
      if (expires && expires < new Date()) {
        res.status(403).json({ error: 'Your free trial has expired. Please upgrade to continue.', trialExpired: true });
        return;
      }
      next(); return;
    }
    if (allowed.includes(plan)) { next(); return; }
    res.status(403).json({
      error: 'Plan upgrade required',
      requiredPlan: allowed[0],
      currentPlan: plan,
    });
  };
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
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const user = await db.user.create({
      data: { email: email.toLowerCase(), passwordHash, name: name || '', role, planExpiresAt: trialEnd },
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

// ── GET /api/auth/demo ────────────────────────────────────────────────────────
// Returns a JWT for the shared demo account. Creates it on first call.
router.get('/demo', async (_req: Request, res: Response) => {
  try {
    const DEMO_EMAIL = 'demo@compasssolutions.com';
    const DEMO_NAME  = 'Demo User';

    let user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });

    if (!user) {
      const passwordHash = await bcrypt.hash('demo-compass-2026', 12);
      user = await db.user.create({
        data: { email: DEMO_EMAIL, passwordHash, name: DEMO_NAME, role: 'agent' },
      });

      // Seed demo contacts if the DB is empty
      const count = await db.contact.count();
      if (count === 0) {
        await db.contact.createMany({
          data: [
            { firstName: 'Margaret', lastName: 'Thornton',  phone: '+15550100001', contactGroup: 'Expired Listings',  status: 'new'       },
            { firstName: 'James',    lastName: 'Whitfield', phone: '+15550100002', contactGroup: 'FSBO',              status: 'contacted'  },
            { firstName: 'Sarah',    lastName: 'Chen',      phone: '+15550100003', contactGroup: 'Circle Prospects',  status: 'new'        },
            { firstName: 'Robert',   lastName: 'Harrington',phone: '+15550100004', contactGroup: 'Expired Listings',  status: 'callback'   },
            { firstName: 'Linda',    lastName: 'Morrison',  phone: '+15550100005', contactGroup: 'Past Clients',      status: 'new'        },
            { firstName: 'David',    lastName: 'Park',      phone: '+15550100006', contactGroup: 'Sphere',            status: 'new'        },
          ],
        });
      }
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ token, user: safeUser(user) });
  } catch (e: any) {
    console.error('[Auth] demo:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json({ error: 'Email required' }); return; }

    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always return success to prevent email enumeration
    if (!user) { res.json({ message: 'If that email exists, a reset link has been sent.' }); return; }

    // Generate a signed reset token (expires in 1 hour)
    const resetToken = jwt.sign({ userId: user.id, type: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
    const frontendUrl = process.env.FRONTEND_URL || 'https://compasssolutions.com';
    const resetUrl = `${frontendUrl}?reset=${resetToken}`;

    const { SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, AGENT_NAME } = process.env;
    if (SENDGRID_API_KEY && SENDGRID_FROM_EMAIL) {
      const https = await import('https');
      const body = JSON.stringify({
        personalizations: [{ to: [{ email: user.email }] }],
        from: { email: SENDGRID_FROM_EMAIL, name: 'Propel Dialer' },
        subject: 'Reset your Propel password',
        content: [{
          type: 'text/html',
          value: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
              <h2 style="color:#C9A84C;letter-spacing:.1em">PROPEL</h2>
              <p>Hi ${user.name || 'there'},</p>
              <p>Click the button below to reset your password. This link expires in 1 hour.</p>
              <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#C9A84C;color:#fff;text-decoration:none;border-radius:4px;font-weight:700;margin:16px 0">Reset Password</a>
              <p style="color:#999;font-size:12px">If you didn't request this, ignore this email.</p>
            </div>
          `
        }]
      });
      await new Promise<void>((resolve) => {
        const req2 = (https as any).request({
          hostname: 'api.sendgrid.com', path: '/v3/mail/send', method: 'POST',
          headers: { 'Authorization': 'Bearer '+SENDGRID_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (r: any) => { r.resume(); r.on('end', resolve); });
        req2.on('error', resolve);
        req2.write(body); req2.end();
      });
    } else {
      console.log(`[Auth] Password reset link for ${email}: ${resetUrl}`);
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (e: any) {
    console.error('[Auth] forgot-password:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) { res.status(400).json({ error: 'Token and password required' }); return; }
    if (password.length < 6) { res.status(400).json({ error: 'Password must be at least 6 characters' }); return; }

    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET) as any;
    } catch {
      res.status(400).json({ error: 'Reset link is invalid or has expired' }); return;
    }
    if (payload.type !== 'reset') { res.status(400).json({ error: 'Invalid reset token' }); return; }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.update({ where: { id: payload.userId }, data: { passwordHash } });
    const authToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ message: 'Password reset successfully', token: authToken, user: safeUser(user) });
  } catch (e: any) {
    console.error('[Auth] reset-password:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
