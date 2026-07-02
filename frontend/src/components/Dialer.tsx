// ─── Sequential Single-Contact Dialer ────────────────────────────────────────
// Replaces the triple-dial. Goes through a filtered contact list one at a time.
// Two call modes:
//   webrtc  — browser audio via Twilio Device (no extra hardware needed)
//   bridge  — Twilio calls agent's personal cell, then bridges to the contact
//             with AMD + pre-recorded voicemail drop on no-answer
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useTwilioDevice } from '../hooks/useTwilioDevice';
import { API_BASE, SOCKET_URL, authFetch } from '../config';

// ─── Types ────────────────────────────────────────────────────────────────────
interface DialerContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  source: string;
  status: string;
  notes?: string;
  leadScore?: number;
  lastReplyAt?: string;
  updatedAt: string;
  calls?: Array<{ calledAt: string; disposition?: string; duration: number }>;
}

interface DialerSettings {
  callMode: 'webrtc' | 'bridge';
  personalPhone: string;
  phoneVerified: boolean;
  voicemailUrl?: string;
  voicemailSid?: string;
}

type SessionView = 'setup' | 'session' | 'done';
type BridgeStatus = 'idle' | 'ringing-agent' | 'calling-contact' | 'connected' | 'vm-dropped' | 'no-answer' | 'call-ended' | 'ended' | 'error';

// ─── Constants ────────────────────────────────────────────────────────────────
const GOLD = '#C9A84C';
const DARK = '#0A0A0A';

const SOURCE_LABELS: Record<string, string> = {
  expired:       'Expired',
  fsbo:          'FSBO',
  circle:        'Circle',
  'past-client': 'Past Client',
  manual:        'Manual',
};
const SOURCE_COLORS: Record<string, string> = {
  expired:       '#ef4444',
  fsbo:          '#3b82f6',
  circle:        '#8b5cf6',
  'past-client': '#10b981',
  manual:        '#9ca3af',
};

const STATUS_FILTERS = [
  { value: 'all',         label: 'All Contacts' },
  { value: 'new',         label: 'New Leads' },
  { value: 'hot',         label: 'Hot Leads' },
  { value: 'callback',    label: 'Callbacks' },
  { value: 'contacted',   label: 'Previously Contacted' },
  { value: 'past-client', label: 'Past Clients (by source)' },
];

const DISPOSITIONS = [
  { key: 'hot-lead',       label: 'Hot Lead',          color: '#C9A84C' },
  { key: 'appointment',    label: 'Appointment Set',    color: '#8b5cf6' },
  { key: 'callback',       label: 'Callback Scheduled', color: '#3b82f6' },
  { key: 'left-voicemail', label: 'Left Voicemail',     color: '#6b7280' },
  { key: 'no-answer',      label: 'No Answer',          color: '#6b7280' },
  { key: 'not-interested', label: 'Not Interested',     color: '#6b7280' },
  { key: 'wrong-number',   label: 'Wrong Number',       color: '#6b7280' },
  { key: 'dnc',            label: 'DNC',                color: '#ef4444' },
];

