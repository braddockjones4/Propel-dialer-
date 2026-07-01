// ─── Agent Settings (singleton) ──────────────────────────────────────────────
import prisma from '../db';

export type AutonomyMode = 'off' | 'review' | 'auto';

export interface AgentConfig {
  id: string;
  enabled: boolean;
  autonomyMode: AutonomyMode;
  model: string;
  agentName: string;
  persona: string;
  tone: string;
  goals: string;
  autoBookAppointments: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  dailySmsCapPerContact: number;
  maxAgentRepliesPerThread: number;
  escalateKeywords: string;
  updatedAt: Date;
}

let cache: AgentConfig | null = null;
let cacheAt = 0;
const TTL = 15_000; // 15s cache so hot paths don't hammer the DB

export async function getAgentSettings(force = false): Promise<AgentConfig> {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache;
  let row = await prisma.agentSettings.findUnique({ where: { id: 'singleton' } });
  if (!row) {
    row = await prisma.agentSettings.create({ data: { id: 'singleton' } });
  }
  cache = row as AgentConfig;
  cacheAt = Date.now();
  return cache;
}

export async function updateAgentSettings(patch: Partial<AgentConfig>): Promise<AgentConfig> {
  // Whitelist writable fields
  const allowed: (keyof AgentConfig)[] = [
    'enabled', 'autonomyMode', 'model', 'agentName', 'persona', 'tone', 'goals',
    'autoBookAppointments', 'quietHoursStart', 'quietHoursEnd',
    'dailySmsCapPerContact', 'maxAgentRepliesPerThread', 'escalateKeywords',
  ];
  const data: any = {};
  for (const k of allowed) if (k in patch) data[k] = (patch as any)[k];

  const row = await prisma.agentSettings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  });
  cache = row as AgentConfig;
  cacheAt = Date.now();
  return cache;
}
