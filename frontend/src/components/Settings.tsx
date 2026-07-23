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

type Tab = 'account' | 'twilio' | 'numbers' | 'integrations' | 'billing' | 'team';

const TAB_LABELS: { id: Tab; label: string; icon: string }[] = [
  { id: 'account',      label: 'Account',      icon: '' },
  { id: 'twilio',       label: 'Twilio Setup',  icon: '' },
  { id: 'numbers',      label: 'Phone Numbers', icon: '' },
  { id: 'integrations', label: 'Integrations',  icon: '' },
  { id: 'billing',      label: 'Billing',       icon: '' },
  { id: 'team',         label: 'Team',          icon: '' },
];

export default function Settings() {
  const { user, token, refresh } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('account');

  // ── Account fields ──────────────────────────────────────────────────────────
  const [name,        setName]        = useState(user?.name || '');
  const [agentName,   setAgentName]   = useState('');
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

  // ── Twilio credentials ──────────────────────────────────────────────────────
  const [twilioFields, setTwilioFields] = useState({
    twilioAccountSid: '', twilioAuthToken: '', twilioApiKey: '',
    twilioApiSecret: '', twilioTwimlAppSid: '', twilioCallerId: '',
    agentNameTwilio: '',
  });
  const [twilioStatus, setTwilioStatus] = useState<any>(null);
  const [savingTwilio, setSavingTwilio] = useState(false);
  const [twilioError, setTwilioError]   = useState('');

  // ── Integration status ──────────────────────────────────────────────────────
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [ngrok,  setNgrok]  = useState('');
  const [savingNgrok, setSavingNgrok] = useState(false);

  useEffect(() => {
    authFetch(`${API_BASE}/local-presence`).then(r => r.json()).then(setNumbers).catch(() => {});
    authFetch(`${API_BASE}/settings/status`).then(r => r.json()).then(setStatus).catch(() => {});
    authFetch(`${API_BASE}/settings/ngrok`).then(r => r.json()).then(d => setNgrok(d.ngrokUrl || '')).catch(() => {});
    authFetch(`${API_BASE}/agent/settings`).then(r => r.json()).then(d => setAgentName(d.agentName || '')).catch(() => {});
    authFetch(`${API_BASE}/dialer/twilio-credentials`).then(r => r.json()).then(d => {
      setTwilioStatus(d);
      setTwilioFields(f => ({ ...f, agentNameTwilio: d.agentName || '', twilioCallerId: d.twilioCallerId || '', twilioTwimlAppSid: d.twilioTwimlAppSid || '' }));
    }).catch(() => {});
  }, []);

  // ── Account save ────────────────────────────────────────────────────────────
  const saveAccount = async () => {
    if (!token) return;
    setSavingAcct(true);
    const body: any = {};
    if (name !== user?.name) body.name = name;
    if (password) body.password = password;
    const hasProfileChanges = Object.keys(body).length > 0;
    if (hasProfileChanges) {
      const r = await authFetch(`${API_BASE}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json();
        setSavingAcct(false);
        toast.error(d.error || 'Update failed');
        return;
      }
      setPassword('');
      refresh();
    }
    if (agentName) {
      await authFetch(`${API_BASE}/agent/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ agentName }),
      });
    }
    setSavingAcct(false);
    if (hasProfileChanges || agentName) { toast.success('Account updated'); }
    else { toast.info('Nothing changed'); }
  };

  // ── Save Twilio credentials ─────────────────────────────────────────────────
  const saveTwilio = async () => {
    setSavingTwilio(true);
    setTwilioError('');
    try {
      const body: any = {};
      if (twilioFields.twilioAccountSid)  body.twilioAccountSid  = twilioFields.twilioAccountSid;
      if (twilioFields.twilioAuthToken)   body.twilioAuthToken   = twilioFields.twilioAuthToken;
      if (twilioFields.twilioApiKey)      body.twilioApiKey      = twilioFields.twilioApiKey;
      if (twilioFields.twilioApiSecret)   body.twilioApiSecret   = twilioFields.twilioApiSecret;
      if (twilioFields.twilioTwimlAppSid) body.twilioTwimlAppSid = twilioFields.twilioTwimlAppSid;
      if (twilioFields.twilioCallerId)    body.twilioCallerId    = twilioFields.twilioCallerId;
      if (twilioFields.agentNameTwilio)   body.agentName         = twilioFields.agentNameTwilio;
      const r = await authFetch(`${API_BASE}/dialer/twilio-credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setTwilioError(d.error || 'Save failed'); return; }
      toast.success('Twilio credentials saved!');
      // Refresh masked status
      authFetch(`${API_BASE}/dialer/twilio-credentials`).then(r2 => r2.json()).then(setTwilioStatus).catch(() => {});
      setTwilioFields(f => ({ ...f, twilioAccountSid: '', twilioAuthToken: '', twilioApiKey: '', twilioApiSecret: '' }));
    } catch (e: any) {
      setTwilioError(e.message || 'Unknown error');
    } finally {
      setSavingTwilio(false);
    }
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
    const digits = addNumber.replace(/\D/g, '');
    const areaCode = digits.length === 11 && digits[0] === '1' ? digits.substring(1, 4) : digits.substring(0, 3);
    if (!areaCode || areaCode.length !== 3) { setBuyError('Could not determine area code from number'); return; }
    setBuying(true);
    const r = await authFetch(`${API_BASE}/local-presence/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: addNumber, areaCode, label: buyLabel }),
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

  const INTEGRATION_LABELS: Record<string, { label: string; doc: string; envKey: string; desc: string }> = {
    twilio:   { label: 'Twilio',  doc: 'console.twilio.com',              envKey: 'TWILIO_ACCOUNT_SID', desc: 'Powers outbound calling & voicemail drops' },
    openai:   { label: 'OpenAI',  doc: 'platform.openai.com/api-keys',    envKey: 'OPENAI_API_KEY',     desc: 'AI agent & call transcription' },
    stripe:   { label: 'Stripe',  doc: 'dashboard.stripe.com/apikeys',    envKey: 'STRIPE_SECRET_KEY',  desc: 'Subscription billing' },
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 24px)' }}>
      <h1 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 24, fontWeight: 300, letterSpacing: '0.15em', marginBottom: 24, color: '#C9A84C' }}>
        SETTINGS
      </h1>

      {/* Tab bar — pill style, scrollable on mobile */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 28, overflowX: 'auto', WebkitOverflowScrolling: 'touch', flexWrap: 'wrap' }}
           className="hide-scrollbar">
        {TAB_LABELS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              padding: '7px 16px', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0,
              borderRadius: 20, border: 'none', cursor: 'pointer',
              transition: 'all 0.18s', whiteSpace: 'nowrap',
              background: tab === id ? '#C9A84C' : '#f0f0f0',
              color: tab === id ? '#fff' : '#374151',
              boxShadow: tab === id ? '0 2px 8px rgba(201,168,76,0.35)' : 'none',
            }}
          >
            {label}
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
            <Field label="Agent Name">
              <input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="Name announced on calls and voicemails" style={inputSt} />
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

      {/* ── TWILIO SETUP TAB ─────────────────────────────────────────────────── */}
      {tab === 'twilio' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Current status banner */}
          {twilioStatus && (
            <div style={{ padding: '12px 16px', borderRadius: 8, border: `1px solid ${twilioStatus.hasCreds ? '#bbf7d0' : '#fde68a'}`, background: twilioStatus.hasCreds ? '#f0fdf4' : '#fffbeb', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>{twilioStatus.hasCreds ? '✅' : '⚠️'}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: twilioStatus.hasCreds ? '#166534' : '#92400e' }}>
                  {twilioStatus.hasCreds ? 'Twilio credentials configured' : 'No Twilio credentials — using deployment defaults'}
                </div>
                {twilioStatus.hasCreds && (
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    Account: {twilioStatus.twilioAccountSid} · Auth: {twilioStatus.twilioAuthToken}
                    {twilioStatus.twilioCallerId && ` · Caller ID: ${twilioStatus.twilioCallerId}`}
                  </div>
                )}
              </div>
            </div>
          )}

          <Section title="Twilio Account Credentials">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 14, lineHeight: 1.6 }}>
              Enter your Twilio credentials below. These are validated against the Twilio API before saving.
              Twilio powers your outbound calls and voicemail drops. Find your credentials at <a href="https://console.twilio.com" target="_blank" rel="noreferrer" style={{ color: '#C9A84C' }}>console.twilio.com</a>.
            </p>
            <Field label="Account SID">
              <input
                value={twilioFields.twilioAccountSid}
                onChange={e => setTwilioFields(f => ({ ...f, twilioAccountSid: e.target.value }))}
                placeholder={twilioStatus?.twilioAccountSid || 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                style={inputSt}
              />
            </Field>
            <Field label="Auth Token">
              <input
                type="password"
                value={twilioFields.twilioAuthToken}
                onChange={e => setTwilioFields(f => ({ ...f, twilioAuthToken: e.target.value }))}
                placeholder={twilioStatus?.hasCreds ? '••••••••••••••••' : 'Your auth token'}
                style={inputSt}
              />
            </Field>
          </Section>

          <Section title="API Key (for Browser Calls)">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 14, lineHeight: 1.6 }}>
              Create an API Key at <a href="https://console.twilio.com/us1/account/keys-credentials/api-keys" target="_blank" rel="noreferrer" style={{ color: '#C9A84C' }}>Twilio Console → API Keys</a>.
            </p>
            <Field label="API Key SID">
              <input
                value={twilioFields.twilioApiKey}
                onChange={e => setTwilioFields(f => ({ ...f, twilioApiKey: e.target.value }))}
                placeholder={twilioStatus?.twilioApiKey || 'SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                style={inputSt}
              />
            </Field>
            <Field label="API Secret">
              <input
                type="password"
                value={twilioFields.twilioApiSecret}
                onChange={e => setTwilioFields(f => ({ ...f, twilioApiSecret: e.target.value }))}
                placeholder="API key secret"
                style={inputSt}
              />
            </Field>
          </Section>

          <Section title="TwiML App & Caller ID">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 14, lineHeight: 1.6 }}>
              Create a TwiML App at <a href="https://console.twilio.com/us1/develop/voice/manage/twiml-apps" target="_blank" rel="noreferrer" style={{ color: '#C9A84C' }}>Twilio Console → TwiML Apps</a> and set its Voice Request URL to your backend <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>/api/twilio/voice</code>.
            </p>
            <Field label="TwiML App SID">
              <input
                value={twilioFields.twilioTwimlAppSid}
                onChange={e => setTwilioFields(f => ({ ...f, twilioTwimlAppSid: e.target.value }))}
                placeholder={twilioStatus?.twilioTwimlAppSid || 'APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                style={inputSt}
              />
            </Field>
            <Field label="Caller ID (your Twilio phone number)">
              <input
                value={twilioFields.twilioCallerId}
                onChange={e => setTwilioFields(f => ({ ...f, twilioCallerId: e.target.value }))}
                placeholder={twilioStatus?.twilioCallerId || '+14435551234'}
                style={inputSt}
              />
            </Field>
            <Field label="Agent Display Name">
              <input
                value={twilioFields.agentNameTwilio}
                onChange={e => setTwilioFields(f => ({ ...f, agentNameTwilio: e.target.value }))}
                placeholder="Your name (announced on calls)"
                style={inputSt}
              />
            </Field>
          </Section>

          {twilioError && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12, color: '#dc2626' }}>
              ⚠️ {twilioError}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={saveTwilio} disabled={savingTwilio} style={btnPrimary}>
              {savingTwilio ? 'Validating & Saving…' : 'Save Twilio Credentials'}
            </button>
          </div>
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
          <Section title="Connected Services">
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
              These services power Propel Dialer. Your Twilio credentials are managed under the <strong>Twilio Setup</strong> tab.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Object.entries(INTEGRATION_LABELS).map(([key, info]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, border: '1px solid #f0f0f0' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: status[key] ? '#22c55e' : '#e5e7eb', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{info.label}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{info.desc}</div>
                  </div>
                  <span style={{ fontSize: 11, color: status[key] ? '#22c55e' : '#9ca3af', fontWeight: 600 }}>
                    {status[key] ? '✓ Active' : '○ Not set'}
                  </span>
                  <a href={`https://${info.doc}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#C9A84C', textDecoration: 'none' }}>
                    Dashboard →
                  </a>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Twilio Voice Webhook">
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10, lineHeight: 1.6 }}>
              In your <a href="https://console.twilio.com/us1/develop/voice/manage/twiml-apps" target="_blank" rel="noreferrer" style={{ color: '#C9A84C' }}>Twilio TwiML App</a>, set the Voice Request URL to:
            </div>
            <div style={{ fontFamily: 'monospace', background: '#f9fafb', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#374151', wordBreak: 'break-all' }}>
              {API_BASE.replace(/\/api$/, '')}/api/twilio/voice
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
            <div>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#1a1a1a', marginBottom: 4 }}>
                Propel Dialer
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>
                Managed by Compass Solutions · contact your account manager for billing questions
              </div>
            </div>
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
