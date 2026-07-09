import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import TeamPanel from './TeamPanel';
import { API_BASE, authFetch } from '../config';


interface LocalNumber {
  id: string; number: string; areaCode: string; state?: string; label?: string; active: boolean; purchasedAt: string;
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

type Tab = 'account' | 'numbers' | 'integrations' | 'billing' | 'team';

const TAB_LABELS: { id: Tab; label: string; icon: string }[] = [
  { id: 'account',      label: 'Account',      icon: '👤' },
  { id: 'numbers',      label: 'Phone Numbers', icon: '📱' },
  { id: 'integrations', label: 'Integrations',  icon: '🔌' },
  { id: 'billing',      label: 'Billing',       icon: '💳' },
  { id: 'team',         label: 'Team',          icon: '👥' },
];

export default function Settings() {
  const { user, token, refresh } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('account');

  // ── Account fields ──────────────────────────────────────────────────────────
  const [name,        setName]        = useState(user?.name || '');
  const [password,    setPassword]    = useState('');
  const [savingAcct,  setSavingAcct]  = useState(false);

  // ── Numbers ─────────────────────────────────────────────────────────────────
  const [numbers,   setNumbers]   = useState<LocalNumber[]>([]);
  const [buyAC,     setBuyAC]     = useState('');
  const [buyState,  setBuyState]  = useState('');
  const [buyLabel,  setBuyLabel]  = useState('');
  const [buyMode,   setBuyMode]   = useState<'buy' | 'add'>('buy');
  const [addNumber, setAddNumber] = useState('');
  const [buying,    setBuying]    = useState(false);
  const [buyError,  setBuyError]  = useState('');

  // ── Integration status ──────────────────────────────────────────────────────
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [ngrok,  setNgrok]  = useState('');
  const [savingNgrok, setSavingNgrok] = useState(false);

  useEffect(() => {
    authFetch(`${API_BASE}/local-presence/numbers`).then(r => r.json()).then(setNumbers).catch(() => {});
    authFetch(`${API_BASE}/settings/status`).then(r => r.json()).then(setStatus).catch(() => {});
    authFetch(`${API_BASE}/settings/ngrok`).then(r => r.json()).then(d => setNgrok(d.ngrokUrl || '')).catch(() => {});
  }, []);

  // ── Account save ────────────────────────────────────────────────────────────
  const saveAccount = async () => {
    if (!token) return;
    setSavingAcct(true);
    const body: any = {};
    if (name !== user?.name) body.name = name;
    if (password) body.password = password;
    if (!Object.keys(body).length) { setSavingAcct(false); toast.info('Nothing changed'); return; }
    const r = await authFetch(`${API_BASE}/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    setSavingAcct(false);
    if (r.ok) { toast.success('Account updated'); setPassword(''); refresh(); }
    else { const d = await r.json(); toast.error(d.error || 'Update failed'); }
  };

  // ── Buy number ──────────────────────────────────────────────────────────────
  const buyNumber = async () => {
    setBuying(true); setBuyError('');
    const r = await authFetch(`${API_BASE}/local-presence/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ areaCode: buyAC, state: buyState, label: buyLabel }),
    });
    const data = await r.json();
    setBuying(false);
    if (r.ok) { setNumbers(n => [data, ...n]); setBuyAC(''); setBuyLabel(''); toast.success('Number purchased'); }
    else setBuyError(data.error || 'Could not purchase number');
  };

  const addManual = async () => {
    if (!addNumber.trim()) return;
    setBuying(true);
    const r = await authFetch(`${API_BASE}/local-presence/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: addNumber, label: buyLabel }),
    });
    const data = await r.json();
    setBuying(false);
    if (r.ok) { setNumbers(n => [data, ...n]); setAddNumber(''); setBuyLabel(''); toast.success('Number added'); }
    else setBuyError(data.error || 'Could not add number');
  };

  const toggleNumber = async (id: string, active: boolean) => {
    await authFetch(`${API_BASE}/local-presence/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    });
    setNumbers(n => n.map(x => x.id === id ? { ...x, active: !active } : x));
  };

  const deleteNumber = async (id: string) => {
    await authFetch(`${API_BASE}/local-presence/${id}`, { method: 'DELETE' });
    setNumbers(n => n.filter(x => x.id !== id));
    toast.success('Number removed');
  };

  // ── Save ngrok URL ──────────────────────────────────────────────────────────
  const saveNgrok = async () => {
    setSavingNgrok(true);
    await authFetch(`${API_BASE}/settings/ngrok`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ngrokUrl: ngrok }),
    });
    setSavingNgrok(false);
    toast.success('Ngrok URL saved — restart backend to apply');
  };

  // ── Billing portal ──────────────────────────────────────────────────────────
  const openPortal = async () => {
    if (!token) return;
    const r = await authFetch(`${API_BASE}/billing/portal`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    if (d.url) window.location.href = d.url;
    else toast.error(d.error || 'No active subscription');
  };

  const PLAN_COLOR: Record<string, string> = { trial: '#9ca3af', starter: '#3b82f6', pro: '#C9A84C', elite: '#9333ea' };
  const planColor = PLAN_COLOR[user?.plan || 'trial'] || '#9ca3af';

  const INTEGRATION_LABELS: Record<string, { label: string; doc: string; envKey: string }> = {
    twilio:    { label: 'Twilio',    doc: 'console.twilio.com', envKey: 'TWILIO_ACCOUNT_SID' },
    openai:    { label: 'OpenAI',    doc: 'platform.openai.com/api-keys', envKey: 'OPENAI_API_KEY' },
    sendgrid:  { label: 'SendGrid',  doc: 'app.sendgrid.com/settings/api_keys', envKey: 'SENDGRID_API_KEY' },
    stripe:    { label: 'Stripe',    doc: 'dashboard.stripe.com/apikeys', envKey: 'STRIPE_SECRET_KEY' },
    ngrok:     { label: 'Ngrok URL', doc: 'dashboard.ngrok.com', envKey: 'NGROK_URL' },
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 24px)' }}>
      <h1 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 24, fontWeight: 300, letterSpacing: '0.15em', marginBottom: 24, color: '#1a1a1a' }}>
        SETTINGS
      </h1>

      {/* Tab bar — scrollable on mobile */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 28, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
           className="hide-scrollbar">
        {TAB_LABELS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '8px 14px', fontSize: 11, fontWeight: 600,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              background: 'none', border: 'none', flexShrink: 0,
              borderBottom: tab === id ? '2px solid #C9A84C' : '2px solid transparent',
              color: tab === id ? '#1a1a1a' : '#9ca3af',
              cursor: 'pointer', transition: 'all 0.2s',
              marginBottom: -1, whiteSpace: 'nowrap',
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ── ACCOUNT TAB ──────────────────────────────────────────────────────── */}
      {tab === 'account' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Section title="Profile">
            <Field label="Full Name">
              <input value={name} onChange={e => setName(e.target.value)} style={inputSt} />
            </Field>
            <Field label="Email">
              <input value={user?.email || ''} disabled style={{ ...inputSt, color: '#9ca3af', background: '#f9fafb' }} />
            </Field>
            <Field label="New Password">
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave blank to keep current" style={inputSt} />
            </Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={saveAccount} disabled={savingAcct} style={btnPrimary}>
                {savingAcct ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </Section>

          <Section title="Your Plan">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: planColor, display: 'inline-block' }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', textTransform: 'capitalize' }}>{user?.plan || 'Trial'} Plan</span>
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>Role: {user?.role || 'agent'}</div>
              </div>
              <button onClick={openPortal} style={btnOutline}>Manage Subscription →</button>
            </div>
          </Section>
        </div>
      )}

      {/* ── NUMBERS TAB ──────────────────────────────────────────────────────── */}
      {tab === 'numbers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Section title="Add a Number">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {(['buy', 'add'] as const).map(m => (
                <button key={m} onClick={() => setBuyMode(m)} style={{ ...btnOutline, background: buyMode === m ? '#1a1a1a' : 'transparent', color: buyMode === m ? '#fff' : '#374151', border: '1px solid #e5e7eb' }}>
                  {m === 'buy' ? '🛒 Buy New' : '➕ Add Existing'}
                </button>
              ))}
            </div>

            {buyMode === 'buy' ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={buyAC} onChange={e => setBuyAC(e.target.value)} placeholder="Area code (e.g. 443)" style={{ ...inputSt, width: 140 }} />
                <select value={buyState} onChange={e => setBuyState(e.target.value)} style={{ ...inputSt, width: 80 }}>
                  <option value="">State</option>
                  {US_STATES.map(s => <option key={s}>{s}</option>)}
                </select>
                <input value={buyLabel} onChange={e => setBuyLabel(e.target.value)} placeholder="Label (optional)" style={{ ...inputSt, flex: 1 }} />
                <button onClick={buyNumber} disabled={buying || !buyAC} style={btnPrimary}>{buying ? '…' : 'Purchase'}</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={addNumber} onChange={e => setAddNumber(e.target.value)} placeholder="+14435551234" style={{ ...inputSt, flex: 1 }} />
                <input value={buyLabel} onChange={e => setBuyLabel(e.target.value)} placeholder="Label" style={{ ...inputSt, width: 140 }} />
                <button onClick={addManual} disabled={buying} style={btnPrimary}>{buying ? '…' : 'Add'}</button>
              </div>
            )}
            {buyError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{buyError}</div>}
          </Section>

          <Section title={`Local Presence Numbers (${numbers.length})`}>
            {numbers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af', fontSize: 13 }}>No numbers added yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {numbers.map(n => (
                  <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, border: '1px solid #f0f0f0', background: n.active ? '#fff' : '#fafafa' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: n.active ? '#1a1a1a' : '#9ca3af', flex: 1 }}>{n.number}</span>
                    {n.label && <span style={{ fontSize: 11, color: '#9ca3af' }}>{n.label}</span>}
                    <span style={{ fontSize: 10, color: '#d1d5db' }}>{n.areaCode}{n.state ? ` · ${n.state}` : ''}</span>
                    <button onClick={() => toggleNumber(n.id, n.active)} style={{ ...btnOutline, fontSize: 10, padding: '3px 10px', color: n.active ? '#22c55e' : '#9ca3af' }}>
                      {n.active ? 'Active' : 'Inactive'}
                    </button>
                    <button onClick={() => deleteNumber(n.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 13 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {/* ── INTEGRATIONS TAB ─────────────────────────────────────────────────── */}
      {tab === 'integrations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Section title="API Key Status">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
              Keys are set in <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 3 }}>backend/.env</code>. Restart the backend after any changes.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Object.entries(INTEGRATION_LABELS).filter(([k]) => k !== 'ngrok').map(([key, info]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: status[key] ? '#22c55e' : '#e5e7eb', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{info.label}</div>
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>{info.envKey}</div>
                  </div>
                  <span style={{ fontSize: 11, color: status[key] ? '#22c55e' : '#9ca3af' }}>
                    {status[key] ? '✓ Connected' : '○ Not set'}
                  </span>
                  <a href={`https://${info.doc}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#C9A84C', textDecoration: 'none' }}>
                    Get key →
                  </a>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Webhook Configuration">
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
              Your Twilio webhooks are configured to route through the Propel Dialer backend automatically.
            </div>
            <div style={{ fontFamily: 'monospace', background: '#f9fafb', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#374151' }}>
              SMS: https://propel-dialer-backend.onrender.com/api/twilio/sms-inbound<br />
              Voice: https://propel-dialer-backend.onrender.com/api/twilio/voice
            </div>
          </Section>
        </div>
      )}

      {/* ── TEAM TAB ─────────────────────────────────────────────────────────── */}
      {tab === 'team' && <TeamPanel />}

      {/* ── BILLING TAB ──────────────────────────────────────────────────────── */}
      {tab === 'billing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Section title="Current Plan">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 300, fontFamily: '"Cormorant Garamond", serif', color: '#1a1a1a', textTransform: 'capitalize', marginBottom: 4 }}>
                  {user?.plan || 'Trial'} Plan
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>
                  {user?.plan === 'trial' ? '7-day free trial' : user?.plan === 'starter' ? '$99/month' : user?.plan === 'pro' ? '$199/month' : '$399/month'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={openPortal} style={btnOutline}>Manage / Cancel →</button>
                <button onClick={() => window.open('https://propelsolutions.com', '_blank')} style={btnPrimary}>Upgrade Plan</button>
              </div>
            </div>
          </Section>

          <Section title="Plan Features">
            {[
              { plan: 'Starter', price: '$99/mo', features: ['Single-line dialing', 'SMS Blast', 'Inbox', '500 contacts'] },
              { plan: 'Pro',     price: '$199/mo', features: ['Triple-line dialing', 'VM Blast', 'AI Script', 'Email sequences', '2,500 contacts'], badge: 'Most Popular' },
              { plan: 'Elite',   price: '$399/mo', features: ['Everything in Pro', 'AI Next-Action', 'AI transcription', 'Unlimited contacts'] },
            ].map(p => (
              <div key={p.plan} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 0', borderBottom: '1px solid #f5f5f5' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 4 }}>
                    {p.plan} {p.badge && <span style={{ fontSize: 9, background: '#C9A84C', color: '#fff', padding: '1px 6px', borderRadius: 8, marginLeft: 6 }}>{p.badge}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{p.features.join(' · ')}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', flexShrink: 0 }}>{p.price}</span>
              </div>
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

// ── Reusable sub-components ───────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, padding: '20px 22px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#374151', marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
      <label style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9ca3af' }}>{label}</label>
      {children}
    </div>
  );
}

const inputSt: React.CSSProperties = {
  padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 6,
  fontSize: 13, color: '#1a1a1a', background: '#fff', outline: 'none',
};

const btnPrimary: React.CSSProperties = {
  background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 6,
  padding: '9px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', cursor: 'pointer',
};

const btnOutline: React.CSSProperties = {
  background: 'transparent', color: '#374151', border: '1px solid #e5e7eb',
  borderRadius: 6, padding: '8px 14px', fontSize: 11, fontWeight: 600,
  letterSpacing: '0.05em', cursor: 'pointer',
};
