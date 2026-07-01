import React, { useEffect, useState, useCallback } from 'react';
import { API_BASE, authFetch } from '../config';
import { useToast } from './Toast';

// ─── Types ────────────────────────────────────────────────────────────────────
interface AgentSettings {
  enabled: boolean;
  autonomyMode: 'off' | 'review' | 'auto';
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
}
interface Stats { pending: number; sentToday: number; appointmentsBooked: number; escalations: number; scheduled: number; }
interface ContactLite { id: string; firstName?: string; lastName?: string; phone: string; status?: string; leadScore?: number; }
interface AgentAction {
  id: string; type: string; status: string; channel: string;
  payload: { message?: string; note?: string; status?: string; scheduledAt?: string; title?: string };
  reasoning?: string; source: string; createdAt: string; scheduledFor?: string; error?: string;
  contact?: ContactLite;
}

const GOLD = '#C9A84C';
const DARKGOLD = '#9A7A2E';

const TYPE_ICON: Record<string, string> = {
  sms: '💬', followup: '🔁', appointment: '📅', status: '📊', note: '📝', dnc: '🚫', escalate: '⚠️',
};
const STATUS_COLOR: Record<string, string> = {
  pending: '#C9A84C', sent: '#22c55e', executed: '#22c55e', scheduled: '#3b82f6',
  rejected: '#9ca3af', failed: '#ef4444', skipped: '#9ca3af',
};

