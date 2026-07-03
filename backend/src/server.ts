// ── Keep the process alive even if an async route throws ─────────────────────
process.on('unhandledRejection', (reason: any) => {
  console.error('[server] Unhandled rejection (safe — server stays up):', reason?.message || reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[server] Uncaught exception (safe — server stays up):', err.message);
});

import express from 'express';
import cors from 'cors';
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
import authRoutes, { requireAuth, requirePlan } from './routes/auth';
import promoRoutes from './routes/promo';
import billingRoutes from './routes/billing';
import teamRoutes from './routes/team';
import dialerRoutes, { webhooks as dialerWebhooks } from './routes/dialer';
import settingsRoutes from './routes/settings';
import agentRoutes from './routes/agent';
import contactGroupRoutes from './routes/contactGroups';
import { initAgentScheduler } from './agent/scheduler';
import { ensureAgentSchema } from './agent/ensureSchema';

dotenv.config();

const app  = express();
const http = createServer(app);
const PORT = process.env.PORT || 3001;

// ── Init Socket.io ────────────────────────────────────────────────────────────
initSocket(http);

// ── Init autonomous agent scheduler (proactive follow-ups + deferred actions) ──
initAgentScheduler();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// ── Routes ────────────────────────────────────────────────────────────────────
// Public Twilio webhooks (no auth — called by Twilio servers)
app.use('/api/twilio',         twilioRoutes);
app.post('/api/twilio/sms-inbound', handleInboundSms);

// Starter+ (requireAuth covers starter, pro, elite, trial, admin)
app.use('/api/contacts',       requireAuth, contactRoutes);
app.use('/api/blast',          requireAuth, blastRoutes);
app.use('/api/inbox',          requireAuth, inboxRoutes);
app.use('/api/local-presence', requireAuth, localPresenceRoutes);
app.use('/api/analytics',      requireAuth, analyticsRoutes);
app.use('/api/settings',       requireAuth, settingsRoutes);
app.use('/api/agent',          requireAuth, agentRoutes);
app.use('/api/contact-groups', requireAuth, contactGroupRoutes);
app.use('/api/dialer',         dialerWebhooks);        // public Twilio webhooks (no auth)
app.use('/api/dialer',         requireAuth, dialerRoutes); // authenticated dialer endpoints

// Pro+ features
app.use('/api/sequences',      requireAuth, requirePlan('pro', 'elite'), sequenceRoutes);
app.use('/api/triple-dial',    requireAuth, requirePlan('pro', 'elite'), tripleDialRoutes);
app.use('/api/blast/scheduled',requireAuth, requirePlan('pro', 'elite'), scheduledBlastRoutes);
app.use('/api/voicemail-blast',requireAuth, requirePlan('pro', 'elite'), voicemailBlastRoutes);
app.use('/api/ai-script',      requireAuth, requirePlan('pro', 'elite'), aiScriptRoutes);
app.use('/api/dnc',            requireAuth, requirePlan('pro', 'elite'), dncRoutes);
app.use('/api/appointments',   requireAuth, requirePlan('pro', 'elite'), appointmentRoutes);
app.use('/api/email',          requireAuth, requirePlan('pro', 'elite'), emailRoutes);
app.use('/api/reports',        requireAuth, requirePlan('pro', 'elite'), reportsRoutes);

// Elite-only features
app.use('/api/next-action',    requireAuth, requirePlan('elite'), nextActionRoutes);
app.use('/api/transcription',  requireAuth, requirePlan('elite'), transcriptionRoutes);

// Auth & billing (public or self-gated)
app.use('/api/auth',           authRoutes);
app.use('/api/billing',        billingRoutes);
app.use('/api/promo',          promoRoutes);
app.use('/api/team',           requireAuth, teamRoutes);

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
