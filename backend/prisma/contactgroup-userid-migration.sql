-- ─────────────────────────────────────────────────────────────────────────────
-- Propel Dialer — ContactGroup per-account scoping (part of the account-isolation
-- fix in commit 2ea4fc7). Run this in the Supabase SQL editor, then run
-- `npx prisma generate` (from backend/) and restart the backend.
--
-- What this does:
--   1. Adds ContactGroup.userId (nullable at first).
--   2. Backfills every existing group to the oldest admin user's id (today
--      there is only one real account with data, so this preserves it intact —
--      same convention as the earlier accountId-style migrations in this repo).
--   3. Makes userId NOT NULL now that every row has a value.
--   4. Drops the old global-unique constraint on ContactGroup.name (if present)
--      in favor of a per-user unique constraint.
--
-- Safe to re-run — every step is idempotent (IF NOT EXISTS / guarded UPDATEs).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE primary_user_id TEXT;
BEGIN
  SELECT id INTO primary_user_id FROM "User" WHERE role = 'admin' ORDER BY "createdAt" ASC LIMIT 1;
  IF primary_user_id IS NULL THEN
    RAISE EXCEPTION 'No admin user found — aborting migration.';
  END IF;

  ALTER TABLE "ContactGroup" ADD COLUMN IF NOT EXISTS "userId" TEXT;
  UPDATE "ContactGroup" SET "userId" = primary_user_id WHERE "userId" IS NULL;
  ALTER TABLE "ContactGroup" ALTER COLUMN "userId" SET NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ContactGroup_userId_idx" ON "ContactGroup"("userId");

-- The old global uniqueness on `name` may exist either as a table constraint
-- or as a bare unique index (seen in production: a plain CREATE UNIQUE INDEX
-- with no backing pg_constraint row, which a DROP CONSTRAINT check alone
-- would silently miss) — drop both forms defensively.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactGroup_name_key') THEN
    ALTER TABLE "ContactGroup" DROP CONSTRAINT "ContactGroup_name_key";
  END IF;
END $$;
DROP INDEX IF EXISTS "ContactGroup_name_key";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactGroup_userId_name_key') THEN
    ALTER TABLE "ContactGroup" ADD CONSTRAINT "ContactGroup_userId_name_key" UNIQUE ("userId", "name");
  END IF;
END $$;
