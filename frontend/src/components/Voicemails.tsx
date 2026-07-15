import React, { useState, useRef, useEffect, useCallback } from 'react';
import { API_BASE, authFetch } from '../config';

const GOLD = '#C9A84C';
const DARK = '#0A0A0A';

// ── Convert audio blob → WAV at 8 kHz mono (Twilio-compatible) ──────────────
async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

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
  const write = (off: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4,  36 + pcm.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  let offset = 44;
  for (const s of pcm) {
    view.setInt16(offset, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
    offset += 2;
  }
  return new Blob([wavBuf], { type: 'audio/wav' });
}

// ── Convert a Blob to a base64 string (no data-URL prefix) ───────────────────
// Uses FileReader which works on all browsers including iOS Safari.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Simple card wrapper ───────────────────────────────────────────────────────
function Card({ children, title, sub }: { children: React.ReactNode; title: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.07)', marginBottom: 16, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, marginBottom: sub ? 3 : 14 }}>
          {title}
        </div>
        {sub && <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.5 }}>{sub}</div>}
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        {children}
      </div>
    </div>
  );
}

export default function Voicemails() {
  const [voicemailUrl, setVoicemailUrl]     = useState<string | null>(null);
  const [voicemailReady, setVoicemailReady] = useState<boolean | null>(null);
  const [loading, setLoading]               = useState(true);

  const [recState, setRecState]     = useState<'idle' | 'requesting' | 'recording' | 'preview' | 'saving'>('idle');
  const [recSeconds, setRecSeconds] = useState(0);
  const [recObjectUrl, setRecObjectUrl] = useState<string | null>(null);
  const [recBlob, setRecBlob]           = useState<Blob | null>(null);

  const mediaRecRef  = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load current settings ──────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch(`${API_BASE}/dialer/settings`);
      if (r.ok) {
        const s = await r.json();
        setVoicemailUrl(s.voicemailUrl ?? null);
        setVoicemailReady(s.voicemailReady ?? null);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // ── Recording controls ────────────────────────────────────────────────────
  const startRecording = async () => {
    setRecState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined });
      recChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setRecBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecObjectUrl(url);
        setRecState('preview');
      };
      recorder.start();
      mediaRecRef.current = recorder;
      setRecSeconds(0);
      setRecState('recording');
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch {
      setRecState('idle');
      alert('Microphone access denied. Please allow mic access in your browser settings.');
    }
  };

  const stopRecording = () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    mediaRecRef.current?.stop();
  };

  const discardRecording = () => {
    if (recObjectUrl) URL.revokeObjectURL(recObjectUrl);
    setRecBlob(null);
    setRecObjectUrl(null);
    setRecState('idle');
  };

  const saveRecording = async () => {
    if (!recBlob) return;
    setRecState('saving');
    try {
      // Convert to WAV so Twilio can <Play> it, then send as base64 JSON.
      // Raw binary uploads conflict with the global express.json() body parser.
      const wavBlob = await blobToWav(recBlob);
      const base64  = await blobToBase64(wavBlob);
      const r = await authFetch(`${API_BASE}/dialer/upload-vm`, {
        method: 'POST',
        body: JSON.stringify({ audio: base64, mimeType: 'audio/wav' }),
      });
      const d = await r.json();
      if (d.error) { alert(d.error); setRecState('preview'); return; }
      // Keep a local blob URL for immediate playback preview — avoids cross-origin
      // audio loading from the backend domain before CORP headers propagate.
      const localPreviewUrl = URL.createObjectURL(new Blob([
        Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      ], { type: 'audio/wav' }));
      if (recObjectUrl) URL.revokeObjectURL(recObjectUrl);
      setRecBlob(null);
      setRecObjectUrl(null);
      setVoicemailUrl(localPreviewUrl);
      setVoicemailReady(true);
      setRecState('idle');
    } catch (e: any) {
      alert('Save failed: ' + e.message);
      setRecState('preview');
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: 'calc(100dvh - 49px - 56px - env(safe-area-inset-bottom))', background: '#f8f8f8', padding: 'clamp(16px,4vw,28px) 16px 24px' }} className="md:min-h-[calc(100vh-49px)]">
      <div style={{ maxWidth: 540, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.35em', textTransform: 'uppercase', color: GOLD, marginBottom: 6 }}>
            Propel Dialer
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 300, color: DARK, margin: 0 }}>Voicemails</h1>
          <p style={{ fontSize: 13, color: '#9ca3af', margin: '6px 0 0', lineHeight: 1.5 }}>
            Record the message that plays automatically when a call goes to voicemail.
          </p>
        </div>

        {/* Status banner */}
        {voicemailReady === false && recState === 'idle' && (
          <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 12, padding: '14px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ width:20,height:20,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center" }}><svg width="14" height="14" fill="none" viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#854d0e', marginBottom: 3 }}>Re-record needed</div>
              <div style={{ fontSize: 12, color: '#713f12', lineHeight: 1.5 }}>
                Your saved voicemail is in a format Twilio can't play. Record a new one below to enable automatic drops.
              </div>
            </div>
          </div>
        )}

        {/* Drop voicemail card */}
        <Card
          title="Drop Voicemail"
          sub="This recording plays automatically when a contact's phone goes to voicemail."
        >
          {/* ── Saved + ready ── */}
          {voicemailUrl && voicemailReady !== false && recState === 'idle' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: '#15803d' }}>Voicemail saved — ready to drop</span>
              </div>
              <audio controls
                src={voicemailUrl?.startsWith('blob:') ? voicemailUrl : `${voicemailUrl}?t=${Date.now()}`}
                style={{ width: '100%', height: 40, borderRadius: 8 }} />
              <button onClick={startRecording}
                style={{ padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 600, background: 'transparent', color: '#374151', border: '1px solid rgba(0,0,0,0.12)', cursor: 'pointer' }}>
                Re-record
              </button>
            </div>
          )}

          {/* ── Saved but wrong format ── */}
          {voicemailUrl && voicemailReady === false && recState === 'idle' && (
            <button onClick={startRecording}
              style={{ width: '100%', padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: '#ca8a04', color: '#fff', border: 'none', cursor: 'pointer' }}>
              Re-record Now
            </button>
          )}

          {/* ── No voicemail yet ── */}
          {!voicemailUrl && recState === 'idle' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#d1d5db', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#6b7280' }}>No voicemail recorded yet</span>
              </div>
              <button onClick={startRecording}
                style={{ width: '100%', padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: DARK, color: '#fff', border: 'none', cursor: 'pointer' }}>
                Record Voicemail
              </button>
            </div>
          )}

          {/* ── Requesting mic ── */}
          {recState === 'requesting' && (
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0, textAlign: 'center', padding: '8px 0' }}>
              Requesting microphone access…
            </p>
          )}

          {/* ── Recording ── */}
          {recState === 'recording' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fef2f2', borderRadius: 12 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', flexShrink: 0, animation: 'pulse 1s infinite' }} />
                <span style={{ fontSize: 14, fontWeight: 500, color: '#991b1b' }}>
                  Recording…&nbsp;
                  {String(Math.floor(recSeconds / 60)).padStart(2, '0')}:{String(recSeconds % 60).padStart(2, '0')}
                </span>
              </div>
              <button onClick={stopRecording}
                style={{ width: '100%', padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' }}>
                Stop Recording
              </button>
              <p style={{ margin: 0, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
                Speak clearly — this is what contacts will hear
              </p>
            </div>
          )}

          {/* ── Preview ── */}
          {recState === 'preview' && recObjectUrl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Preview your recording</div>
              <audio controls src={recObjectUrl} style={{ width: '100%', height: 40, borderRadius: 8 }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={saveRecording}
                  style={{ flex: 1, padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 600, background: DARK, color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Save &amp; Use This
                </button>
                <button onClick={discardRecording}
                  style={{ padding: '13px 18px', borderRadius: 12, fontSize: 14, color: '#6b7280', background: 'transparent', border: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer' }}>
                  Re-record
                </button>
              </div>
            </div>
          )}

          {/* ── Saving ── */}
          {recState === 'saving' && (
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0, textAlign: 'center', padding: '8px 0' }}>
              Saving voicemail…
            </p>
          )}
        </Card>

        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
      </div>
    </div>
  );
}
