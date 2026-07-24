/**
 * OnboardingWizard — shown after signup when onboardingStep < 4.
 *
 * Steps:
 *   1 → Profile (name, agentName)
 *   2 → Your Phone Number (personal cell — Twilio will call this for bridge mode)
 *   3 → Voicemail Greeting (skip allowed)
 *   4 → Import Contacts — iCloud or Gmail (skip allowed)
 *   5 → Done
 */
import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, authFetch } from '../config';

interface Props { onComplete: () => void; }

const STEPS = [
  { n: 1, title: 'Your Profile',       subtitle: 'Set your name and how you appear to contacts.' },
  { n: 2, title: 'Your Phone Number',  subtitle: 'The system will call this number when you start a dialing session.' },
  { n: 3, title: 'Voicemail Greeting', subtitle: 'Upload a voicemail drop for missed calls.' },
  { n: 4, title: 'Import Contacts',    subtitle: 'Sync contacts from iCloud or Gmail.' },
  { n: 5, title: "You're ready!",      subtitle: 'Propel Dialer is set up and ready to go.' },
];

export default function OnboardingWizard({ onComplete }: Props) {
  const [step,   setStep]   = useState(1);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  // Step 1
  const [profileName, setProfileName] = useState('');
  const [agentName,   setAgentName]   = useState('');

  // Step 2
  const [phone, setPhone] = useState('');

  // Step 3
  const [vmFile, setVmFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Step 4 — iCloud
  const [icloudEmail,  setIcloudEmail]  = useState('');
  const [icloudPwd,    setIcloudPwd]    = useState('');
  const [icloudStatus, setIcloudStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [icloudCount,  setIcloudCount]  = useState(0);
  const [icloudErr,    setIcloudErr]    = useState('');

  // Step 4 — Gmail
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailStatus,    setGmailStatus]    = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [gmailCount,     setGmailCount]     = useState(0);

  useEffect(() => {
    authFetch(`${API_BASE}/auth/me`).then(r => r.json()).then((d: any) => {
      setProfileName(d.name || '');
    }).catch(() => {});
    authFetch(`${API_BASE}/auth/gmail-status`).then(r => r.json()).then((d: any) => {
      setGmailConnected(!!d.connected);
    }).catch(() => {});
  }, []);

  const advanceStep = async (nextStep: number) => {
    setSaving(true); setError('');
    try {
      await authFetch(`${API_BASE}/dialer/onboarding-step`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: nextStep }),
      });
      setStep(nextStep);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  // ── Step handlers ─────────────────────────────────────────────────────────
  const handleProfile = async () => {
    setSaving(true); setError('');
    try {
      if (profileName) {
        await authFetch(`${API_BASE}/auth/me`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: profileName }),
        });
      }
      if (agentName) {
        await authFetch(`${API_BASE}/agent/settings`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentName }),
        });
      }
      await advanceStep(2);
    } catch (e: any) { setError(e.message); setSaving(false); }
  };

  const handlePhone = async (skip = false) => {
    if (!skip && !phone.trim()) { setError('Enter your phone number to continue.'); return; }
    setSaving(true); setError('');
    try {
      if (!skip && phone.trim()) {
        const digits = phone.replace(/\D/g, '');
        const e164 = digits.startsWith('1') ? `+${digits}` : `+1${digits}`;
        await authFetch(`${API_BASE}/dialer/settings`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personalPhone: e164, callMode: 'bridge' }),
        });
      }
      await advanceStep(3);
    } catch (e: any) { setError(e.message); setSaving(false); }
  };

  const handleVoicemail = async (skip = false) => {
    if (!skip && vmFile) {
      setSaving(true); setError('');
      try {
        const fd = new FormData(); fd.append('file', vmFile);
        const r = await authFetch(`${API_BASE}/dialer/voicemail-greeting`, { method: 'POST', body: fd });
        if (!r.ok) { const d = await r.json(); setError(d.error || 'Upload failed'); setSaving(false); return; }
      } catch (e: any) { setError(e.message); setSaving(false); return; }
    }
    await advanceStep(4);
  };

  const handleIcloudSync = async () => {
    if (!icloudEmail.trim() || !icloudPwd.trim()) { setIcloudErr('Enter your Apple ID and App-Specific Password.'); return; }
    setIcloudStatus('loading'); setIcloudErr('');
    try {
      const r = await authFetch(`${API_BASE}/contacts/icloud-import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appleId: icloudEmail.trim(), appPassword: icloudPwd.trim(), saveCredentials: true }),
      });
      const d = await r.json();
      if (!r.ok) { setIcloudErr(d.error || 'Import failed'); setIcloudStatus('error'); return; }
      setIcloudCount(d.imported ?? 0);
      setIcloudStatus('done');
    } catch { setIcloudErr('Connection failed. Try again.'); setIcloudStatus('error'); }
  };

  const handleGmailSync = async () => {
    setGmailStatus('loading');
    try {
      const r = await authFetch(`${API_BASE}/contacts/google-import`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) { setGmailStatus('error'); return; }
      setGmailCount(d.imported ?? 0);
      setGmailStatus('done');
    } catch { setGmailStatus('error'); }
  };

  const progress = Math.min((step / 5) * 100, 100);
  const currentStep = STEPS[step - 1] || STEPS[4];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 500, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ background: '#1a1a1a', padding: '22px 28px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 19, fontWeight: 300, letterSpacing: '0.2em', color: '#fff', marginBottom: 3 }}>PROPEL DIALER</div>
              <div style={{ fontSize: 10, color: '#C9A84C', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Setup · Step {step} of 5</div>
            </div>
            <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{Math.round(progress)}%</div>
          </div>
          <div style={{ marginTop: 14, height: 3, background: '#374151', borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#C9A84C', borderRadius: 2, transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {/* Step dots */}
        <div style={{ display: 'flex', gap: 5, justifyContent: 'center', padding: '12px 28px 0' }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i + 1 < step ? 22 : 8, height: 7, borderRadius: 4,
              background: i + 1 < step ? '#C9A84C' : i + 1 === step ? '#1a1a1a' : '#e5e7eb',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>

        {/* Body */}
        <div style={{ padding: '18px 28px 26px' }}>
          <div style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a', margin: '0 0 3px' }}>{currentStep.title}</h2>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>{currentStep.subtitle}</p>
          </div>

          {/* ── Step 1: Profile ─────────────────────────────────────────────── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <WLabel label="Your Full Name">
                <input value={profileName} onChange={e => setProfileName(e.target.value)}
                  placeholder="Jane Smith" style={iSt} />
              </WLabel>
              <WLabel label="Agent Display Name (used in voicemail drops & calls)">
                <input value={agentName} onChange={e => setAgentName(e.target.value)}
                  placeholder="Jane from Realty Co." style={iSt} />
              </WLabel>
              {error && <ErrBox msg={error} />}
              <PrimaryBtn label="Continue →" onClick={handleProfile} loading={saving} />
            </div>
          )}

          {/* ── Step 2: Personal Phone ──────────────────────────────────────── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '11px 13px', fontSize: 12, color: '#374151', lineHeight: 1.7 }}>
                When you start a call session, the system will call <strong>your cell phone</strong> first. When you answer, it connects you to the lead — so you're always calling from your own number.
              </div>
              <WLabel label="Your Cell Phone Number">
                <input value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="+1 (443) 555-1234" style={iSt} type="tel" />
              </WLabel>
              {error && <ErrBox msg={error} />}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                <SkipBtn onClick={() => handlePhone(true)} loading={saving} />
                <PrimaryBtn label="Save & Continue →" onClick={() => handlePhone(false)} loading={saving} />
              </div>
            </div>
          )}

          {/* ── Step 3: Voicemail ───────────────────────────────────────────── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <p style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.6, margin: 0 }}>
                Upload an MP3 or WAV — plays automatically when a call goes to voicemail. You can record or change this in Settings later.
              </p>
              <input ref={fileInput} type="file" accept=".mp3,.wav,.m4a" style={{ display: 'none' }}
                onChange={e => setVmFile(e.target.files?.[0] || null)} />
              <div onClick={() => fileInput.current?.click()} style={{
                border: `2px dashed ${vmFile ? '#C9A84C' : '#e5e7eb'}`, borderRadius: 10,
                padding: '22px 16px', textAlign: 'center', cursor: 'pointer',
              }}>
                {vmFile
                  ? <><div style={{ fontSize: 22, marginBottom: 5 }}>🎙️</div><div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{vmFile.name}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>Click to change</div></>
                  : <><div style={{ fontSize: 22, marginBottom: 5 }}>📂</div><div style={{ fontSize: 13, color: '#6b7280' }}>Click to upload MP3 or WAV</div></>}
              </div>
              {error && <ErrBox msg={error} />}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <SkipBtn onClick={() => handleVoicemail(true)} loading={saving} />
                <PrimaryBtn label={vmFile ? 'Upload & Continue →' : 'Skip for now →'} onClick={() => handleVoicemail(!vmFile)} loading={saving} />
              </div>
            </div>
          )}

          {/* ── Step 4: Contacts — iCloud + Gmail only ─────────────────────── */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* iCloud */}
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#f0f7ff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>☁️</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#0071e3' }}>iCloud Contacts</span>
                  {icloudStatus === 'done' && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✓ {icloudCount} imported</span>}
                </div>
                {icloudStatus !== 'done' && (
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input value={icloudEmail} onChange={e => setIcloudEmail(e.target.value)}
                      placeholder="Apple ID email" style={iSt} />
                    <input type="password" value={icloudPwd} onChange={e => setIcloudPwd(e.target.value)}
                      placeholder="App-Specific Password" style={iSt} />
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>
                      Generate at <a href="https://appleid.apple.com" target="_blank" rel="noreferrer" style={{ color: '#C9A84C' }}>appleid.apple.com</a> → Security → App-Specific Passwords
                    </div>
                    {icloudErr && <ErrBox msg={icloudErr} />}
                    <button onClick={handleIcloudSync} disabled={icloudStatus === 'loading'}
                      style={{ ...bSt, background: '#0071e3', color: '#fff', alignSelf: 'flex-start', padding: '7px 14px' }}>
                      {icloudStatus === 'loading' ? 'Syncing…' : 'Sync iCloud →'}
                    </button>
                  </div>
                )}
              </div>

              {/* Gmail */}
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#fff8f0', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>📧</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#ea4335' }}>Gmail Contacts</span>
                  {gmailStatus === 'done' && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#16a34a', fontWeight: 700 }}>✓ {gmailCount} imported</span>}
                </div>
                <div style={{ padding: '12px 14px' }}>
                  {!gmailConnected ? (
                    <a href={`${API_BASE}/auth/gmail`} style={{ ...bSt, background: '#ea4335', color: '#fff', display: 'inline-block', textDecoration: 'none', padding: '7px 14px', fontSize: 11 }}>
                      Connect Gmail →
                    </a>
                  ) : gmailStatus === 'done' ? (
                    <div style={{ fontSize: 12, color: '#16a34a' }}>Gmail synced ✓</div>
                  ) : (
                    <button onClick={handleGmailSync} disabled={gmailStatus === 'loading'}
                      style={{ ...bSt, background: '#ea4335', color: '#fff', padding: '7px 14px' }}>
                      {gmailStatus === 'loading' ? 'Syncing…' : 'Sync Gmail Contacts →'}
                    </button>
                  )}
                  {gmailStatus === 'error' && <ErrBox msg="Sync failed. You can try again from the Contacts page." />}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
                <SkipBtn onClick={() => advanceStep(5)} loading={saving} />
                <PrimaryBtn
                  label={icloudStatus === 'done' || gmailStatus === 'done' ? 'Finish →' : 'Skip for now →'}
                  onClick={() => advanceStep(5)} loading={saving}
                />
              </div>
            </div>
          )}

          {/* ── Step 5: Done ────────────────────────────────────────────────── */}
          {step === 5 && (
            <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🎉</div>
              <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, marginBottom: 22 }}>
                You're all set. When you start a call session, we'll ring your cell first — then connect you to the lead.
              </p>
              <button onClick={onComplete} style={{ ...bSt, background: '#C9A84C', color: '#fff', fontSize: 12, padding: '11px 26px' }}>
                Open Propel Dialer →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function WLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#9ca3af' }}>{label}</label>
      {children}
    </div>
  );
}
function ErrBox({ msg }: { msg: string }) {
  return <div style={{ padding: '7px 11px', borderRadius: 6, background: '#fef2f2', border: '1px solid #fecaca', fontSize: 12, color: '#dc2626' }}>⚠️ {msg}</div>;
}
function PrimaryBtn({ label, onClick, loading }: { label: string; onClick: () => void; loading: boolean }) {
  return <button onClick={onClick} disabled={loading} style={{ ...bSt, background: '#1a1a1a', color: '#fff' }}>{loading ? 'Please wait…' : label}</button>;
}
function SkipBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return <button onClick={onClick} disabled={loading} style={{ ...bSt, background: 'transparent', color: '#9ca3af', border: '1px solid #e5e7eb' }}>Skip</button>;
}
const iSt: React.CSSProperties = {
  padding: '8px 11px', border: '1px solid #e5e7eb', borderRadius: 6,
  fontSize: 12, color: '#1a1a1a', background: '#fff', outline: 'none', width: '100%', boxSizing: 'border-box',
};
const bSt: React.CSSProperties = {
  padding: '9px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', cursor: 'pointer', border: 'none', borderRadius: 6,
};
