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
  contactGroup?: string | null;
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
  /** true = WAV/MP3 (playable by Twilio), false = webm (re-record needed), null = no recording */
  voicemailReady?: boolean | null;
}

type SessionView = 'setup' | 'session' | 'done';
type BridgeStatus = 'idle' | 'ringing-agent' | 'calling-contact' | 'connected' | 'vm-dropped' | 'no-answer' | 'declined' | 'call-failed' | 'call-ended' | 'ended' | 'error';

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
  { value: 'all',                 label: 'All Contacts' },
  { value: 'new',                 label: 'New Leads' },
  { value: 'hot',                 label: 'Hot Leads' },
  { value: 'callback',            label: 'Callbacks' },
  { value: 'contacted',           label: 'Previously Contacted' },
  { value: 'source:expired',      label: 'Expired Listings' },
  { value: 'source:fsbo',         label: 'FSBO' },
  { value: 'source:circle',       label: 'Circle Prospecting' },
  { value: 'source:past-client',  label: 'Past Clients' },
];

const DISPOSITIONS = [
  { key: 'hot-lead',       label: 'Hot Lead',          color: '#C9A84C' },
  { key: 'appointment',    label: 'Appointment Set',    color: '#8b5cf6' },
  { key: 'callback',       label: 'Callback Scheduled', color: '#3b82f6' },
  { key: 'left-voicemail', label: 'Left Voicemail',     color: '#6b7280' },
  { key: 'no-answer',      label: 'Rang Out / No VM',   color: '#6b7280' },
  { key: 'not-interested', label: 'Not Interested',     color: '#6b7280' },
  { key: 'wrong-number',   label: 'Wrong Number',       color: '#6b7280' },
  { key: 'dnc',            label: 'DNC',                color: '#ef4444' },
];

// ─── Convert any recorded audio blob to WAV (Twilio-compatible) ──────────────
// Twilio <Play> supports WAV (PCM). We decode via Web Audio API then re-encode.
async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  // Render as mono 8 kHz — telephone quality, sufficient for voicemail
  const sampleRate = 8000;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
  const src = offlineCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offlineCtx.destination);
  src.start(0);
  const rendered = await offlineCtx.startRendering();

  const pcm = rendered.getChannelData(0);
  const wavBuf = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(wavBuf);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  w(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVE'); w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  let off = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Blob([wavBuf], { type: 'audio/wav' });
}

