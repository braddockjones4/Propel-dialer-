import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { API_BASE, authFetch } from '../config';


interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
  createdAt: string;
}

interface TeamStats {
  period: string;
  team: TeamMember[];
  totals: { calls: number; messages: number; hotLeads: number; appointments: number };
}

export default function TeamPanel() {
  const { user, token } = useAuth();
  const toast = useToast();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [stats,   setStats]   = useState<TeamStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [invEmail,   setInvEmail]   = useState('');
  const [invName,    setInvName]    = useState('');
  const [invRole,    setInvRole]    = useState('agent');
  const [invPass,    setInvPass]    = useState('');
  const [inviting,   setInviting]   = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const load = async () => {
    setLoading(true);
    const [mRes, sRes] = await Promise.all([
      authFetch(`${API_BASE}/team/members`, { headers }),
      authFetch(`${API_BASE}/team/stats`,   { headers }),
    ]);
    if (mRes.ok) setMembers(await mRes.json());
    if (sRes.ok) setStats(await sRes.json());
    setLoading(false);
  };

  useEffect(() => { if (user?.role === 'admin') load(); }, []);

  const invite = async () => {
    if (!invEmail || !invPass) { toast.error('Email and password required'); return; }
    setInviting(true);
    const r = await authFetch(`${API_BASE}/team/invite`, {
      method: 'POST', headers,
      body: JSON.stringify({ email: invEmail, name: invName, role: invRole, tempPassword: invPass }),
    });
    const data = await r.json();
    setInviting(false);
    if (r.ok) {
      toast.success(`${invEmail} added — share temp password: ${invPass}`);
      setInvEmail(''); setInvName(''); setInvPass(''); setShowInvite(false);
      load();
    } else {
      toast.error(data.error || 'Invite failed');
    }
  };

  const updateRole = async (id: string, role: string) => {
    await authFetch(`${API_BASE}/team/members/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ role }) });
    setMembers(m => m.map(x => x.id === id ? { ...x, role } : x));
    toast.success('Role updated');
  };

  const remove = async (id: string, email: string) => {
    if (!window.confirm(`Remove ${email} from the team?`)) return;
    await authFetch(`${API_BASE}/team/members/${id}`, { method: 'DELETE', headers });
    setMembers(m => m.filter(x => x.id !== id));
    toast.success('Member removed');
  };

  if (user?.role !== 'admin') {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af', fontSize: 13 }}>
        Team management is available to admins only.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stats banner */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { label: 'Calls (30d)',  value: stats.totals.calls },
            { label: 'Hot Leads',    value: stats.totals.hotLeads },
            { label: 'Appointments', value: stats.totals.appointments },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 300, color: '#1a1a1a' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Members list */}
      <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #f5f5f5' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#374151' }}>
            Team Members ({members.length})
          </span>
          <button
            onClick={() => setShowInvite(s => !s)}
            style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}
          >
            + Invite Agent
          </button>
        </div>

        {/* Invite form */}
        {showInvite && (
          <div style={{ padding: '16px 18px', background: 'rgba(201,168,76,0.04)', borderBottom: '1px solid #f5f5f5' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <input value={invEmail}   onChange={e => setInvEmail(e.target.value)}   placeholder="Email"          style={inp} />
              <input value={invName}    onChange={e => setInvName(e.target.value)}    placeholder="Name (optional)" style={inp} />
              <select value={invRole}   onChange={e => setInvRole(e.target.value)}    style={inp}>
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={invPass} onChange={e => setInvPass(e.target.value)} placeholder="Temp password (share with agent)" style={{ ...inp, flex: 1 }} type="text" />
              <button onClick={invite} disabled={inviting} style={{ background: '#C9A84C', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {inviting ? '…' : 'Send Invite'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
        ) : members.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No team members yet. Invite an agent to get started.</div>
        ) : (
          members.map(m => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid #f9fafb' }}>
              {/* Avatar */}
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: m.role === 'admin' ? '#1a1a1a' : 'rgba(201,168,76,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: m.role === 'admin' ? '#C9A84C' : '#9A7A2E', flexShrink: 0 }}>
                {(m.name || m.email).charAt(0).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{m.name || '—'}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
              </div>

              <select
                value={m.role}
                onChange={e => updateRole(m.id, e.target.value)}
                disabled={m.id === user?.id}
                style={{ ...inp, width: 90, fontSize: 11 }}
              >
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
              </select>

              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: m.plan === 'elite' ? 'rgba(147,51,234,0.1)' : m.plan === 'pro' ? 'rgba(201,168,76,0.1)' : '#f3f4f6', color: m.plan === 'elite' ? '#9333ea' : m.plan === 'pro' ? '#9A7A2E' : '#9ca3af', textTransform: 'capitalize', fontWeight: 700 }}>
                {m.plan}
              </span>

              {m.id !== user?.id && (
                <button onClick={() => remove(m.id, m.email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 14, padding: '0 4px' }}>✕</button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: '8px 11px', border: '1px solid #e5e7eb', borderRadius: 6,
  fontSize: 12, color: '#1a1a1a', background: '#fff', outline: 'none',
};
