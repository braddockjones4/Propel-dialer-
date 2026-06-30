import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE, authFetch } from '../config';

interface Props {
  onNavigate: (page: string) => void;
}

interface Stats {
  total: number;
  new: number;
  hot: number;
  appointment: number;
  closed: number;
}

const STAGE_COLORS: Record<string, string> = {
  new:         '#9ca3af',
  contacted:   '#3b82f6',
  hot:         '#C9A84C',
  appointment: '#8b5cf6',
  closed:      '#22c55e',
};

export default function Dashboard({ onNavigate }: Props) {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({ total: 0, new: 0, hot: 0, appointment: 0, closed: 0 });
  const [loading, setLoading] = useState(true);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.name?.split(' ')[0] || '';

  useEffect(() => {
    authFetch(`${API_BASE}/contacts?limit=500`)
      .then(r => r.json())
      .then((data: any[]) => {
        const arr = Array.isArray(data) ? data : [];
        setStats({
          total:       arr.length,
          new:         arr.filter(c => c.status === 'new').length,
          hot:         arr.filter(c => c.status === 'hot').length,
          appointment: arr.filter(c => c.status === 'appointment').length,
          closed:      arr.filter(c => c.status === 'closed').length,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const actions = [
    { label: 'Start Dialing', sub: 'Work your contact queue', page: 'dialer', gold: true },
    { label: 'Contacts',      sub: 'Browse & manage your CRM', page: 'contacts', gold: false },
    { label: 'Pipeline',      sub: 'Track deals by stage',     page: 'pipeline', gold: false },
    { label: 'Inbox',         sub: 'Check inbound messages',   page: 'inbox',    gold: false },
  ];

  const pipelineStages = [
    { key: 'hot',         label: 'Hot Leads',   count: stats.hot },
    { key: 'appointment', label: 'Appointment', count: stats.appointment },
    { key: 'closed',      label: 'Closed',      count: stats.closed },
  ];

  return (
    <div className="min-h-screen" style={{ background: '#f8f8f8' }}>

      {/* Hero greeting */}
      <div style={{
        background: 'linear-gradient(135deg, #0A0A0A 0%, #1a1a1a 100%)',
        padding: '28px 20px 24px',
      }}>
        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 11, letterSpacing: '0.35em', color: 'rgba(201,168,76,0.6)', textTransform: 'uppercase', marginBottom: 6 }}>
          {greeting}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 300, color: '#fff', letterSpacing: '0.02em', margin: 0 }}>
          {firstName}
        </h1>
        <div style={{ height: 1, background: 'linear-gradient(90deg, rgba(201,168,76,0.5), transparent)', marginTop: 16 }} />

        {/* Summary stats row */}
        {!loading && (
          <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
            {[
              { label: 'Total Contacts', value: stats.total },
              { label: 'Hot Leads',      value: stats.hot,         gold: true },
              { label: 'Appointments',   value: stats.appointment, gold: true },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 24, fontWeight: 300, color: s.gold ? '#C9A84C' : '#fff', lineHeight: 1 }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 3 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Quick actions */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 10 }}>
            Quick Actions
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {actions.map(a => (
              <button
                key={a.page}
                onClick={() => onNavigate(a.page)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 16px', borderRadius: 12, textAlign: 'left',
                  background: a.gold ? 'linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%)' : '#fff',
                  border: a.gold ? '1px solid rgba(201,168,76,0.3)' : '1px solid rgba(0,0,0,0.07)',
                  boxShadow: a.gold ? '0 4px 20px rgba(0,0,0,0.15)' : '0 1px 4px rgba(0,0,0,0.05)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: a.gold ? '#fff' : '#111', letterSpacing: '0.01em' }}>
                    {a.label}
                  </div>
                  <div style={{ fontSize: 11, color: a.gold ? 'rgba(201,168,76,0.7)' : '#9ca3af', marginTop: 1 }}>
                    {a.sub}
                  </div>
                </div>
                <span style={{ fontSize: 14, color: a.gold ? '#C9A84C' : '#d1d5db' }}>→</span>
              </button>
            ))}
          </div>
        </div>

        {/* Pipeline snapshot */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af' }}>
              Pipeline
            </div>
            <button onClick={() => onNavigate('pipeline')} style={{ fontSize: 10, color: '#C9A84C', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.05em' }}>
              View all →
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {pipelineStages.map(s => (
              <button
                key={s.key}
                onClick={() => onNavigate('pipeline')}
                style={{
                  flex: 1, padding: '14px 10px', borderRadius: 10, textAlign: 'center',
                  background: '#fff', border: `1px solid ${STAGE_COLORS[s.key]}25`,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 26, fontWeight: 300, color: STAGE_COLORS[s.key], lineHeight: 1 }}>
                  {loading ? '—' : s.count}
                </div>
                <div style={{ fontSize: 9, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>
                  {s.label}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Total contacts footer */}
        {!loading && stats.total > 0 && (
          <button
            onClick={() => onNavigate('contacts')}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderRadius: 10,
              background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{stats.total} Contacts in CRM</div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>
                  {stats.new} new · {stats.hot} hot
                </div>
              </div>
            </div>
            <span style={{ fontSize: 12, color: '#d1d5db' }}>→</span>
          </button>
        )}
      </div>
    </div>
  );
}
