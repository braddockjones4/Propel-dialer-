// ── Settings ──────────────────────────────────────────────────────────────────
// Deliberately minimal: a single Account page.
//
// Removed on purpose — do not re-add without a reason:
//   Phone Numbers — purchased Twilio numbers, billing the deployment's Twilio
//                   account. Telephony is app-owned and invisible to clients.
//   Integrations  — OpenAI/Stripe API key status; developer info a realtor
//                   cannot act on.
//   Billing/Team  — handled directly by Compass Solutions per client.
//
// Call mode, personal phone, and the voicemail greeting live on the Dialer
// setup screen, where they're used.
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { API_BASE, authFetch } from '../config';

export default function Settings() {
  const { user, token, refresh } = useAuth();
  const toast = useToast();

  const [name,       setName]       = useState(user?.name || '');
  const [agentName,  setAgentName]  = useState('');
  const [password,   setPassword]   = useState('');
  const [savingAcct, setSavingAcct] = useState(false);

  useEffect(() => {
    authFetch(`${API_BASE}/agent/settings`)
      .then(r => r.ok ? r.json() : {})
      .then((d: any) => setAgentName(d?.agentName || ''))
      .catch(() => {});
  }, []);

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
        const d = await r.json().catch(() => ({}));
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
    if (hasProfileChanges || agentName) toast.success('Account updated');
    else toast.info('Nothing changed');
  };

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 24px)' }}>
      <h1 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 24, fontWeight: 300, letterSpacing: '0.15em', marginBottom: 6, color: '#C9A84C' }}>
        SETTINGS
      </h1>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 28 }}>
        Your profile and sign-in details.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Section title="Profile">
          <Field label="Full Name">
            <input value={name} onChange={e => setName(e.target.value)} style={inputSt} />
          </Field>
          <Field label="Agent Name">
            <input
              value={agentName}
              onChange={e => setAgentName(e.target.value)}
              placeholder="Name announced on calls and voicemails"
              style={inputSt}
            />
          </Field>
          <Field label="Email">
            <input value={user?.email || ''} disabled style={{ ...inputSt, color: '#9ca3af', background: '#f9fafb' }} />
          </Field>
          <Field label="New Password">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              style={inputSt}
            />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={saveAccount} disabled={savingAcct} style={btnPrimary}>
              {savingAcct ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </Section>

        <Section title="Calling Setup">
          <p style={{ fontSize: 12.5, color: '#6b7280', lineHeight: 1.6, margin: 0 }}>
            Your phone number, call mode, and voicemail greeting are on the{' '}
            <strong style={{ color: '#111' }}>Dialer</strong> tab under Setup.
          </p>
        </Section>

        <div style={{ fontSize: 11.5, color: '#9ca3af', textAlign: 'center', lineHeight: 1.7 }}>
          Propel Dialer · managed by Compass Solutions<br />
          Contact your account manager for billing or support.
        </div>
      </div>
    </div>
  );
}

// ── Reusable sub-components ───────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #f0f0f0', borderRadius: 10, padding: '20px 22px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#374151', marginBottom: 16 }}>
        {title}
      </div>
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
