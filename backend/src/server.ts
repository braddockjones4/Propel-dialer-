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
import authRoutes from './routes/auth';
import billingRoutes from './routes/billing';
import teamRoutes from './routes/team';
import settingsRoutes from './routes/settings';

dotenv.config();

const app  = express();
const http = createServer(app);
const PORT = process.env.PORT || 3001;

// ── Init Socket.io ────────────────────────────────────────────────────────────
initSocket(http);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/twilio',         twilioRoutes);
app.use('/api/sequences',      sequenceRoutes);
app.use('/api/contacts',       contactRoutes);
app.use('/api/blast',          blastRoutes);
app.use('/api/inbox',          inboxRoutes);
app.post('/api/twilio/sms-inbound', handleInboundSms);
app.use('/api/triple-dial',    tripleDialRoutes);
app.use('/api/local-presence', localPresenceRoutes);
app.use('/api/analytics',      analyticsRoutes);
app.use('/api/blast/scheduled',scheduledBlastRoutes);
app.use('/api/transcription',  transcriptionRoutes);
app.use('/api/voicemail-blast',voicemailBlastRoutes);
app.use('/api/ai-script',      aiScriptRoutes);
app.use('/api/dnc',            dncRoutes);
app.use('/api/appointments',   appointmentRoutes);
app.use('/api/email',          emailRoutes);
app.use('/api/next-action',    nextActionRoutes);
app.use('/api/reports',        reportsRoutes);
app.use('/api/auth',           authRoutes);
app.use('/api/billing',        billingRoutes);
app.use('/api/team',           teamRoutes);
app.use('/api/settings',       settingsRoutes);

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
});

export default app;
