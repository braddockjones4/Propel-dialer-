/**
 * Voicemail Blast UI
 * Drop recorded voicemails to hundreds of contacts simultaneously.
 */

import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, authFetch } from '../config';


interface BlastStatus {
  id: string;
  status: 'running' | 'done' | 'stopped';
  total: number;
  dropped: number;
  failed: number;
  skipped: number;
  progress: number;
  elapsedSeconds: number;
}

const DEFAULT_SCRIPTS: Record<string, string> = {
  expired:  `Hi, this is Braddock calling about your property at {address}. I noticed your listing came off the market and I have some ideas that could help you sell fast. Please call me back at your earliest convenience. Looking forward to connecting!`,
  fsbo:     `Hi {firstName}, this is Braddock. I work with serious buyers actively searching in your neighborhood and I'd love to introduce them to your home. Give me a call back and let's see if we can make something work for both of us. Thank you!`,
  circle:   `Hi, this is Braddock calling from the area. I just helped a neighbor sell nearby and I have buyers still looking in this neighborhood. If you've ever thought about selling, now might be a great time. Give me a quick call back. Thank you!`,
  general:  `Hi, this is Braddock calling about real estate in your area. I'd love to connect about your property. Please give me a call back at your earliest convenience. Thank you and have a great day!`,
};