export default function AgentConsole() {
  const { success, error, info } = useToast();
  const [tab, setTab] = useState<'approvals' | 'activity' | 'settings'>('approvals');
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [pending, setPending] = useState<AgentAction[]>([]);
  const [activity, setActivity] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<AgentSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [s, st, p, a] = await Promise.all([
        authFetch(`${API_BASE}/agent/settings`).then((r) => r.json()),
        authFetch(`${API_BASE}/agent/stats`).then((r) => r.json()),
        authFetch(`${API_BASE}/agent/pending`).then((r) => r.json()),
        authFetch(`${API_BASE}/agent/actions?limit=60`).then((r) => r.json()),
      ]);
      setSettings(s); setDraft(s); setStats(st);
      setPending(Array.isArray(p) ? p : []);
      setActivity(Array.isArray(a) ? a : []);
    } catch {
      /* ignore — surfaced via empty state */
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { authFetch(`${API_BASE}/agent/stats`).then((r) => r.json()).then(setStats).catch(() => {}); }, 20000);
    return () => clearInterval(t);
  }, []);

  // ── Settings mutations ────────────────────────────────────────────────────
  const patchSettings = async (patch: Partial<AgentSettings>) => {
    const r = await authFetch(`${API_BASE}/agent/settings`, { method: 'PUT', body: JSON.stringify(patch) });
    const updated = await r.json();
    setSettings(updated); setDraft(updated);
    return updated;
  };
  const setMode = async (mode: AgentSettings['autonomyMode']) => {
    await patchSettings({ autonomyMode: mode, enabled: mode !== 'off' });
    info(mode === 'off' ? 'Agent paused' : mode === 'review' ? 'Review mode — drafts need your approval' : 'Auto mode — agent sends within guardrails');
  };
  const saveSettings = async () => {
    if (!draft) return;
    setSavingSettings(true);
    try { await patchSettings(draft); success('Agent settings saved'); }
    catch { error('Could not save settings'); }
    finally { setSavingSettings(false); }
  };

  // ── Approvals ─────────────────────────────────────────────────────────────
  const approve = async (a: AgentAction) => {
    const message = edits[a.id] ?? a.payload.message;
    try {
      await authFetch(`${API_BASE}/agent/actions/${a.id}/approve`, {
        method: 'POST', body: JSON.stringify(message ? { message } : {}),
      });
      success(a.type === 'appointment' ? 'Appointment booked' : 'Sent ✓');
      setPending((p) => p.filter((x) => x.id !== a.id));
      load();
    } catch { error('Action failed'); }
  };
  const reject = async (a: AgentAction) => {
    try {
      await authFetch(`${API_BASE}/agent/actions/${a.id}/reject`, { method: 'POST' });
      setPending((p) => p.filter((x) => x.id !== a.id));
      info('Dismissed');
    } catch { error('Could not dismiss'); }
  };
  const runSweep = async () => {
    info('Scanning leads…');
    try { await authFetch(`${API_BASE}/agent/sweep`, { method: 'POST' }); await load(); success('Sweep complete'); }
    catch { error('Sweep failed'); }
  };

  const nameOf = (c?: ContactLite) => c ? `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.phone : 'Unknown';

  if (loading) return <div className="max-w-4xl mx-auto p-6"><div className="h-40 rounded-xl animate-pulse" style={{ background: 'rgba(201,168,76,0.06)' }} /></div>;

  const mode = settings?.autonomyMode || 'off';

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 22 }}>🤖</span>
            <h1 className="text-2xl font-serif font-light text-black" style={{ letterSpacing: '0.02em' }}>AI Agent</h1>
          </div>
          <p className="text-xs text-gray-500 mt-1">Your autonomous teammate — answers leads, follows up, and books appointments.</p>
        </div>
        {/* Mode selector */}
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: '#faf7ef', border: '1px solid rgba(201,168,76,0.25)' }}>
          {(['off', 'review', 'auto'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className="px-3 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wide transition-all"
              style={{
                background: mode === m ? (m === 'auto' ? GOLD : m === 'review' ? 'rgba(201,168,76,0.25)' : '#e5e7eb') : 'transparent',
                color: mode === m ? (m === 'auto' ? '#fff' : DARKGOLD) : '#9ca3af',
              }}>
              {m === 'off' ? 'Off' : m === 'review' ? 'Review' : 'Auto'}
            </button>
          ))}
        </div>
      </div>

      {/* Mode explainer */}
      <div className="mb-5 rounded-lg px-4 py-2.5 text-[12px]" style={{ background: mode === 'off' ? '#f9fafb' : 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.18)', color: '#6b7280' }}>
        {mode === 'off' && <>The agent is <b>paused</b>. It won’t message anyone until you switch to Review or Auto.</>}
        {mode === 'review' && <><b>Review mode:</b> the agent drafts every reply and follow-up, but nothing sends until you approve it below. Safest way to build trust.</>}
        {mode === 'auto' && <><b>Auto mode:</b> the agent replies and books appointments on its own, within your guardrails (quiet hours, daily caps, DNC, escalation). High-risk cases still come to you.</>}
      </div>

      {/* ── Stats ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Awaiting approval" value={stats?.pending ?? 0} highlight={(stats?.pending ?? 0) > 0} />
        <Stat label="Texts sent today" value={stats?.sentToday ?? 0} />
        <Stat label="Appointments booked" value={stats?.appointmentsBooked ?? 0} />
        <Stat label="Escalations" value={stats?.escalations ?? 0} />
      </div>

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b mb-4" style={{ borderColor: '#f0ece0' }}>
        {(['approvals', 'activity', 'settings'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors relative"
            style={{ color: tab === t ? DARKGOLD : '#9ca3af' }}>
            {t === 'approvals' ? `Approvals${(stats?.pending ?? 0) > 0 ? ` (${stats?.pending})` : ''}` : t}
            {tab === t && <span style={{ position: 'absolute', bottom: -1, left: 8, right: 8, height: 2, background: GOLD, borderRadius: 2 }} />}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={runSweep} className="text-[10px] uppercase tracking-wide px-2.5 py-1 rounded border" style={{ borderColor: 'rgba(201,168,76,0.4)', color: DARKGOLD }}>
          Scan leads now
        </button>
      </div>

      {/* ── Approvals tab ─────────────────────────────────────── */}
      {tab === 'approvals' && (
        <div className="space-y-3">
          {pending.length === 0 && (
            <Empty icon="✅" title="Nothing to approve" sub={mode === 'auto' ? 'Auto mode handles routine actions for you. High-risk ones will appear here.' : 'When the agent drafts a reply or follow-up, it will show up here for your approval.'} />
          )}
          {pending.map((a) => (
            <div key={a.id} className="rounded-xl border p-4" style={{ borderColor: 'rgba(201,168,76,0.25)', background: '#fffdf8' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span>{TYPE_ICON[a.type] || '•'}</span>
                  <span className="text-sm font-semibold text-black">{nameOf(a.contact)}</span>
                  {a.contact?.leadScore != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(201,168,76,0.12)', color: DARKGOLD }}>score {a.contact.leadScore}</span>}
                </div>
                <span className="text-[10px] uppercase tracking-wide text-gray-400">{a.type} · {a.source.replace('-agent', '')}</span>
              </div>
              {a.reasoning && <p className="text-[11px] text-gray-400 italic mb-2">{a.reasoning}</p>}

              {(a.type === 'sms' || a.type === 'followup' || a.type === 'appointment') && (
                <textarea
                  className="w-full text-[13px] rounded-lg p-2.5 border resize-none leading-relaxed"
                  style={{ borderColor: '#eadfbf', background: '#fff', minHeight: 64 }}
                  value={edits[a.id] ?? a.payload.message ?? ''}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [a.id]: e.target.value }))}
                />
              )}
              {a.type === 'appointment' && a.payload.scheduledAt && (
                <p className="text-[11px] text-gray-500 mt-1">📅 {new Date(a.payload.scheduledAt).toLocaleString()}</p>
              )}
              {(a.type === 'status' || a.type === 'dnc') && (
                <p className="text-[13px] text-gray-700">Set status → <b>{a.payload.status || a.type}</b></p>
              )}

              <div className="flex items-center gap-2 mt-3">
                <button onClick={() => approve(a)} className="px-3.5 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide text-white" style={{ background: GOLD }}>
                  {a.type === 'appointment' ? 'Approve & book' : a.type === 'sms' || a.type === 'followup' ? 'Approve & send' : 'Approve'}
                </button>
                <button onClick={() => reject(a)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af', border: '1px solid #e5e7eb' }}>
                  Dismiss
                </button>
                {(edits[a.id] != null && edits[a.id] !== a.payload.message) && <span className="text-[10px] text-gray-400">edited</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Activity tab ──────────────────────────────────────── */}
      {tab === 'activity' && (
        <div className="space-y-2">
          {activity.length === 0 && <Empty icon="🕐" title="No activity yet" sub="Agent actions will appear here as they happen." />}
          {activity.map((a) => (
            <div key={a.id} className="flex items-start gap-3 rounded-lg border px-3 py-2.5" style={{ borderColor: '#f0ece0', background: '#fff' }}>
              <span className="mt-0.5">{TYPE_ICON[a.type] || '•'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-medium text-black">{nameOf(a.contact)}</span>
                  <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full" style={{ background: `${STATUS_COLOR[a.status] || '#9ca3af'}18`, color: STATUS_COLOR[a.status] || '#9ca3af' }}>{a.status}</span>
                  <span className="text-[10px] text-gray-300">{new Date(a.createdAt).toLocaleString()}</span>
                </div>
                {a.payload.message && <p className="text-[12px] text-gray-600 mt-0.5 truncate">{a.payload.message}</p>}
                {a.type === 'escalate' && <p className="text-[12px] text-amber-600 mt-0.5">⚠️ {a.payload.note || a.reasoning}</p>}
                {a.error && <p className="text-[11px] text-red-400 mt-0.5">{a.error}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Settings tab ──────────────────────────────────────── */}
      {tab === 'settings' && draft && (
        <div className="space-y-5">
          <Field label="Agent name" hint="How the agent signs its messages.">
            <input className="inp" value={draft.agentName} onChange={(e) => setDraft({ ...draft, agentName: e.target.value })} />
          </Field>
          <Field label="Persona" hint="The agent's personality and boundaries.">
            <textarea className="inp" style={{ minHeight: 60 }} value={draft.persona} onChange={(e) => setDraft({ ...draft, persona: e.target.value })} />
          </Field>
          <Field label="Goals" hint="What the agent is trying to accomplish in each conversation.">
            <textarea className="inp" style={{ minHeight: 60 }} value={draft.goals} onChange={(e) => setDraft({ ...draft, goals: e.target.value })} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Quiet hours start" hint="No texts after (24h)">
              <input type="number" min={0} max={23} className="inp" value={draft.quietHoursStart} onChange={(e) => setDraft({ ...draft, quietHoursStart: +e.target.value })} />
            </Field>
            <Field label="Quiet hours end" hint="Texts resume at (24h)">
              <input type="number" min={0} max={23} className="inp" value={draft.quietHoursEnd} onChange={(e) => setDraft({ ...draft, quietHoursEnd: +e.target.value })} />
            </Field>
            <Field label="Daily text cap / contact" hint="Anti-spam guardrail">
              <input type="number" min={1} max={20} className="inp" value={draft.dailySmsCapPerContact} onChange={(e) => setDraft({ ...draft, dailySmsCapPerContact: +e.target.value })} />
            </Field>
            <Field label="Max auto-replies / thread" hint="Then hand to human">
              <input type="number" min={1} max={20} className="inp" value={draft.maxAgentRepliesPerThread} onChange={(e) => setDraft({ ...draft, maxAgentRepliesPerThread: +e.target.value })} />
            </Field>
          </div>

          <Field label="Escalation keywords" hint="If a lead's message contains any of these, the agent hands off to you instead of replying.">
            <input className="inp" value={draft.escalateKeywords} onChange={(e) => setDraft({ ...draft, escalateKeywords: e.target.value })} />
          </Field>

          <label className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer">
            <input type="checkbox" checked={draft.autoBookAppointments} onChange={(e) => setDraft({ ...draft, autoBookAppointments: e.target.checked })} />
            Let the agent book appointments when a lead agrees to a time
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={saveSettings} disabled={savingSettings} className="px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide text-white" style={{ background: GOLD, opacity: savingSettings ? 0.6 : 1 }}>
              {savingSettings ? 'Saving…' : 'Save settings'}
            </button>
            <span className="text-[11px] text-gray-400">Model: {draft.model}</span>
          </div>
        </div>
      )}

      <style>{`
        .inp { width:100%; border:1px solid #eadfbf; border-radius:8px; padding:8px 10px; font-size:13px; background:#fff; outline:none; }
        .inp:focus { border-color:${GOLD}; }
      `}</style>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: highlight ? GOLD : '#f0ece0', background: highlight ? 'rgba(201,168,76,0.06)' : '#fff' }}>
      <div className="text-2xl font-light text-black">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}
function Empty({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="text-center py-12">
      <div style={{ fontSize: 34 }}>{icon}</div>
      <div className="text-sm font-medium text-gray-600 mt-2">{title}</div>
      <div className="text-[12px] text-gray-400 mt-1 max-w-sm mx-auto">{sub}</div>
    </div>
  );
}
