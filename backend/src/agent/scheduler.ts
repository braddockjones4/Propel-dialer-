// ─── Agent Scheduler ─────────────────────────────────────────────────────────
// Cron jobs that make the agent proactive. Started once from server.ts.
import cron from 'node-cron';
import { runFollowupSweep, processDueActions } from './followupAgent';

let running = false;

export function initAgentScheduler() {
  // Execute due/deferred actions every 5 minutes.
  cron.schedule('*/5 * * * *', async () => {
    try { await processDueActions(); }
    catch (e: any) { console.warn('[AgentScheduler] due-actions error:', e.message); }
  });

  // Proactively re-engage quiet leads every 15 minutes (non-overlapping).
  cron.schedule('*/15 * * * *', async () => {
    if (running) return;
    running = true;
    try { await runFollowupSweep(); }
    catch (e: any) { console.warn('[AgentScheduler] sweep error:', e.message); }
    finally { running = false; }
  });

  console.log('[AgentScheduler] cron jobs registered (due-actions/5m, sweep/15m)');
}
