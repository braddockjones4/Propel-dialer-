/**
 * Settings helpers
 * GET  /api/settings/status  — which API keys are configured
 * GET  /api/settings/ngrok   — current ngrok URL
 * POST /api/settings/ngrok   — update ngrok URL in memory (persists to .env comment)
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

// ── GET /api/settings/status ──────────────────────────────────────────────────
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    twilio:   !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    openai:   !!process.env.OPENAI_API_KEY,
    sendgrid: !!process.env.SENDGRID_API_KEY,
    stripe:   !!process.env.STRIPE_SECRET_KEY,
    ngrok:    !!process.env.NGROK_URL,
  });
});

// ── GET /api/settings/ngrok ───────────────────────────────────────────────────
router.get('/ngrok', (_req: Request, res: Response) => {
  res.json({ ngrokUrl: process.env.NGROK_URL || '' });
});

// ── POST /api/settings/ngrok ──────────────────────────────────────────────────
router.post('/ngrok', (req: any, res: Response, next: any) => {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return; }
  next();
}, async (req: Request, res: Response) => {
  try {
    const { ngrokUrl } = req.body;
    if (!ngrokUrl) { res.status(400).json({ error: 'ngrokUrl required' }); return; }

    // Update in-memory
    process.env.NGROK_URL = ngrokUrl;

    // Try to patch .env file so it persists across restarts
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf-8');
      if (content.includes('NGROK_URL=')) {
        content = content.replace(/NGROK_URL=.*/g, `NGROK_URL=${ngrokUrl}`);
      } else {
        content += `\nNGROK_URL=${ngrokUrl}\n`;
      }
      fs.writeFileSync(envPath, content);
    }

    res.json({ saved: true, ngrokUrl });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
