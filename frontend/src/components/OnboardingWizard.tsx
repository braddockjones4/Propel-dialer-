/**
 * OnboardingWizard — shown after signup when onboardingStep < 5.
 *
 * Steps:
 *   0 → shown wizard, starting at step 1
 *   1 → Profile (name, agentName)
 *   2 → Twilio credentials
 *   3 → Voicemail greeting (skip allowed)
 *   4 → Import contacts (skip allowed)
 *   5 → Done — wizard dismissed forever
 */
import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, authFetch } from '../config';

interface Props {
  onComplete: () => void;
}

const STEPS = [
  { n: 1, title: 'Your Profile',       subtitle: 'Set your name and how you appear to contacts.' },
  { n: 2, title: 'Twilio Setup',       subtitle: 'Connect your Twilio account to make calls and send texts.' },
  { n: 3, title: 'Voicemail Greeting', subtitle: 'Record or upload a voicemail greeting for missed calls.' },
  { n: 4, title: 'Import Contacts',    subtitle: 'Upload a CSV to get your contact list started.' },
  { n: 5, title: "You're ready!",      subtitle: 'Propel Dialer is set up and ready to go.' },
];

export default function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1 — profile
  const [profileName,  setProfileName]  = useState('');
  const [agentName,    setAgentName]    = useState('');

  // Step 2 — Twilio
  const [acctSid,    setAcctSid]    = useState('');
  const [authToken,  setAuthToken]  = useState('');
  const [apiKey,     setApiKey]     = useState('');
  const [apiSecret,  setApiSecret]  = useState('');
  const [twimlSid,   setTwimlSid]   = useState('');
  const [callerId,   setCallerId]   = useState('');

  // Step 3 — voicemail
  const [vmFile, setVmFile] = useState<File | null>(null);

  // Step 4 — contacts
  const [csvFile,  setCsvFile]  = useState<File | null>(null);
  const [imported, setImported] = useState(0);

  const fileInput = useRef<HTMLInputElement>(null);
  const csvInput  = useRef<HTMLInputElement>(null);

  // Load current profile
  useEffect(() => {
    authFetch(`${API_BASE}/auth/me`).then(r => r.json()).then(d => {
      setProfileName(d.name || '');
      setAgentName(d.agentName || '');
    }).catch(() => {});
  }, []);

  const advanceStep = async (nextStep: number) => {
    setSaving(true); setError('');
    try {
      await authFetch(`${API_BASE}/dialer/onboarding-step`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: nextStep }),
      });
      setStep(nextStep);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Step handlers ────────────────────────────────────────────────────────────
  const handleProfile = async () => {
    setSaving(true); setError('');
    try {
      const body: any = {};
      if (profileName) body.name = profileName;
      if (body.name) {
        await authFetch(`${API_BASE}/auth/me`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      if (agentName) {
        await authFetch(`${API_BASE}/agent/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentName }),
        });
      }
      await advanceStep(2);
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  };

  const handleTwilio = async () => {
    if (!acctSid || !authToken) { setError('Account SID and Auth Token are required.'); return; }
    setSaving(true); setError('');
    try {
      const r = await authFetch(`${API_BASE}/dialer/twilio-credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twilioAccountSid: acctSid, twilioAuthToken: authToken, twilioApiKey: apiKey, twilioApiSecret: apiSecret, twilioTwimlAppSid: twimlSid, twilioCallerId: callerId }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Could not save credentials'); setSaving(false); return; }
      await advanceStep(3);
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  };

  const handleVoicemail = async (skip = false) => {
    if (!skip && vmFile) {
      setSaving(true); setError('');
      try {
        const fd = new FormData();
        fd.append('file', vmFile);
        const r = await authFetch(`${API_BASE}/dialer/voicemail-greeting`, { method: 'POST', body: fd });
        if (!r.ok) { const d = await r.json(); setError(d.error || 'Upload failed'); setSaving(false); return; }
      } catch (e: any) {
        setError(e.message);
        setSaving(false);
        return;
      }
    }
    await advanceStep(4);
  };

  const handleContacts = async (skip = false) => {
    if (!skip && csvFile) {
      setSaving(true); setError('');
      try {
        const fd = new FormData();
        fd.append('file', csvFile);
        const r = await authFetch(`${API_BASE}/contacts/import`, { method: 'POST', body: fd });
        const d = await r.json();
        if (!r.ok) { setError(d.error || 'Import failed'); setSaving(false); return; }
        setImported(d.count || 0);
      } catch (e: any) {
        setError(e.message);
        setSaving(false);
        return;
      }
    }
    await advanceStep(5);
  };

  const currentStep = STEPS[step - 1] || STEPS[4];
  const progress = Math.min((step / 5) * 100, 100);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ background: '#1a1a1a', padding: '24px 28px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 20, fontWeight: 300, letterSpacing: '0.2em', color: '#fff', marginBottom: 4 }}>
                PROPEL DIALER
              </div>
              <div style={{ fontSize: 11, color: '#C9A84C', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Setup Wizard · Step {step} of 5
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, color: '#9ca3af' }}>
              {Math.round(progress)}% complete
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ marginTop: 16, height: 3, background: '#374151', borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#C9A84C', borderRadius: 2, transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {/* Step nav dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: '14px 28px 0' }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{
              width: i + 1 < step ? 24 : 8, height: 8, borderRadius: 4,
              background: i + 1 < step ? '#C9A84C' : i + 1 === step ? '#1a1a1a' : '#e5e7eb',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 28px 28px' }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' }}>{currentStep.title}</h2>
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>{currentStep.subtitle}</p>
          </div>

          {/* ── Step 1: Profile ──────────────────────────────────────────────── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <WLabel label="Your Full Name">
                <input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Jane Smith" style={iSt} />
              </WLabel>
              <WLabel label="Agent Display Name (used in SMS & voicemail)">
                <input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="Jane from Realty Co." style={iSt} />
              </WLabel>
              {error && <ErrBox msg={error} />}
              <Btn label="Continue →" onClick={handleProfile} loading={saving} />
            </div>
          )}

          {/* ── Step 2: Twilio ───────────────────────────────────────────────── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 4px', lineHeight: 1.6 }}>
                Find these at <a href="https://console.twilio.com" target="_blank" rel="noreferrer" style={{ color: '#C9A84C' }}>console.twilio.com</a>. You'll need an Account SID, Auth Token, API Key, and a TwiML App.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <WLabel label="Account SID *">
                  <input value={acctSid} onChange={e => setAcctSid(e.target.value)} placeholder="ACxxxx..." style={iSt} />
                </WLabel>
                <WLabel label="Auth Token *">
                  <input type="password" value={authToken} onChange={e => setAuthToken(e.target.value)} placeholder="Your auth token" style={iSt} />
                </WLabel>
                <WLabel label="API Key SID">
                  <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="SKxxxx..." style={iSt} />
                </WLabel>
                <WLabel label="API Secret">
                  <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder="API secret" style={iSt} />
                </WLabel>
                <WLabel label="TwiML App SID">
                  <input value={twimlSid} onChange={e => setTwimlSid(e.target.value)} placeholder="APxxxx..." style={iSt} />
                </WLabel>
                <WLabel label="Caller ID (phone number)">
                  <input value={callerId} onChange={e => setCallerId(e.target.value)} placeholder="+14435551234" style={iSt} />
                </WLabel>
              </div>
              {error && <ErrBox msg={error} />}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <SkipBtn onClick={() => advanceStep(3)} loading={saving} />
                <Btn label="Validate & Save →" onClick={handleTwilio} loading={saving} />
              </div>
            </div>
          )}

          {/* ── Step 3: Voicemail ────────────────────────────────────────────── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6, margin: 0 }}>
                Upload an MP3 or WAV file for your voicemail drop. You can always change this in Settings later.
              </p>
              <input ref={fileInput} type="file" accept=".mp3,.wav,.m4a" style={{ display: 'none' }}
                onChange={e => setVmFile(e.target.files?.[0] || null)} />
              <div
                onClick={() => fileInput.current?.click()}
                style={{
                  border: '2px dashed #e5e7eb', borderRadius: 10, padding: '24px 16px', textAlign: 'center',
                  cursor: 'pointer', transition: 'border-color 0.2s',
                  borderColor: vmFile ? '#C9A84C' : '#e5e7eb',
                }}
              >
                {vmFile
                  ? <><div style={{ fontSize: 24, marginBottom: 6 }}>🎙️</div><div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{vmFile.name}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>Click to change</div></>
                  : <><div style={{ fontSize: 24, marginBottom: 6 }}>📂</div><div style={{ fontSize: 13, color: '#6b7280' }}>Click to upload MP3 or WAV</div></>}
              </div>
              {error && <ErrBox msg={error} />}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <SkipBtn onClick={() => handleVoicemail(true)} loading={saving} />
                <Btn label={vmFile ? 'Upload & Continue →' : 'Continue →'} onClick={() => handleVoicemail(!vmFile)} loading={saving} />
              </div>
            </div>
          )}

          {/* ── Step 4: Contacts ─────────────────────────────────────────────── */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6, margin: 0 }}>
                Import a CSV with columns like <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>firstName, lastName, phone, email, address</code>. You can import more contacts anytime.
              </p>
              <input ref={csvInput} type="file" accept=".csv" style={{ display: 'none' }}
                onChange={e => setCsvFile(e.target.files?.[0] || null)} />
              <div
                onClick={() => csvInput.current?.click()}
                style={{
                  border: '2px dashed #e5e7eb', borderRadius: 10, padding: '24px 16px', textAlign: 'center',
                  cursor: 'pointer', borderColor: csvFile ? '#C9A84C' : '#e5e7eb',
                }}
              >
                {csvFile
                  ? <><div style={{ fontSize: 24, marginBottom: 6 }}>📋</div><div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{csvFile.name}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>Click to change</div></>
                  : <><div style={{ fontSize: 24, marginBottom: 6 }}>📂</div><div style={{ fontSize: 13, color: '#6b7280' }}>Click to upload CSV</div></>}
              </div>
              {imported > 0 && <div style={{ fontSize: 12, color: '#22c55e', textAlign: 'center' }}>✅ {imported} contacts imported!</div>}
              {error && <ErrBox msg={error} />}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <SkipBtn onClick={() => handleContacts(true)} loading={saving} />
                <Btn label={csvFile ? 'Import & Finish →' : 'Continue →'} onClick={() => handleContacts(!csvFile)} loading={saving} />
              </div>
            </div>
          )}

          {/* ── Step 5: Done ─────────────────────────────────────────────────── */}
          {step === 5 && (
            <div style={{ textAlign: 'center', padding: '10px 0 6px' }}>
              <div style={{ fontSize: 48, marginBottom: 14 }}>🎉</div>
              <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, marginBottom: 24 }}>
                Your dialer is ready. Head to the <strong>Dialer</strong> tab to start your first session, or import contacts to build your pipeline.
              </p>
              <button onClick={onComplete} style={{ ...bSt, background: '#C9A84C', color: '#fff', fontSize: 13, padding: '12px 28px' }}>
                Open Propel Dialer →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tiny helpers ─────────────────────────────────────────────────────────────
function WLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#9ca3af' }}>{label}</label>
      {children}
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12, color: '#dc2626' }}>
      ⚠️ {msg}
    </div>
  );
}

function Btn({ label, onClick, loading }: { label: string; onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} style={{ ...bSt, background: '#1a1a1a', color: '#fff' }}>
      {loading ? 'Please wait…' : label}
    </button>
  );
}

function SkipBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button onClick={onClick} disabled={loading} style={{ ...bSt, background: 'transparent', color: '#9ca3af', border: '1px solid #e5e7eb' }}>
      Skip
    </button>
  );
}

const iSt: React.CSSProperties = {
  padding: '8px 11px', border: '1px solid #e5e7eb', borderRadius: 6,
  fontSize: 12, color: '#1a1a1a', background: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box',
};

const bSt: React.CSSProperties = {
  padding: '9px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
  textTransform: 'uppercase', cursor: 'pointer', border: 'none', borderRadius: 6,
};