function formatPhone(p: string) {
  const d = p.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return p;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Dialer() {
  const {
    deviceStatus, callStatus, callDuration, activeCall,
    startCall, endCall, muteCall, isMuted,
  } = useTwilioDevice();

  // Views & session
  const [view, setView]                 = useState<SessionView>('setup');
  const [contacts, setContacts]         = useState<DialerContact[]>([]);
  const [index, setIndex]               = useState(0);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Settings
  const [settings, setSettings]         = useState<DialerSettings>({ callMode: 'webrtc', personalPhone: '', phoneVerified: false });

  // Phone verification
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'calling' | 'polling' | 'verified' | 'error'>('idle');
  const verifyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Voicemail recording
  const [vmRecordStatus, setVmRecordStatus] = useState<'idle' | 'calling' | 'done'>('idle');

  // Bridge mode
  const [bridgeSessionId, setBridgeSessionId] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('idle');

  // Post-call
  const [disposition, setDisposition]   = useState<string | null>(null);
  const [notes, setNotes]               = useState('');
  const [sessionLog, setSessionLog]     = useState<Array<{ name: string; disp: string; duration: number }>>([]);

  // AI script
  const [aiScript, setAiScript]         = useState<any>(null);
  const [scriptOpen, setScriptOpen]     = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const bridgeIdRef = useRef<string | null>(null);

  // Keep ref in sync so socket handler always sees current sessionId
  useEffect(() => { bridgeIdRef.current = bridgeSessionId; }, [bridgeSessionId]);

  // ─── Socket ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('bridge-status', (data: { sessionId: string; status: string }) => {
      if (!bridgeIdRef.current || data.sessionId === bridgeIdRef.current) {
        setBridgeStatus(data.status as BridgeStatus);
        if (data.status === 'vm-dropped')  setDisposition('left-voicemail');
        if (data.status === 'no-answer')   setDisposition('no-answer');
      }
    });

    socket.on('vm-recorded', () => {
      setVmRecordStatus('done');
      loadSettings();
    });

    return () => { socket.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Load settings ──────────────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    try {
      const r = await authFetch(`${API_BASE}/dialer/settings`);
      if (r.ok) {
        const s = await r.json();
        setSettings(s);
        if (s.phoneVerified) setVerifyStatus('verified');
      }
    } catch {}
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // ─── Load contacts ──────────────────────────────────────────────────────────
  const loadContacts = useCallback(async (filter: string) => {
    setLoadingContacts(true);
    try {
      let statusParam = filter;
      if (filter === 'past-client') statusParam = 'all';
      const r = await authFetch(
        `${API_BASE}/dialer/contacts?status=${statusParam === 'all' ? 'all' : statusParam}&limit=200`
      );
      let data: DialerContact[] = await r.json();
      if (!Array.isArray(data)) data = [];

      if (filter === 'past-client') {
        data = data.filter(c => c.source === 'past-client');
      }

      // Pin Braddock Jones first for demo
      const pinned = data.find(c =>
        c.firstName?.toLowerCase().includes('braddock') ||
        `${c.firstName} ${c.lastName}`.toLowerCase().includes('braddock jones')
      );
      const rest = data.filter(c => c !== pinned);
      setContacts(pinned ? [pinned, ...rest] : data);
    } catch {}
    setLoadingContacts(false);
  }, []);

  // ─── Load AI script when contact changes ────────────────────────────────────
  useEffect(() => {
    const contact = contacts[index];
    if (!contact || view !== 'session') return;
    setAiScript(null);
    setScriptOpen(false);
    authFetch(`${API_BASE}/ai-script/${contact.id}`)
      .then(r => r.json())
      .then(d => setAiScript(d))
      .catch(() => {});
  }, [index, contacts, view]);

  // ─── Save settings ──────────────────────────────────────────────────────────
  const saveSettings = useCallback(async (patch: Partial<DialerSettings>) => {
    setSettings(s => ({ ...s, ...patch }));
    try {
      await authFetch(`${API_BASE}/dialer/settings`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
    } catch {}
  }, []);

  // ─── Phone verification ──────────────────────────────────────────────────────
  const verifyPhone = async () => {
    const phone = settings.personalPhone;
    if (!phone) { alert('Enter your personal phone number first.'); return; }
    setVerifyStatus('calling');
    try {
      const r = await authFetch(`${API_BASE}/dialer/verify-phone`, {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      const d = await r.json();
      if (d.error) { setVerifyStatus('error'); alert(d.error); return; }
      if (d.status === 'already-verified') {
        setSettings(s => ({ ...s, phoneVerified: true }));
        setVerifyStatus('verified');
        return;
      }
      // Twilio is calling — poll for completion
      setVerifyStatus('polling');
      if (verifyPollRef.current) clearInterval(verifyPollRef.current);
      verifyPollRef.current = setInterval(async () => {
        try {
          const pr = await authFetch(`${API_BASE}/dialer/verify-status`);
          const pd = await pr.json();
          if (pd.verified) {
            clearInterval(verifyPollRef.current!);
            verifyPollRef.current = null;
            setSettings(s => ({ ...s, phoneVerified: true }));
            setVerifyStatus('verified');
          }
        } catch {}
      }, 4000);
      // Stop polling after 3 minutes
      setTimeout(() => {
        if (verifyPollRef.current) { clearInterval(verifyPollRef.current); verifyPollRef.current = null; }
        setVerifyStatus(v => v === 'polling' ? 'idle' : v);
      }, 180_000);
    } catch (e: any) {
      setVerifyStatus('error');
      alert('Verification failed: ' + e.message);
    }
  };

  // Reset verify status when phone number changes
  useEffect(() => {
    setVerifyStatus(settings.phoneVerified ? 'verified' : 'idle');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.personalPhone]);

  // ─── Record voicemail ───────────────────────────────────────────────────────
  const recordVoicemail = async () => {
    const phone = settings.personalPhone;
    if (!phone) { alert('Enter your personal phone number first.'); return; }
    setVmRecordStatus('calling');
    try {
      const r = await authFetch(`${API_BASE}/dialer/record-vm`, {
        method: 'POST',
        body: JSON.stringify({ personalPhone: phone }),
      });
      const d = await r.json();
      if (d.error) { alert(d.error); setVmRecordStatus('idle'); }
    } catch (e: any) {
      alert('Failed to initiate call: ' + e.message);
      setVmRecordStatus('idle');
    }
  };

  // ─── Start session ──────────────────────────────────────────────────────────
  const startSession = async () => {
    await loadContacts(sessionFilter);
    setIndex(0);
    setDisposition(null);
    setNotes('');
    setSessionLog([]);
    setBridgeStatus('idle');
    setBridgeSessionId(null);
    setView('session');
  };

  // ─── Initiate call ──────────────────────────────────────────────────────────
  const initiateCall = useCallback(async () => {
    const contact = contacts[index];
    if (!contact) return;
    setDisposition(null);
    setNotes('');

    if (settings.callMode === 'bridge') {
      setBridgeStatus('ringing-agent');
      try {
        const r = await authFetch(`${API_BASE}/dialer/call`, {
          method: 'POST',
          body: JSON.stringify({ contactId: contact.id, mode: 'bridge' }),
        });
        const data = await r.json();
        if (data.error) { alert(data.error); setBridgeStatus('idle'); return; }
        setBridgeSessionId(data.sessionId);
      } catch (e: any) {
        alert('Call failed: ' + e.message);
        setBridgeStatus('idle');
      }
    } else {
      await startCall(contact.phone);
    }
  }, [contacts, index, settings.callMode, startCall]);

  // ─── End call ───────────────────────────────────────────────────────────────
  const handleEndCall = useCallback(async () => {
    if (settings.callMode === 'bridge' && bridgeSessionId) {
      setBridgeStatus('ended');
      try {
        await authFetch(`${API_BASE}/dialer/bridge-hangup`, {
          method: 'POST',
          body: JSON.stringify({ sessionId: bridgeSessionId }),
        });
      } catch {}
    } else {
      endCall();
    }
  }, [settings.callMode, bridgeSessionId, endCall]);

  // ─── Save + advance ─────────────────────────────────────────────────────────
  const saveAndAdvance = useCallback(async (disp: string) => {
    const contact = contacts[index];
    if (!contact) return;
    const duration = settings.callMode === 'bridge' ? 0 : callDuration;

    setSessionLog(log => [
      { name: `${contact.firstName} ${contact.lastName}`, disp, duration },
      ...log,
    ]);

    try {
      await authFetch(`${API_BASE}/dialer/log-call`, {
        method: 'POST',
        body: JSON.stringify({
          contactId: contact.id,
          disposition: disp,
          notes,
          duration,
          twilioSid: (activeCall as any)?.parameters?.CallSid,
        }),
      });
    } catch {}

    setDisposition(null);
    setNotes('');
    setBridgeStatus('idle');
    setBridgeSessionId(null);

    if (index + 1 >= contacts.length) {
      setView('done');
    } else {
      setIndex(i => i + 1);
    }
  }, [contacts, index, notes, callDuration, activeCall, settings.callMode]);

  // ─── Skip ───────────────────────────────────────────────────────────────────
  const skipContact = () => {
    if (settings.callMode === 'bridge' && bridgeSessionId) {
      authFetch(`${API_BASE}/dialer/bridge-hangup`, {
        method: 'POST',
        body: JSON.stringify({ sessionId: bridgeSessionId }),
      }).catch(() => {});
    } else {
      endCall();
    }
    setBridgeStatus('idle');
    setBridgeSessionId(null);
    setDisposition(null);
    setNotes('');
    if (index + 1 >= contacts.length) setView('done');
    else setIndex(i => i + 1);
  };

  // ─── Derived ─────────────────────────────────────────────────────────────────
  const contact          = contacts[index] ?? null;
  const isWebrtcInCall   = settings.callMode === 'webrtc' && ['in-call','connecting','ringing'].includes(callStatus);
  const isWebrtcDone     = settings.callMode === 'webrtc' && callStatus === 'completed';
  const isBridgeActive   = settings.callMode === 'bridge' && ['ringing-agent','calling-contact','connected'].includes(bridgeStatus);
  const isBridgeDone     = settings.callMode === 'bridge' && ['vm-dropped','no-answer','call-ended','ended'].includes(bridgeStatus);
  const showCallBtn      = !isWebrtcInCall && !isBridgeActive && !isWebrtcDone && !isBridgeDone;
  const showDisposition  = isWebrtcDone || isBridgeDone;

  const bridgeLabel: Record<string, string> = {
    'ringing-agent':    'Calling your phone…',
    'calling-contact':  `Connecting to ${contact?.firstName ?? ''}…`,
    connected:          `Connected — ${contact?.firstName ?? ''}`,
    'vm-dropped':       'Voicemail dropped',
    'no-answer':        'No answer',
    'call-ended':       'Call ended',
    ended:              'Call ended',
    error:              'Call failed',
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SETUP SCREEN
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'setup') {
    return (
      <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px 40px' }}>
        <div style={{ width: '100%', maxWidth: 520 }}>

          {/* Header */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 10, letterSpacing: '0.35em', color: GOLD, textTransform: 'uppercase', marginBottom: 6 }}>
              Propel Dialer
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 300, color: DARK, margin: 0 }}>New Session</h1>
          </div>

          {/* ── Who to call ── */}
          <Card title="Who to call" mb={14}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {STATUS_FILTERS.map(f => (
                <button key={f.value} onClick={() => setSessionFilter(f.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                    borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                    background: sessionFilter === f.value ? DARK : 'transparent',
                    border: `1px solid ${sessionFilter === f.value ? DARK : 'rgba(0,0,0,0.09)'}`,
                    transition: 'all 0.15s',
                  }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: sessionFilter === f.value ? GOLD : '#d1d5db', flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: sessionFilter === f.value ? '#fff' : '#374151', fontWeight: sessionFilter === f.value ? 500 : 400 }}>
                    {f.label}
                  </span>
                </button>
              ))}
            </div>
          </Card>

          {/* ── Call mode ── */}
          <Card title="Call mode" mb={14}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {([
                { mode: 'webrtc', title: 'Browser Audio', sub: 'Use computer mic & speakers' },
                { mode: 'bridge', title: 'Personal Phone', sub: 'Twilio rings your cell first' },
              ] as const).map(opt => (
                <button key={opt.mode} onClick={() => saveSettings({ callMode: opt.mode })}
                  style={{
                    padding: '14px 12px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                    background: settings.callMode === opt.mode ? DARK : 'transparent',
                    border: `1px solid ${settings.callMode === opt.mode ? DARK : 'rgba(0,0,0,0.09)'}`,
                    transition: 'all 0.15s',
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: settings.callMode === opt.mode ? '#fff' : '#111', marginBottom: 3 }}>{opt.title}</div>
                  <div style={{ fontSize: 11, color: settings.callMode === opt.mode ? 'rgba(255,255,255,0.45)' : '#9ca3af' }}>{opt.sub}</div>
                </button>
              ))}
            </div>

            {settings.callMode === 'bridge' && (
              <div style={{ marginTop: 14 }}>
                <label style={{ fontSize: 11, color: '#6b7280', display: 'block', marginBottom: 5 }}>
                  Your personal phone number
                  {verifyStatus === 'verified' && (
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '2px 7px', borderRadius: 99 }}>✓ Verified</span>
                  )}
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="tel" placeholder="+1 (555) 000-0000"
                    value={settings.personalPhone}
                    onChange={e => setSettings(s => ({ ...s, personalPhone: e.target.value, phoneVerified: false }))}
                    onBlur={() => saveSettings({ personalPhone: settings.personalPhone })}
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 8, fontSize: 14, border: `1px solid ${verifyStatus === 'verified' ? '#86efac' : 'rgba(0,0,0,0.14)'}`, outline: 'none', boxSizing: 'border-box' }}
                  />
                  {verifyStatus !== 'verified' && (
                    <button
                      onClick={verifyPhone}
                      disabled={!settings.personalPhone || verifyStatus === 'calling' || verifyStatus === 'polling'}
                      style={{
                        padding: '10px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                        background: verifyStatus === 'polling' ? '#fefce8' : DARK,
                        color: verifyStatus === 'polling' ? '#92400e' : '#fff',
                        border: verifyStatus === 'polling' ? '1px solid #fde68a' : 'none',
                        cursor: (!settings.personalPhone || verifyStatus === 'calling' || verifyStatus === 'polling') ? 'not-allowed' : 'pointer',
                        opacity: (!settings.personalPhone) ? 0.4 : 1,
                        flexShrink: 0,
                      }}>
                      {verifyStatus === 'calling' ? 'Calling…' : verifyStatus === 'polling' ? 'Answer your phone' : 'Verify'}
                    </button>
                  )}
                </div>
                {verifyStatus === 'polling' && (
                  <p style={{ fontSize: 11, color: '#92400e', margin: '8px 0 0', lineHeight: 1.5 }}>
                    Twilio is calling your phone now — answer and follow the prompts to confirm.
                  </p>
                )}
                {verifyStatus === 'error' && (
                  <p style={{ fontSize: 11, color: '#dc2626', margin: '8px 0 0' }}>Verification failed — try again.</p>
                )}
                {verifyStatus !== 'verified' && verifyStatus !== 'polling' && verifyStatus !== 'calling' && verifyStatus !== 'error' && settings.personalPhone && (
                  <p style={{ fontSize: 11, color: '#9ca3af', margin: '6px 0 0' }}>
                    Your number must be verified before calls will show your personal ID.
                  </p>
                )}
              </div>
            )}
          </Card>

          {/* ── Voicemail drop ── */}
          <Card title="Voicemail drop" mb={24}>
            {settings.voicemailUrl ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
                  <span style={{ fontSize: 13, color: '#374151' }}>Voicemail recorded</span>
                </div>
                <audio controls src={settings.voicemailUrl} style={{ width: '100%', height: 36, borderRadius: 6, marginBottom: 10 }} />
                <button onClick={recordVoicemail} disabled={vmRecordStatus === 'calling'}
                  style={{ fontSize: 12, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  {vmRecordStatus === 'calling' ? 'Calling your phone…' : 'Re-record'}
                </button>
              </>
            ) : vmRecordStatus === 'calling' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#fefce8', borderRadius: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: GOLD }} />
                <span style={{ fontSize: 13, color: '#92400e' }}>Pick up — record your message, then press #</span>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 14px', lineHeight: 1.5 }}>
                  Record a short message played automatically when a call hits voicemail.
                  {settings.callMode === 'bridge' && !settings.personalPhone && ' Enter your phone number above first.'}
                </p>
                <button onClick={recordVoicemail}
                  disabled={settings.callMode === 'bridge' && !settings.personalPhone}
                  style={{
                    padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: DARK, color: '#fff', border: 'none', cursor: 'pointer',
                    opacity: (settings.callMode === 'bridge' && !settings.personalPhone) ? 0.4 : 1,
                  }}>
                  Record Voicemail
                </button>
              </>
            )}
          </Card>

          {/* Start */}
          <button onClick={startSession} disabled={loadingContacts}
            style={{
              width: '100%', padding: '16px', borderRadius: 14, fontSize: 16, fontWeight: 600,
              background: `linear-gradient(135deg, ${DARK} 0%, #1a1a1a 100%)`,
              color: '#fff', border: `1px solid rgba(201,168,76,0.3)`,
              cursor: loadingContacts ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            }}>
            {loadingContacts ? 'Loading…' : 'Start Session'}
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DONE SCREEN
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'done') {
    const counts = {
      hot:  sessionLog.filter(l => l.disp === 'hot-lead').length,
      appt: sessionLog.filter(l => l.disp === 'appointment').length,
      vm:   sessionLog.filter(l => l.disp === 'left-voicemail').length,
    };
    return (
      <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 16px' }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: `${GOLD}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: 22 }}>✓</div>
            <h2 style={{ fontSize: 24, fontWeight: 300, color: DARK, margin: '0 0 6px' }}>Session Complete</h2>
            <p style={{ fontSize: 14, color: '#9ca3af', margin: 0 }}>{sessionLog.length} contacts reached</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Hot Leads',    value: counts.hot,  gold: true },
              { label: 'Appointments', value: counts.appt, gold: true },
              { label: 'Voicemails',   value: counts.vm,   gold: false },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', borderRadius: 12, padding: '16px', textAlign: 'center', border: '1px solid rgba(0,0,0,0.07)' }}>
                <div style={{ fontSize: 28, fontWeight: 300, color: s.gold ? GOLD : '#111' }}>{s.value}</div>
                <div style={{ fontSize: 9, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {sessionLog.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.07)', marginBottom: 20 }}>
              {sessionLog.map((l, i) => (
                <div key={i} style={{ padding: '11px 16px', borderBottom: i < sessionLog.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#374151' }}>{l.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, color: DISPOSITIONS.find(d => d.key === l.disp)?.color || '#9ca3af' }}>
                    {DISPOSITIONS.find(d => d.key === l.disp)?.label || l.disp}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button onClick={() => { setView('setup'); setContacts([]); setIndex(0); }}
            style={{ width: '100%', padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 600, background: DARK, color: '#fff', border: 'none', cursor: 'pointer' }}>
            New Session
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ACTIVE SESSION
  // ─────────────────────────────────────────────────────────────────────────────
  if (!contact) return null;

  const lastCall = contact.calls?.[0];
  const pct      = Math.round((index / contacts.length) * 100);

  return (
    <div className="h-[calc(100vh-109px)] md:h-auto md:min-h-screen"
      style={{ background: '#f8f8f8', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Progress bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1, height: 3, background: '#f3f4f6', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: GOLD, borderRadius: 99, transition: 'width 0.4s' }} />
        </div>
        <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>{index + 1} / {contacts.length}</span>
        <button onClick={() => setView('setup')}
          style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>
          End
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 24px' }}>

        {/* Contact card */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '18px', marginBottom: 12, border: '1px solid rgba(0,0,0,0.07)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 6, background: `${SOURCE_COLORS[contact.source] || '#9ca3af'}18`, color: SOURCE_COLORS[contact.source] || '#9ca3af' }}>
              {SOURCE_LABELS[contact.source] || contact.source}
            </span>
            {contact.status !== 'new' && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: '#f3f4f6', color: '#6b7280', textTransform: 'capitalize' }}>
                {contact.status}
              </span>
            )}
            {(contact.leadScore ?? 0) > 70 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: `${GOLD}18`, color: '#9A7A2E' }}>
                Score {contact.leadScore}
              </span>
            )}
          </div>

          <h2 style={{ fontSize: 26, fontWeight: 300, color: DARK, margin: '0 0 3px', letterSpacing: '0.01em' }}>
            {contact.firstName} {contact.lastName}
          </h2>
          <div style={{ fontSize: 15, color: '#6b7280', marginBottom: 10 }}>{formatPhone(contact.phone)}</div>

          {contact.address && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
              {contact.address}{contact.city ? `, ${contact.city}` : ''}{contact.state ? `, ${contact.state}` : ''}
            </div>
          )}

          {lastCall && (
            <div style={{ fontSize: 11, color: '#9ca3af', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 10, marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span>Last: {timeAgo(lastCall.calledAt)}</span>
              {lastCall.disposition && (
                <span>· {DISPOSITIONS.find(d => d.key === lastCall.disposition)?.label || lastCall.disposition}</span>
              )}
            </div>
          )}

          {contact.notes && (
            <div style={{ fontSize: 12, color: '#6b7280', background: '#fafafa', borderRadius: 8, padding: '8px 10px', marginTop: 10, borderLeft: `3px solid ${GOLD}` }}>
              {contact.notes}
            </div>
          )}
        </div>

        {/* Call controls */}
        <div style={{ background: '#fff', borderRadius: 16, padding: '16px', marginBottom: 12, border: '1px solid rgba(0,0,0,0.07)' }}>

          {/* Bridge status pill */}
          {settings.callMode === 'bridge' && bridgeStatus !== 'idle' && !isBridgeDone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 10, marginBottom: 14, background: bridgeStatus === 'connected' ? '#f0fdf4' : '#fefce8' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: bridgeStatus === 'connected' ? '#22c55e' : GOLD, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: bridgeStatus === 'connected' ? '#15803d' : '#92400e' }}>
                {bridgeLabel[bridgeStatus] || ''}
              </span>
            </div>
          )}

          {/* WebRTC in-call status */}
          {settings.callMode === 'webrtc' && isWebrtcInCall && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: '#f0fdf4', borderRadius: 10, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: '#15803d' }}>
                  {callStatus === 'ringing' ? 'Ringing…' : callStatus === 'connecting' ? 'Connecting…'
                    : `${String(Math.floor(callDuration / 60)).padStart(2,'0')}:${String(callDuration % 60).padStart(2,'0')}`}
                </span>
              </div>
              <button onClick={() => muteCall(!isMuted)}
                style={{ fontSize: 11, color: isMuted ? '#ef4444' : '#6b7280', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                {isMuted ? 'Unmute' : 'Mute'}
              </button>
            </div>
          )}

          {/* Call button */}
          {showCallBtn && (
            <button onClick={initiateCall}
              disabled={settings.callMode === 'webrtc' && deviceStatus !== 'ready'}
              style={{
                width: '100%', padding: '15px', borderRadius: 12, fontSize: 16, fontWeight: 600,
                background: `linear-gradient(135deg, ${DARK} 0%, #1a1a1a 100%)`,
                color: '#fff', border: `1px solid rgba(201,168,76,0.3)`, cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                opacity: settings.callMode === 'webrtc' && deviceStatus !== 'ready' ? 0.5 : 1,
              }}>
              Call {contact.firstName}
            </button>
          )}

          {(isWebrtcInCall || isBridgeActive) && (
            <button onClick={handleEndCall}
              style={{ width: '100%', padding: '15px', borderRadius: 12, fontSize: 16, fontWeight: 600, background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', cursor: 'pointer' }}>
              End Call
            </button>
          )}

          {settings.callMode === 'webrtc' && deviceStatus === 'loading' && !isWebrtcInCall && (
            <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', margin: '8px 0 0' }}>Initializing dialer…</p>
          )}
        </div>

        {/* Disposition */}
        {showDisposition && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '18px', marginBottom: 12, border: '1px solid rgba(0,0,0,0.07)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 14 }}>
              How did it go?
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              {DISPOSITIONS.map(d => (
                <button key={d.key} onClick={() => setDisposition(d.key)}
                  style={{
                    padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                    background: disposition === d.key ? d.color : 'transparent',
                    color: disposition === d.key ? '#fff' : '#374151',
                    border: `1px solid ${disposition === d.key ? d.color : 'rgba(0,0,0,0.09)'}`,
                    transition: 'all 0.15s',
                  }}>
                  {d.label}
                </button>
              ))}
            </div>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Notes (optional)…" rows={2}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 13, border: '1px solid rgba(0,0,0,0.09)', outline: 'none', resize: 'none', boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' }}
            />
            <button onClick={() => disposition && saveAndAdvance(disposition)} disabled={!disposition}
              style={{
                width: '100%', padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 600,
                background: DARK, color: '#fff', border: 'none',
                cursor: disposition ? 'pointer' : 'not-allowed', opacity: disposition ? 1 : 0.4,
              }}>
              {index + 1 >= contacts.length ? 'Finish Session' : 'Next Contact →'}
            </button>
          </div>
        )}

        {/* AI Script */}
        {aiScript?.script && (
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.07)', marginBottom: 12, overflow: 'hidden' }}>
            <button onClick={() => setScriptOpen(o => !o)}
              style={{ width: '100%', padding: '13px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af' }}>Call Script</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{scriptOpen ? '▲' : '▼'}</span>
            </button>
            {scriptOpen && (
              <div style={{ padding: '0 18px 16px' }}>
                {(Array.isArray(aiScript.script) ? aiScript.script : [aiScript.script]).map((line: string, i: number) => (
                  <p key={i} style={{ fontSize: 13, color: '#374151', lineHeight: 1.65, marginBottom: 10, margin: i > 0 ? '10px 0 0' : 0 }}>{line}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Skip */}
        {!showDisposition && !isBridgeActive && !isWebrtcInCall && (
          <button onClick={skipContact}
            style={{ width: '100%', padding: '11px', borderRadius: 12, fontSize: 13, color: '#9ca3af', background: 'transparent', border: '1px solid rgba(0,0,0,0.08)', cursor: 'pointer' }}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Helper card component ────────────────────────────────────────────────────
function Card({ title, children, mb = 0 }: { title: string; children: React.ReactNode; mb?: number }) {
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '18px', marginBottom: mb, border: '1px solid rgba(0,0,0,0.07)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
