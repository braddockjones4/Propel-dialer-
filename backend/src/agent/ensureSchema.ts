// ─── Self-Healing Schema ─────────────────────────────────────────────────────
// Creates the agent tables/columns if they don't exist yet. Idempotent and safe
// to run on every boot. Runs AFTER the server is listening (non-blocking) so a
// slow database can never delay or hang startup.
import prisma from '../db';

const STATEMENTS: string[] = [
  // ── Multi-tenancy columns (added 2026-07) ────────────────────────────────
  `ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "userId" TEXT`,
  `ALTER TABLE "LocalNumber" ADD COLUMN IF NOT EXISTS "userId" TEXT`,
  // Drop old global phone unique; replace with per-user composite unique
  `ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_phone_key"`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Contact_userId_phone_key" ON "Contact"("userId", "phone")`,
  `CREATE INDEX IF NOT EXISTS "Contact_userId_idx" ON "Contact"("userId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LocalNumber_userId_number_key" ON "LocalNumber"("userId", "number")`,
  // Per-user Twilio credentials + onboarding on DialerSettings
  `ALTER TABLE "DialerSettings" ADD COLUMN IF NOT EXISTS "twilioAccountSid" TEXT`,
  `ALTER TABLE "DialerSettings" ADD COLUMN IF NOT EXISTS "twilioAuthToken" TEXT`,
  `ALTER TABLE "DialerSettings" ADD COLUMN IF NOT EXISTS "twilioApiKey" TEXT`,
  `ALTER TABLE "DialerSettings" ADD COLUMN IF NOT EXISTS "twilioApiSecret" TEXT`,
  `ALTER TABLE "DialerSettings" ADD COLUMN IF NOT EXISTS "twilioTwimlAppSid" TEXT`,
  `ALTER TABLE "DialerSettings" ADD COLUMN IF NOT EXISTS "twilioCallerId" TEXT`,
  `ALTER TABLE "DialerSettings" ADD COLUMN IF NOT EXISTS "agentName" TEXT`,
  `ALTER TABLE "DialerSettings" ADD COLUMN IF NOT EXISTS "onboardingStep" INTEGER NOT NULL DEFAULT 0`,

  // ── Agent columns ─────────────────────────────────────────────────────────
  `ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "agentPaused" BOOLEAN NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS "AgentSettings" (
     "id" TEXT PRIMARY KEY DEFAULT 'singleton',
     "enabled" BOOLEAN NOT NULL DEFAULT true,
     "autonomyMode" TEXT NOT NULL DEFAULT 'review',
     "model" TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
     "agentName" TEXT NOT NULL DEFAULT 'Propel Assistant',
     "persona" TEXT NOT NULL DEFAULT 'A warm, concise, professional real estate assistant who books appointments and keeps leads engaged. Never pushy, never spammy.',
     "tone" TEXT NOT NULL DEFAULT 'friendly-professional',
     "goals" TEXT NOT NULL DEFAULT 'Respond fast, qualify the lead, and book a listing appointment. Answer questions helpfully. Hand off to the human agent when unsure.',
     "autoBookAppointments" BOOLEAN NOT NULL DEFAULT true,
     "quietHoursStart" INTEGER NOT NULL DEFAULT 21,
     "quietHoursEnd" INTEGER NOT NULL DEFAULT 8,
     "dailySmsCapPerContact" INTEGER NOT NULL DEFAULT 4,
     "maxAgentRepliesPerThread" INTEGER NOT NULL DEFAULT 6,
     "escalateKeywords" TEXT NOT NULL DEFAULT 'lawyer,attorney,sue,complaint,harass,report you,scam,cease',
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS "AgentAction" (
     "id" TEXT PRIMARY KEY,
     "contactId" TEXT,
     "type" TEXT NOT NULL,
     "status" TEXT NOT NULL DEFAULT 'pending',
     "channel" TEXT NOT NULL DEFAULT 'sms',
     "payload" TEXT NOT NULL DEFAULT '{}',
     "reasoning" TEXT,
     "source" TEXT NOT NULL DEFAULT 'inbox-agent',
     "scheduledFor" TIMESTAMP(3),
     "error" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "executedAt" TIMESTAMP(3),
     CONSTRAINT "AgentAction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS "AgentAction_status_idx" ON "AgentAction"("status")`,
  `CREATE INDEX IF NOT EXISTS "AgentAction_contactId_idx" ON "AgentAction"("contactId")`,
  `CREATE INDEX IF NOT EXISTS "AgentAction_scheduledFor_idx" ON "AgentAction"("scheduledFor")`,
];

let ensured = false;

export async function ensureAgentSchema(): Promise<void> {
  if (ensured) return;
  for (const sql of STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e: any) {
      console.warn('[ensureAgentSchema] statement skipped:', e?.message);
    }
  }
  ensured = true;
  console.log('[ensureAgentSchema] ✅ schema ensured');
}