export default function VoicemailBlast() {
  const [script, setScript]         = useState(DEFAULT_SCRIPTS.expired);
  const [sourceFilter, setSource]   = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [concurrency, setConcur]    = useState(5);
  const [blastId, setBlastId]       = useState<string | null>(null);
  const [blastStatus, setBlast]     = useState<BlastStatus | null>(null);
  const [error, setError]           = useState('');
  const [sending, setSending]       = useState(false);
  const [contactCount, setCount]    = useState<number | null>(null);
  const pollRef                     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Estimate contact count on filter change
  useEffect(() => {
    const params = new URLSearchParams({ limit: '1000' });
    if (sourceFilter) params.set('source', sourceFilter);
    if (statusFilter) params.set('status', statusFilter);
    authFetch(`${API_BASE}/contacts?${params}`)
      .then(r => r.json())
      .then(data => setCount(Array.isArray(data) ? data.length : 0))
      .catch(() => setCount(null));
  }, [sourceFilter, statusFilter]);

  // Poll blast progress
  useEffect(() => {
    if (!blastId) return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await authFetch(`${API_BASE}/voicemail-blast/${blastId}`);
        const data = await r.json();
        setBlast(data);
        if (data.status === 'done' || data.status === 'stopped') {
          clearInterval(pollRef.current!);
          setSending(false);
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [blastId]);

  const handleStart = async () => {
    setError('');
    setSending(true);
    try {
      const r = await authFetch(`${API_BASE}/voicemail-blast/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          concurrency,
          filter: {
            ...(sourceFilter ? { source: sourceFilter } : {}),
            ...(statusFilter ? { status: statusFilter } : {}),
          },
        }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || 'Failed to start blast'); setSending(false); return; }
      setBlastId(data.blastId);
      setBlast({ id: data.blastId, status: 'running', total: data.total, dropped: 0, failed: 0, skipped: 0, progress: 0, elapsedSeconds: 0 });
    } catch (e: any) {
      setError(e.message);
      setSending(false);
    }
  };

  const handleStop = async () => {
    if (!blastId) return;
    await authFetch(`${API_BASE}/voicemail-blast/${blastId}/stop`, { method: 'POST' });
  };

  const handleReset = () => {
    setBlastId(null);
    setBlast(null);
    setSending(false);
    setError('');
  };

  const isActive = blastStatus?.status === 'running';

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-light text-black tracking-tight">Voicemail Blast</h1>
          <p className="text-sm text-gray-400 mt-1 tracking-wide">
            Drop personalized voicemails to hundreds of contacts simultaneously
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded bg-red-50 border border-red-100 text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* Active blast progress */}
        {blastStatus && (
          <div className="mb-6 card-gold">
            <div className="flex items-center justify-between mb-4">
              <h3 className="field-label">
                Blast {isActive ? 'Running' : blastStatus.status === 'done' ? 'Complete ✓' : 'Stopped'}
              </h3>
              <div className="flex gap-2">
                {isActive && (
                  <button onClick={handleStop} className="btn-danger text-xs px-3 py-1.5">
                    Stop Blast
                  </button>
                )}
                {!isActive && (
                  <button onClick={handleReset} className="btn-ghost text-xs px-3 py-1.5">
                    New Blast
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{ width: `${blastStatus.progress}%`, background: isActive ? '#C9A84C' : blastStatus.status === 'done' ? '#22c55e' : '#9ca3af' }}
              />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Total',   value: blastStatus.total,          color: '#000' },
                { label: 'Dropped', value: blastStatus.dropped,        color: '#22c55e' },
                { label: 'Skipped', value: blastStatus.skipped,        color: '#9A7A2E' },
                { label: 'Failed',  value: blastStatus.failed,         color: '#ef4444' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className="text-2xl font-light" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[10px] text-gray-400 tracking-widest uppercase mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {blastStatus.elapsedSeconds > 0 && (
              <div className="text-center text-[10px] text-gray-300 tracking-widest mt-3 uppercase">
                {Math.floor(blastStatus.elapsedSeconds / 60)}m {blastStatus.elapsedSeconds % 60}s elapsed
              </div>
            )}
          </div>
        )}

        {/* Configuration — hide when blast is active */}
        {!blastStatus && (
          <div className="space-y-5">

            {/* Script templates */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="field-label">Voicemail Script</h3>
                <div className="flex gap-1.5">
                  {Object.entries(DEFAULT_SCRIPTS).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => setScript(val)}
                      className="text-[9px] tracking-widest uppercase px-2 py-1 rounded border transition-colors"
                      style={{ borderColor: 'rgba(201,168,76,0.3)', color: '#9A7A2E' }}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                value={script}
                onChange={e => setScript(e.target.value)}
                rows={5}
                className="field-input resize-none"
                placeholder="Your voicemail script…"
              />
              <p className="text-[10px] text-gray-300 mt-1.5 tracking-wide">
                Use {'{firstName}'}, {'{address}'} for personalization
              </p>
            </div>

            {/* Audience filters */}
            <div className="card">
              <h3 className="field-label mb-3">Target Audience</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Lead Type</label>
                  <select value={sourceFilter} onChange={e => setSource(e.target.value)} className="field-input">
                    <option value="">All types</option>
                    <option value="expired">Expired Listings</option>
                    <option value="fsbo">FSBO</option>
                    <option value="circle">Circle Prospecting</option>
                    <option value="past-client">Past Clients</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">Status</label>
                  <select value={statusFilter} onChange={e => setStatus(e.target.value)} className="field-input">
                    <option value="">All statuses</option>
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="callback">Callback</option>
                    <option value="hot">Hot</option>
                  </select>
                </div>
              </div>
              {contactCount !== null && (
                <p className="text-xs mt-3" style={{ color: '#9A7A2E' }}>
                  {contactCount} contact{contactCount !== 1 ? 's' : ''} will receive this voicemail
                </p>
              )}
            </div>

            {/* Advanced settings */}
            <div className="card">
              <h3 className="field-label mb-3">Advanced</h3>
              <div>
                <label className="field-label">Simultaneous Calls (1–10)</label>
                <input
                  type="range" min={1} max={10} value={concurrency}
                  onChange={e => setConcur(Number(e.target.value))}
                  className="w-full mt-1"
                />
                <div className="text-xs text-gray-400 mt-1">{concurrency} concurrent calls</div>
              </div>
            </div>

            {/* TCPA notice */}
            <div className="p-4 rounded border text-xs text-gray-400 leading-relaxed"
                 style={{ borderColor: 'rgba(201,168,76,0.2)', background: 'rgba(201,168,76,0.02)' }}>
              <strong className="text-gray-600">TCPA Compliance:</strong> Ensure you have prior express consent or an established business relationship before dropping voicemails. DNC list compliance is your responsibility. This tool is intended for use with opted-in or legally permissible contact lists only.
            </div>

            <button
              onClick={handleStart}
              disabled={sending || !script.trim() || (contactCount !== null && contactCount === 0)}
              className="btn-gold w-full py-3 text-base"
            >
              {sending ? 'Starting…' : `Drop Voicemail${contactCount ? ` to ${contactCount} Contacts` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
