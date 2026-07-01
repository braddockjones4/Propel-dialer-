-- ─────────────────────────────────────────────────────────────────────────────
-- Propel AI Agent — manual migration (fallback)
-- PREFERRED: from backend/ run `npx prisma db push` (creates these AND regenerates
-- the Prisma client in one step). Use this SQL only if applying by hand, e.g. in
-- the Supabase SQL editor. NOTE: after running this, you STILL must run
-- `npx prisma generate` so the app code knows about the new models.
-- Safe to run more than once (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Contact: exclude-from-agent flag
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "agentPaused" BOOLEAN NOT NULL DEFAULT false;

-- 2) AgentSettings (singleton config row)
CREATE TABLE IF NOT EXISTS "AgentSettings" (
  "id"                       TEXT PRIMARY KEY DEFAULT 'singleton',
  "enabled"                  BOOLEAN NOT NULL DEFAULT true,
  "autonomyMode"             TEXT    NOT NULL DEFAULT 'review',
  "model"                    TEXT    NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  "agentName"                TEXT    NOT NULL DEFAULT 'Propel Assistant',
  "persona"                  TEXT    NOT NULL DEFAULT 'A warm, concise, professional real estate assistant who books appointments and keeps leads engaged. Never pushy, never spammy.',
  "tone"                     TEXT    NOT NULL DEFAULT 'friendly-professional',
  "goals"                    TEXT    NOT NULL DEFAULT 'Respond fast, qualify the lead, and book a listing appointment. Answer questions helpfully. Hand off to the human agent when unsure.',
  "autoBookAppointments"     BOOLEAN NOT NULL DEFAULT true,
  "quietHoursStart"          INTEGER NOT NULL DEFAULT 21,
  "quietHoursEnd"            INTEGER NOT NULL DEFAULT 8,
  "dailySmsCapPerContact"    INTEGER NOT NULL DEFAULT 4,
  "maxAgentRepliesPerThread" INTEGER NOT NULL DEFAULT 6,
  "escalateKeywords"         TEXT    NOT NULL DEFAULT 'lawyer,attorney,sue,complaint,harass,report you,scam,cease',
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3) AgentAction (approval queue + activity log)
CREATE TABLE IF NOT EXISTS "AgentAction" (
  "id"           TEXT PRIMARY KEY,
  "contactId"    TEXT,
  "type"         TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'pending',
  "channel"      TEXT NOT NULL DEFAULT 'sms',
  "payload"      TEXT NOT NULL DEFAULT '{}',
  "reasoning"    TEXT,
  "source"       TEXT NOT NULL DEFAULT 'inbox-agent',
  "scheduledFor" TIMESTAMP(3),
  "error"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt"   TIMESTAMP(3),
  CONSTRAINT "AgentAction_contactId_fkey" FOREIGN KEY ("contactId")
    REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AgentAction_status_idx"       ON "AgentAction"("status");
CREATE INDEX IF NOT EXISTS "AgentAction_contactId_idx"    ON "AgentAction"("contactId");
CREATE INDEX IF NOT EXISTS "AgentAction_scheduledFor_idx" ON "AgentAction"("scheduledFor");
