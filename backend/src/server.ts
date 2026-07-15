// ── Keep the process alive even if an async route throws ─────────────────────
process.on('unhandledRejection', (reason: any) => {
  console.error('[server] Unhandled rejection (safe — server stays up):', reason?.message || reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[server] Uncaught exception (safe — server stays up):', err.message);
});

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { initSocket } from './socket';

import twilioRoutes from './routes/twilio';
import sequenceRoutes from './routes/sequences';
import contactRoutes from './routes/contacts';
import blastRoutes from './routes/blast';
import inboxRoutes, { handleInboundSms } from './routes/inbox';
import tripleDialRoutes from './routes/tripleDial';
import localPresenceRoutes from './routes/localPresence';
import analyticsRoutes from './routes/analytics';
import scheduledBlastRoutes from './routes/scheduledBlast';
import transcriptionRoutes from './routes/transcription';
import voicemailBlastRoutes from './routes/voicemailBlast';
import aiScriptRoutes from './routes/aiScript';
import dncRoutes from './routes/dnc';
import appointmentRoutes from './routes/appointments';
import emailRoutes from './routes/email';
import nextActionRoutes from './routes/nextAction';
import reportsRoutes from './routes/reports';
import authRoutes, { requireAuth } from './routes/auth';
import googleContactsRoutes from './routes/googleContacts';
import icloudContactsRoutes from './routes/icloudContacts';
import promoRoutes from './routes/promo';
import billingRoutes from './routes/billing';
import teamRoutes from './routes/team';
import dialerRoutes, { webhooks as dialerWebhooks } from './routes/dialer';
import settingsRoutes from './routes/settings';
import agentRoutes from './routes/agent';
import agentChatRoutes from './routes/agentChat';
import contactGroupRoutes from './routes/contactGroups';
import gmailBlastRoutes from './routes/gmailBlast';
import { initAgentScheduler } from './agent/scheduler';
import { ensureAgentSchema } from './agent/ensureSchema';

dotenv.config();

const app  = express();
app.set('trust proxy', 1); // Render runs behind a reverse proxy — trust X-Forwarded-Proto so req.protocol = 'https'
const http = createServer(app);
const PORT = process.env.PORT || 3001;

// H9: Warn on startup if critical env vars are missing
(function checkEnv() {
  const required = ['DATABASE_URL', 'JWT_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'FRONTEND_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) console.warn('[startup] Missing env vars:', missing.join(', '));
  if (!process.env.BACKEND_URL && !process.env.NGROK_URL) {
    console.warn('[startup] BACKEND_URL not set — Twilio webhooks may not work correctly');
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.warn('[startup] ENCRYPTION_KEY not set — iCloud credentials using fallback key (insecure)');
  }
})();

// ── Init Socket.io ────────────────────────────────────────────────────────────
initSocket(http);

// ── Init autonomous agent scheduler (proactive follow-ups + deferred actions) ──
initAgentScheduler();

// ── Middleware ────────────────────────────────────────────────────────────────
// CORS: auto-expand FRONTEND_URL to include both www and non-www variants
function buildCorsOrigins(env: string | undefined): string | string[] {
  if (!env || env === '*') return '*';
  const origins = new Set<string>();
  for (const raw of env.split(',')) {
    const o = raw.trim();
    origins.add(o);
    try {
      const u = new URL(o);
      if (u.hostname.startsWith('www.')) {
        origins.add(`${u.protocol}//${u.hostname.slice(4)}`);
      } else {
        origins.add(`${u.protocol}//www.${u.hostname}`);
      }
    } catch {}
  }
  return [...origins];
}
app.use(helmet({
  contentSecurityPolicy: false,   // CSP managed at CDN/reverse-proxy level
  crossOriginEmbedderPolicy: false, // Twilio Voice SDK requires relaxed COEP
}));
app.use(cors({ origin: buildCorsOrigins(process.env.FRONTEND_URL), credentials: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
// C1: Token endpoint requires auth — must be before the public webhook mount
app.post('/api/twilio/token',  requireAuth, twilioRoutes);
// Public Twilio webhooks (no auth — called by Twilio servers — Twilio calls these, not the browser)
app.use('/api/twilio',         twilioRoutes);
app.post('/api/twilio/sms-inbound', handleInboundSms);

// iCloud routes MUST be before contactRoutes — contactRoutes has /:id wildcard that would swallow /icloud-*
app.use('/api/contacts',       requireAuth,  icloudContactsRoutes);

// All features available to any authenticated user (no plan gating)
app.use('/api/contacts',        requireAuth, contactRoutes);
app.use('/api/blast',           requireAuth, blastRoutes);
app.use('/api/inbox',           requireAuth, inboxRoutes);
app.use('/api/local-presence',  requireAuth, localPresenceRoutes);
app.use('/api/analytics',       requireAuth, analyticsRoutes);
app.use('/api/settings',        requireAuth, settingsRoutes);
app.use('/api/agent',           requireAuth, agentRoutes);
app.use('/api/agent',           requireAuth, agentChatRoutes);
app.use('/api/contact-groups',  requireAuth, contactGroupRoutes);
app.use('/api/dialer',          dialerWebhooks);       // public Twilio webhooks (no auth)
app.use('/api/dialer',          requireAuth, dialerRoutes);
app.use('/api/sequences',       requireAuth, sequenceRoutes);
app.use('/api/triple-dial',     requireAuth, tripleDialRoutes);
app.use('/api/blast/scheduled', requireAuth, scheduledBlastRoutes);
app.use('/api/voicemail-blast', requireAuth, voicemailBlastRoutes);
app.use('/api/ai-script',       requireAuth, aiScriptRoutes);
app.use('/api/dnc',             requireAuth, dncRoutes);
app.use('/api/appointments',    requireAuth, appointmentRoutes);
app.use('/api/email',           requireAuth, emailRoutes);
app.use('/api/gmail',                        gmailBlastRoutes); // OAuth callback must be unauthed
app.use('/api/contacts',                     googleContactsRoutes); // Google OAuth callback must be unauthed
app.use('/api/reports',         requireAuth, reportsRoutes);
app.use('/api/next-action',     requireAuth, nextActionRoutes);
app.use('/api/transcription',   requireAuth, transcriptionRoutes);

// Auth & team (billing routes kept but unused)
app.use('/api/auth',            authRoutes);
app.use('/api/promo',           promoRoutes);
app.use('/api/team',            requireAuth, teamRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Propel Dialer API', time: new Date().toISOString() });
});

// Global async error handler — catches any thrown error in routes
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[server] Route error:', err?.message || err);
  res.status(500).json({ error: err?.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
http.listen(PORT, () => {
  console.log(`\n🚀 Propel Dialer backend running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Socket: ws://localhost:${PORT}\n`);
  // Self-heal: make sure agent tables exist (idempotent, non-blocking).
  ensureAgentSchema().catch((e) => console.warn('[server] ensureAgentSchema error:', e?.message || e));
});

export default app;
