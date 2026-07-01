import { PrismaClient } from '@prisma/client';

/**
 * Tuned DB connection. Caps the pool and adds timeouts so that a saturated or
 * slow database FAILS FAST with a clear error instead of leaving requests
 * hanging forever, and so this process never hogs Supabase's limited direct
 * connection. Prevents the "spinner that never resolves" symptom.
 */
function tunedUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '3');
    if (!u.searchParams.has('pool_timeout'))     u.searchParams.set('pool_timeout', '15');
    if (!u.searchParams.has('connect_timeout'))  u.searchParams.set('connect_timeout', '15');
    return u.toString();
  } catch {
    return raw;
  }
}

const url = tunedUrl();
const prisma = url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();

export default prisma;