// ── Convert a Blob to base64 string (no data-URL prefix) ─────────────────────
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function formatPhone(p: string | null | undefined) {
  if (!p) return '';
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
    startCall, endCall, muteCall, resetCallStatus, isMuted,
  } = useTwilioDevice();

  // Twilio configuration status
  const [twilioReady, setTwilioReady]   = useState<boolean | null>(null);

  useEffect(() => {
    authFetch(`${API_BASE}/settings/status`)
      .then(r => r.json())
      .then(d => setTwilioReady(!!d.twilio))
      .catch(() => setTwilioReady(false));
  }, []);

  // Views & session
  const [view, setView]                 = useState<SessionView>('setup');
  const [contacts, setContacts]         = useState<DialerContact[]>([]);
  const [index, setIndex]               = useState(0);
  const [sessionFilter, setSessionFilter] = useState('all');
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [dialerGroups, setDialerGroups] = useState<Array<{ id: string; name: string; color: string; contactCount: number }>>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // Settings
  const [settings, setSettings]         = useState<DialerSettings>({ callMode: 'webrtc', personalPhone: '', phoneVerified: false });

  // Phone verification
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'calling' | 'polling' | 'verified' | 'error'>('idle');
  const verifyPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Browser voicemail recording
  const [recState, setRecState]     = useState<'idle' | 'requesting' | 'recording' | 'preview' | 'saving'>('idle');
  const [recSeconds, setRecSeconds] = useState(0);
  const [recBlob, setRecBlob]       = useState<Blob | null>(null);
  const [recObjectUrl, setRecObjectUrl] = useState<string | null>(null);
  const mediaRecRef  = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bridge mode
  const [bridgeSessionId, setBridgeSessionId] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('idle');
  const [contactAnswered, setContactAnswered] = useState(false); // true once Twilio reports contact's phone answered
  const [vmDropToast, setVmDropToast] = useState<string | null>(null); // contact name for the "VM dropped" toast
  const [lastOutcomeContactName, setLastOutcomeContactName] = useState<string | null>(null);
  const vmToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [vmModalOpen, setVmModalOpen] = useState(false); // voicemail re-record modal during session

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

    socket.on('bridge-status', (data: { sessionId: string; status: string; contactName?: string }) => {
      // vm-dropped: always show the toast (we may have already auto-advanced to the next contact),
      // but only update bridgeStatus/disposition if this session is still the active one.
      if (data.status === 'vm-dropped') {
        const name = data.contactName || 'your contact';
        setVmDropToast(name);
        if (vmToastTimerRef.current) clearTimeout(vmToastTimerRef.current);
        vmToastTimerRef.current = setTimeout(() => setVmDropToast(null), 4000);
        if (data.sessionId === bridgeIdRef.current) {
          setBridgeStatus('vm-dropped' as BridgeStatus);
          setDisposition('left-voicemail');
        }
        return;
      }

      if (!bridgeIdRef.current || data.sessionId === bridgeIdRef.current) {
        // contact-answered: track that the contact's phone was picked up (human or VM greeting)
        if (data.status === 'contact-answered') {
          setContactAnswered(true);
          return;
        }
        setBridgeStatus(data.status as BridgeStatus);
        if (['no-answer', 'declined', 'call-failed'].includes(data.status)) {
          setDisposition('no-answer');
          setLastOutcomeContactName(data.contactName || null);
        }
      }
    });

    socket.on('vm-recorded', () => {
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

  // ─── Load groups from API ────────────────────────────────────────────────────
  const loadDialerGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const r = await authFetch(`${API_BASE}/contact-groups`);
      if (r.ok) {
        const data = await r.json();
        setDialerGroups(Array.isArray(data) ? data : []);
      }
    } catch {}
    setGroupsLoading(false);
  }, []);

  useEffect(() => { loadDialerGroups(); }, [loadDialerGroups]);

  // ─── Pre-select group filter from Contacts book ──────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem('dialerGroupFilter');
    if (!stored) return;
    try {
      const gf = JSON.parse(stored);
      if (gf.type === 'group' && gf.value) {
        setSessionFilter(`group:${gf.value}`);
      } else if (gf.type === 'source' && gf.value) {
        setSessionFilter(`source:${gf.value}`);
      } else if (gf.type === 'status' && gf.value) {
        setSessionFilter(gf.value);
      }
      // type === 'all' → leave as 'all'
    } catch {}
    localStorage.removeItem('dialerGroupFilter');
  }, []);

  // ─── Load contacts ──────────────────────────────────────────────────────────
  const loadContacts = useCallback(async (filter: string) => {
    setLoadingContacts(true);
    try {
      const isSourceFilter = filter.startsWith('source:');
      const isGroupFilter  = filter.startsWith('group:');
      let statusParam = filter;
      if (filter === 'past-client' || isSourceFilter || isGroupFilter) statusParam = 'all';
      const r = await authFetch(
        `${API_BASE}/dialer/contacts?status=${statusParam === 'all' ? 'all' : statusParam}&limit=200`
      );
      let data: DialerContact[] = await r.json();
      if (!Array.isArray(data)) data = [];

      if (filter === 'past-client') {
        data = data.filter(c => c.source === 'past-client');
      } else if (isSourceFilter) {
        const sourceVal = filter.replace('source:', '');
        data = data.filter(c => c.source === sourceVal);
      } else if (isGroupFilter) {
        const groupVal = filter.replace('group:', '');
        data = data.filter(c => c.contactGroup === groupVal);
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

  // ─── Browser voicemail recording ────────────────────────────────────────────
  const startRecording = async () => {
    setRecState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Pick the best format Twilio can play: ogg > mp4 > webm
      const mimeType = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
        .find(t => MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecRef.current = rec;
      recChunksRef.current = [];

      rec.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecBlob(blob);
        setRecObjectUrl(url);
        setRecState('preview');
        if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
      };

      rec.start(250);
      setRecSeconds(0);
      setRecState('recording');
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch (e: any) {
      setRecState('idle');
      alert('Mic access denied — please allow microphone access in your browser.');
    }
  };

  const stopRecording = () => {
    mediaRecRef.current?.stop();
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
  };

  const saveRecording = async () => {
    if (!recBlob) return;
    setRecState('saving');
    try {
      // Convert to WAV so Twilio can <Play> it (webm/opus not supported by Twilio)
      const wavBlob = await blobToWav(recBlob);
      const base64  = await blobToBase64(wavBlob);
      const r = await authFetch(`${API_BASE}/dialer/upload-vm`, {
        method: 'POST',
        body: JSON.stringify({ audio: base64, mimeType: 'audio/wav' }),
      });
      const d = await r.json();
      if (d.error) { alert(d.error); setRecState('preview'); return; }
      setSettings(s => ({ ...s, voicemailUrl: d.url }));
      if (recObjectUrl) URL.revokeObjectURL(recObjectUrl);
      setRecBlob(null);
      setRecObjectUrl(null);
      setRecState('idle');
    } catch (e: any) {
      alert('Save failed: ' + e.message);
      setRecState('preview');
    }
  };

  const discardRecording = () => {
    if (recObjectUrl) URL.revokeObjectURL(recObjectUrl);
    setRecBlob(null);
    setRecObjectUrl(null);
    setRecState('idle');
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
    setContactAnswered(false); // reset for new call
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
      // WebRTC conference mode: backend creates a bridge session, browser joins the named
      // conference. Backend dials contact via REST API with machineDetection — AMD fires
      // reliably (unlike TwiML <Dial> which was never auto-dropping voicemails).
      try {
        const r = await authFetch(`${API_BASE}/dialer/call`, {
          method: 'POST',
          body: JSON.stringify({ contactId: contact.id, mode: 'webrtc' }),
        });
        const data = await r.json();
        if (data.error) { alert(data.error); return; }
        setBridgeSessionId(data.sessionId);
        setBridgeStatus('calling-contact');
        // WebRTC conference mode: browser joins named Twilio conference.
        // Backend dials contact via REST API with sync AMD; bridge-b-twiml drops VM inline.
        await startCall(contact.phone, undefined, data.sessionId, data.confName);
      } catch (e: any) {
        alert('Call failed: ' + e.message);
        setBridgeStatus('idle');
      }
    }
  }, [contacts, index, settings.callMode, startCall]);

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
    resetCallStatus(); // clear 'completed' so next contact shows the Call button

    if (index + 1 >= contacts.length) {
      setView('done');
    } else {
      setIndex(i => i + 1);
    }
  }, [contacts, index, notes, callDuration, activeCall, settings.callMode, resetCallStatus]);

  // ─── End call ───────────────────────────────────────────────────────────────
  const handleEndCall = useCallback(async () => {
    // Bridge mode only: contact answered and AMD is still running — voicemail is in progress.
    // Agent can escape early; AMD continues silently and drops the VM then cleans up.
    // In live-audio WebRTC mode, the agent is hearing the call directly, so they stay
    // connected until the voicemail plays through and the call ends naturally.
    const vmInProgress = settings.callMode === 'bridge' && bridgeStatus === 'calling-contact' && contactAnswered;

    endCall(); // always disconnect browser WebRTC immediately

    if (bridgeSessionId) {
      if (vmInProgress) {
        // Clear the ref NOW (synchronously) so the vm-dropped socket event that fires later
        // doesn't update the next contact's bridgeStatus — just the toast.
        bridgeIdRef.current = null;
      }
      setBridgeStatus('ended');
      if (!vmInProgress) {
        // Normal hang-up: kill both call legs via bridge-hangup
        try {
          await authFetch(`${API_BASE}/dialer/bridge-hangup`, {
            method: 'POST',
            body: JSON.stringify({ sessionId: bridgeSessionId }),
          });
        } catch {}
      }
      // If vmInProgress: leave contact call alive — AMD will play voicemail then hang up
    }

    if (vmInProgress) {
      // Log as voicemail and jump to next contact — VM drops silently in background
      saveAndAdvance('left-voicemail');
    }
  }, [bridgeSessionId, bridgeStatus, contactAnswered, endCall, saveAndAdvance]);

  // ─── Manual voicemail drop ───────────────────────────────────────────────────
  // Lets the agent drop the pre-recorded voicemail when AMD hasn't auto-detected
  // the machine (e.g., they can hear the voicemail greeting but status is still calling-contact).
  const handleDropVm = useCallback(async () => {
    if (!bridgeSessionId) return;
    try {
      await authFetch(`${API_BASE}/dialer/manual-vm-drop`, {
        method: 'POST',
        body: JSON.stringify({ sessionId: bridgeSessionId }),
      });
      // Backend emits vm-dropped socket event; frontend handler will update status.
      // Advance to next contact immediately.
      bridgeIdRef.current = null;
      endCall();
      saveAndAdvance('left-voicemail');
    } catch {}
  }, [bridgeSessionId, endCall, saveAndAdvance]);

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
    resetCallStatus();
    if (index + 1 >= contacts.length) setView('done');
    else setIndex(i => i + 1);
  };

  // ─── Derived ─────────────────────────────────────────────────────────────────
  const contact          = contacts[index] ?? null;
  const isWebrtcInCall   = settings.callMode === 'webrtc' && ['in-call','connecting','ringing'].includes(callStatus);
  const isWebrtcDone     = settings.callMode === 'webrtc' && callStatus === 'completed';
  const isBridgeActive   = settings.callMode === 'bridge' && ['ringing-agent','calling-contact','connected'].includes(bridgeStatus);
  const isBridgeDone     = settings.callMode === 'bridge' && ['vm-dropped','no-answer','declined','call-failed','call-ended','ended'].includes(bridgeStatus);
  const showCallBtn      = !isWebrtcInCall && !isBridgeActive && !isWebrtcDone && !isBridgeDone;
  const showDisposition  = isWebrtcDone || isBridgeDone;

  const bridgeLabel: Record<string, string> = {
    'ringing-agent':    'Calling your phone…',
    'calling-contact':  `Connecting to ${contact?.firstName ?? ''}…`,
    connected:          `Connected — ${contact?.firstName ?? ''}`,
    'vm-dropped':       'Voicemail dropped',
    'no-answer':        'Rang out — no voicemail',
    'declined':         'Contact declined',
    'call-failed':      'Call failed',
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

          {/* ── Twilio not configured warning ── */}
          {twilioReady === false && (
            <div style={{ background: '#fff8ed', border: '1px solid #f5c87a', borderRadius: 10, padding: '14px 16px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ width:18,height:18,flexShrink:0,borderRadius:4,background:"rgba(239,68,68,0.12)",display:"inline-flex",alignItems:"center",justifyContent:"center" }}><svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 3 }}>Twilio not configured</div>
                <div style={{ fontSize: 12, color: '#b45309', lineHeight: 1.5 }}>
                  Add <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>TWILIO_ACCOUNT_SID</code>, <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>TWILIO_AUTH_TOKEN</code>, and <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>TWILIO_CALLER_ID</code> to your <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>backend/.env</code> file, then restart the server. Calls will not work until this is set up.
                </div>
              </div>
            </div>
          )}

          {/* ── Who to call ── */}
          <Card title="Who to call" mb={14}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* All Contacts */}
              <button
                key="all"
                onClick={() => setSessionFilter('all')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                  borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                  background: sessionFilter === 'all' ? DARK : 'transparent',
                  border: `1px solid ${sessionFilter === 'all' ? DARK : 'rgba(0,0,0,0.09)'}`,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: sessionFilter === 'all' ? GOLD : '#d1d5db', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14, color: sessionFilter === 'all' ? '#fff' : '#374151', fontWeight: sessionFilter === 'all' ? 500 : 400, textAlign: 'left' }}>
                  All Contacts
                </span>
              </button>

              {/* User-created groups from API */}
              {groupsLoading && (
                <div style={{ fontSize: 11, color: '#9ca3af', padding: '4px 2px' }}>Loading groups…</div>
              )}
              {dialerGroups.map(g => {
                const fv = `group:${g.name}`;
                const active = sessionFilter === fv;
                return (
                  <button
                    key={g.id}
                    onClick={() => setSessionFilter(fv)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                      borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                      background: active ? DARK : 'transparent',
                      border: `1px solid ${active ? DARK : 'rgba(0,0,0,0.09)'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    {/* Group colour dot */}
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: active ? GOLD : g.color,
                      flexShrink: 0,
                      boxShadow: active ? 'none' : `0 0 0 1.5px ${g.color}44`,
                    }} />
                    <span style={{ flex: 1, fontSize: 14, color: active ? '#fff' : '#374151', fontWeight: active ? 500 : 400, textAlign: 'left' }}>
                      {g.name}
                    </span>
                    {g.contactCount > 0 && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
                        color: active ? 'rgba(255,255,255,0.5)' : '#9ca3af',
                        background: active ? 'rgba(255,255,255,0.1)' : '#f3f4f6',
                        borderRadius: 8, padding: '1px 7px',
                      }}>
                        {g.contactCount}
                      </span>
                    )}
                  </button>
                );
              })}

              {!groupsLoading && dialerGroups.length === 0 && (
                <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 2px 0', lineHeight: 1.6 }}>
                  Create groups in the <strong>Contacts</strong> tab to dial specific lists.
                </p>
              )}
            </div>
          </Card>

          {/* ── Call mode ── */}
          <Card title="Call mode" mb={14}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {([
                { mode: 'webrtc', title: 'Browser Audio', sub: 'Browser mic & speaker • Auto VM drop' },
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
            {/* Saved voicemail */}
            {settings.voicemailUrl && recState === 'idle' && (
              <>
                {/* voicemailReady=false means stored as webm (pre-WAV fix) — Twilio can't play it */}
                {settings.voicemailReady === false ? (
                  <div style={{ padding: '10px 14px', background: '#fef9c3', borderRadius: 10, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#854d0e' }}>Re-record needed</span>
                    <span style={{ fontSize: 12, color: '#713f12', lineHeight: 1.5 }}>
                      Your saved voicemail is in a format that Twilio can't play. Please re-record it so automatic drops work correctly.
                    </span>
                    <button onClick={startRecording}
                      style={{ marginTop: 4, padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#ca8a04', color: '#fff', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }}>
                      Re-record Now
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
                      <span style={{ fontSize: 13, color: '#374151' }}>Voicemail saved</span>
                    </div>
                    <audio controls src={`${settings.voicemailUrl}?t=${Date.now()}`} style={{ width: '100%', height: 36, borderRadius: 6, marginBottom: 10 }} />
                    <button onClick={startRecording}
                      style={{ fontSize: 12, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      Re-record
                    </button>
                  </>
                )}
              </>
            )}

            {/* Idle — no recording yet */}
            {!settings.voicemailUrl && recState === 'idle' && (
              <>
                <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 14px', lineHeight: 1.5 }}>
                  Record a short message that plays automatically when a call goes to voicemail.
                </p>
                <button onClick={startRecording}
                  style={{ padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: DARK, color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Record Voicemail
                </button>
              </>
            )}

            {/* Requesting mic */}
            {recState === 'requesting' && (
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Requesting microphone access…</p>
            )}

            {/* Recording in progress */}
            {recState === 'recording' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#fef2f2', borderRadius: 10 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite' }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#991b1b' }}>
                    Recording… {String(Math.floor(recSeconds / 60)).padStart(2, '0')}:{String(recSeconds % 60).padStart(2, '0')}
                  </span>
                </div>
                <button onClick={stopRecording}
                  style={{ padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Stop Recording
                </button>
              </div>
            )}

            {/* Preview recorded audio */}
            {recState === 'preview' && recObjectUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <audio controls src={recObjectUrl} style={{ width: '100%', height: 36, borderRadius: 6 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={saveRecording}
                    style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: DARK, color: '#fff', border: 'none', cursor: 'pointer' }}>
                    Save
                  </button>
                  <button onClick={discardRecording}
                    style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, color: '#6b7280', background: 'transparent', border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}>
                    Re-record
                  </button>
                </div>
              </div>
            )}

            {/* Saving */}
            {recState === 'saving' && (
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Saving voicemail…</p>
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
  if (loadingContacts || !contact) return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      {loadingContacts ? (
        <>
          <div style={{ width: 36, height: 36, border: `3px solid ${GOLD}30`, borderTopColor: GOLD, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <div style={{ fontSize: 14, color: '#9ca3af' }}>Loading contacts…</div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 32, marginBottom: 4 }}>📭</div>
          <div style={{ fontSize: 18, fontWeight: 300, color: DARK }}>No contacts found</div>
          <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>Try a different filter or import contacts first.</div>
          <button onClick={() => setView('setup')} style={{ padding: '10px 24px', borderRadius: 10, background: DARK, color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ← Back to Setup
          </button>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const lastCall = contact.calls?.[0];
  const pct      = Math.round((index / contacts.length) * 100);

  return (
    <div className="full-page-h"
      style={{ background: '#f8f8f8', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Progress bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ flex: 1, height: 3, background: '#f3f4f6', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: GOLD, borderRadius: 99, transition: 'width 0.4s' }} />
        </div>
        <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap' }}>{index + 1} / {contacts.length}</span>
        <button onClick={() => setVmModalOpen(true)} title="Re-record voicemail"
          style={{ fontSize: 14, color: settings.voicemailReady === false ? '#f59e0b' : '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}>
          
        </button>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Drop VM button — bridge mode only. In live-audio WebRTC mode AMD handles it
                  automatically and the agent hears the drop happen in real time. */}
              {settings.callMode === 'bridge' && bridgeStatus === 'calling-contact' && contactAnswered && (
                <button
                  onClick={handleDropVm}
                  disabled={!settings.voicemailReady && !settings.voicemailUrl}
                  title={(!settings.voicemailReady && !settings.voicemailUrl) ? 'No voicemail recording — record one in Setup' : 'Drop your pre-recorded voicemail now'}
                  style={{
                    width: '100%', padding: '13px', borderRadius: 12, fontSize: 15, fontWeight: 600,
                    background: (!settings.voicemailReady && !settings.voicemailUrl) ? '#f3f4f6' : GOLD,
                    color: (!settings.voicemailReady && !settings.voicemailUrl) ? '#9ca3af' : '#fff',
                    border: 'none', cursor: (!settings.voicemailReady && !settings.voicemailUrl) ? 'not-allowed' : 'pointer',
                  }}>
                  📨 Drop Voicemail Now
                </button>
              )}
              <button onClick={handleEndCall}
                style={{ width: '100%', padding: '15px', borderRadius: 12, fontSize: 16, fontWeight: 600, background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', cursor: 'pointer' }}>
                End Call
              </button>
            </div>
          )}

          {settings.callMode === 'webrtc' && deviceStatus === 'loading' && !isWebrtcInCall && (
            <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', margin: '8px 0 0' }}>Initializing dialer…</p>
          )}
        </div>

        {/* Disposition */}
        {showDisposition && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '18px', marginBottom: 12, border: '1px solid rgba(0,0,0,0.07)' }}>

            {/* Call outcome banner — tells the agent exactly what happened */}
            {(() => {
              const n = lastOutcomeContactName || 'Contact';
              const outcome: Record<string, { icon: string; text: string; bg: string; color: string }> = {
                'no-answer':   { icon: '📵', text: `${n} — rang out, no voicemail`, bg: '#f3f4f6', color: '#374151' },
                'declined':    { icon: '🚫', text: `${n} declined the call`, bg: '#fef2f2', color: '#dc2626' },
                'call-failed': { icon: '⚠️', text: `${n} — number may be disconnected`, bg: '#fef2f2', color: '#dc2626' },
                'call-ended':  { icon: '', text: 'Call ended — contact answered and hung up', bg: '#f0fdf4', color: '#15803d' },
                'vm-dropped':  { icon: '📨', text: 'Voicemail dropped successfully', bg: '#fefce8', color: '#92400e' },
                ended:         { icon: '', text: 'Call ended', bg: '#f3f4f6', color: '#374151' },
                error:         { icon: '', text: 'Call failed to connect', bg: '#fef2f2', color: '#dc2626' },
              };
              const o = outcome[bridgeStatus] || (callStatus === 'completed' ? { icon: '', text: 'Call ended', bg: '#f3f4f6', color: '#374151' } : null);
              if (!o) return null;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: o.bg, marginBottom: 14 }}>
                  {o.icon ? <span style={{ fontSize: 16 }}>{o.icon}</span> : null}
                  <span style={{ fontSize: 13, fontWeight: 500, color: o.color }}>{o.text}</span>
                </div>
              );
            })()}

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

      {/* Voicemail re-record modal */}
      {vmModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9998,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }} onClick={(e) => { if (e.target === e.currentTarget && recState === 'idle') setVmModalOpen(false); }}>
          <div style={{
            background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px 36px',
            width: '100%', maxWidth: 520, boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, marginBottom: 4 }}>Voicemail Drop</div>
                <div style={{ fontSize: 17, fontWeight: 500, color: DARK }}>Record your message</div>
              </div>
              {recState === 'idle' && (
                <button onClick={() => setVmModalOpen(false)}
                  style={{ fontSize: 20, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '4px 8px' }}>
                  ×
                </button>
              )}
            </div>

            {/* Saved — good format */}
            {settings.voicemailUrl && settings.voicemailReady !== false && recState === 'idle' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
                  <span style={{ fontSize: 13, color: '#374151' }}>Voicemail saved</span>
                </div>
                <audio controls src={`${settings.voicemailUrl}?t=${Date.now()}`} style={{ width: '100%', height: 36, borderRadius: 6, marginBottom: 14 }} />
                <button onClick={startRecording}
                  style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: DARK, color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Re-record
                </button>
              </>
            )}

            {/* Re-record needed warning */}
            {settings.voicemailReady === false && recState === 'idle' && (
              <>
                <div style={{ padding: '10px 14px', background: '#fef9c3', borderRadius: 10, marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#854d0e', marginBottom: 4 }}>Re-record needed</div>
                  <div style={{ fontSize: 12, color: '#713f12', lineHeight: 1.5 }}>Your saved voicemail is in a format Twilio can't play. Re-record it to enable automatic drops.</div>
                </div>
                <button onClick={startRecording}
                  style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: '#ca8a04', color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Re-record Now
                </button>
              </>
            )}

            {/* No voicemail yet */}
            {!settings.voicemailUrl && recState === 'idle' && (
              <>
                <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.5 }}>
                  Record a short message that plays automatically when a call goes to voicemail.
                </p>
                <button onClick={startRecording}
                  style={{ width: '100%', padding: '12px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: DARK, color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Record Voicemail
                </button>
              </>
            )}

            {/* Requesting mic */}
            {recState === 'requesting' && (
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0, textAlign: 'center' }}>Requesting microphone access…</p>
            )}

            {/* Recording */}
            {recState === 'recording' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px', background: '#fef2f2', borderRadius: 12 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite' }} />
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#991b1b' }}>
                    Recording… {String(Math.floor(recSeconds / 60)).padStart(2, '0')}:{String(recSeconds % 60).padStart(2, '0')}
                  </span>
                </div>
                <button onClick={stopRecording}
                  style={{ width: '100%', padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Stop Recording
                </button>
              </div>
            )}

            {/* Preview */}
            {recState === 'preview' && recObjectUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <audio controls src={recObjectUrl} style={{ width: '100%', height: 36, borderRadius: 6 }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={async () => { await saveRecording(); setVmModalOpen(false); }}
                    style={{ flex: 1, padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: DARK, color: '#fff', border: 'none', cursor: 'pointer' }}>
                    Save
                  </button>
                  <button onClick={discardRecording}
                    style={{ padding: '13px 18px', borderRadius: 12, fontSize: 14, color: '#6b7280', background: 'transparent', border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}>
                    Re-record
                  </button>
                </div>
              </div>
            )}

            {/* Saving */}
            {recState === 'saving' && (
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0, textAlign: 'center' }}>Saving voicemail…</p>
            )}
          </div>
        </div>
      )}

      {/* VM Dropped toast — floats over UI, shows even after auto-advancing to next contact */}
      {vmDropToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#16a34a', color: '#fff', padding: '10px 20px', borderRadius: 24,
          fontSize: 13, fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'center', gap: 8,
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          <span>✓</span>
          <span>Voicemail dropped for {vmDropToast}</span>
        </div>
      )}
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
