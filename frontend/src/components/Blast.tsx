import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../config';

const VARIABLES = ['{{firstName}}', '{{fullName}}', '{{address}}', '{{agentName}}', '{{agentPhone}}'];

const SOURCE_OPTIONS = [
  { value: '', label: 'All Sources' },
  { value: 'expired', label: 'Expired Listings' },
  { value: 'fsbo', label: 'FSBO' },
  { value: 'circle', label: 'Circle Prospects' },
  { value: 'past-client', label: 'Past Clients' },
  { value: 'manual', label: 'Manual' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'callback', label: 'Callback' },
  { value: 'hot', label: 'Hot Lead' },
];

type Mode  = 'now' | 'scheduled' | 'ab';
type Stage = 'compose' | 'preview' | 'sending' | 'done';

interface ScheduledBlast {
  id: string;
  message: string;
  filter: string;
  scheduledAt: string;
  status: 'pending' | 'sent' | 'cancelled';
  sentCount?: number;
  failCount?: number;
}

function formatDT(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function Blast() {
  const [message, setMessage]   = useState('');
  const [source, setSource]     = useState('');
  const [status, setStatus]     = useState('');
  const [stage, setStage]       = useState<Stage>('compose');
  const [mode, setMode]         = useState<Mode>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [messageB, setMessageB] = useState('');
  const [abResults, setAbResults] = useState<{
    a: { sent: number; failed: number; total: number; message: string };
    b: { sent: number; failed: number; total: number; message: string };
  } | null>(null);
  const [preview, setPreview]   = useState('');
  const [count, setCount]       = useState(0);
  const [results, setResults]   = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [loading, setLoading]   = useState(false);

  // Scheduled blasts list
  const [scheduledBlasts, setScheduledBlasts] = useState<ScheduledBlast[]>([]);

  const loadScheduled = () => {
    authFetch(`${API_BASE}/blast/scheduled`)
      .then(r => r.json())
      .then(setScheduledBlasts)
      .catch(() => {});
  };

  useEffect(() => { loadScheduled(); }, []);

  const insertVar = (v: string) => setMessage(m => m + v);

  const handlePreview = async () => {
    if (!message.trim()) return;
    setLoading(true);
    const res = await authFetch(`${API_BASE}/blast/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, filter: { source: source || undefined, status: status || undefined } }),
    });
    const data = await res.json();
    setPreview(data.preview);
    setCount(data.count);
    setLoading(false);
    setStage('preview');
  };

  const handleAbSend = async () => {
    setStage('sending');
    const res = await authFetch(`${API_BASE}/blast/ab-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageA: message,
        messageB,
        filter: { source: source || undefined, status: status || undefined },
        mediaUrl: mediaUrl || undefined,
      }),
    });
    const data = await res.json();
    setAbResults(data);
    setStage('done');
  };

  const handleSendNow = async () => {
    setStage('sending');
    const res = await authFetch(`${API_BASE}/blast/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        filter: { source: source || undefined, status: status || undefined },
        mediaUrl: mediaUrl || undefined,
      }),
    });
    const data = await res.json();
    setResults(data);
    setStage('done');
  };

  const handleSchedule = async () => {
    if (!scheduledAt) { alert('Pick a date and time'); return; }
    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate <= new Date()) { alert('Scheduled time must be in the future'); return; }

    const res = await authFetch(`${API_BASE}/blast/scheduled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        filter: { source: source || undefined, status: status || undefined },
        scheduledAt: scheduledDate.toISOString(),
      }),
    });
    if (res.ok) {
      setStage('done');
      setResults({ sent: 0, failed: 0, total: count }); // reuse done stage for schedule confirm
      loadScheduled();
    } else {
      alert('Failed to schedule blast');
    }
  };

  const cancelScheduled = async (id: string) => {
    await authFetch(`${API_BASE}/blast/scheduled/${id}`, { method: 'DELETE' });
    loadScheduled();
  };

  const reset = () => {
    setMessage('');
    setSource('');
    setStatus('');
    setStage('compose');
    setMode('now');
    setScheduledAt('');
    setMediaUrl('');
    setMessageB('');
    setAbResults(null);
    setResults(null);
    loadScheduled();
  };

  // Build min datetime string for the picker (now + 5 min)
  const minDateTime = (() => {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <div className="text-[9px] tracking-widest uppercase mb-2" style={{ color: 'rgba(154,122,46,0.7)' }}>
            Hit Em Up
          </div>
          <h1 className="text-3xl font-serif font-light text-black tracking-wide">Personal Blast</h1>
          <div className="gold-line mt-4 w-48" />
          <p className="text-gray-400 mt-4 text-sm leading-relaxed">
            Send a personalized text to your entire list. Every message uses the contact's name, address, and details — or schedule it for the perfect send time.
          </p>
        </div>

        {stage === 'compose' && (
          <div className="space-y-6">

            {/* Audience filters */}
            <div className="card-gold">
              <h3 className="field-label mb-4">Audience</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Source</label>
                  <select value={source} onChange={e => setSource(e.target.value)} className="field-input">
                    {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)} className="field-input">
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Message composer */}
            <div className="card-gold">
              <h3 className="field-label mb-4">Message</h3>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={6}
                placeholder="Hi {{firstName}}, this is Braddock calling about your property at {{address}}…"
                className="field-input resize-none mb-3"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] text-gray-300 tracking-widest uppercase mr-1">Insert:</span>
                {VARIABLES.map(v => (
                  <button
                    key={v}
                    onClick={() => insertVar(v)}
                    className="text-[10px] font-mono px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:border-yellow-500 hover:text-black transition-colors"
                    style={{ color: '#9A7A2E' }}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="mt-3 text-xs text-gray-400 text-right">{message.length} / 160 chars</div>
            </div>

            {/* MMS image */}
            <div className="card-gold">
              <h3 className="field-label mb-1">Image (MMS) <span className="text-gray-300 normal-case tracking-normal font-normal">— optional</span></h3>
              <p className="text-xs text-gray-400 mb-3">Attach a property photo. Paste a public image URL (from your website, MLS, etc.).</p>
              <input
                type="url"
                value={mediaUrl}
                onChange={e => setMediaUrl(e.target.value)}
                placeholder="https://example.com/property-photo.jpg"
                className="field-input"
              />
              {mediaUrl && (
                <div className="mt-3">
                  <img
                    src={mediaUrl}
                    alt="Preview"
                    className="max-h-32 rounded border border-gray-100 object-cover"
                    onError={e => (e.currentTarget.style.display = 'none')}
                  />
                </div>
              )}
            </div>

            {/* Send mode toggle */}
            <div className="card">
              <h3 className="field-label mb-3">Send Mode</h3>
              <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: '#E0E0E0' }}>
                {([['now','Send Now'],['scheduled','Schedule'],['ab','A/B Test']] as [Mode,string][]).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="flex-1 py-2.5 text-xs font-semibold tracking-widest uppercase transition-colors"
                    style={mode === m
                      ? { background: '#C9A84C', color: '#0A0A0A' }
                      : { background: 'white', color: '#999' }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'ab' && (
                <div className="mt-4 space-y-3">
                  <div className="text-xs text-gray-500">
                    Your list splits 50/50. Variant A uses the message above. Write Variant B below.
                  </div>
                  <div>
                    <label className="field-label">Variant B Message</label>
                    <textarea
                      value={messageB}
                      onChange={e => setMessageB(e.target.value)}
                      rows={4}
                      placeholder="Hi {{firstName}}, alternative message here…"
                      className="field-input resize-none mt-1"
                    />
                  </div>
                </div>
              )}

              {mode === 'scheduled' && (
                <div className="mt-4">
                  <label className="field-label">Date & Time</label>
                  <input
                    type="datetime-local"
                    min={minDateTime}
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    className="field-input"
                  />
                  <div className="text-xs text-gray-400 mt-1.5">
                    💡 Texts sent Tuesday–Thursday 9–11am get 3× more responses
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handlePreview}
              disabled={
                !message.trim() || loading ||
                (mode === 'scheduled' && !scheduledAt) ||
                (mode === 'ab' && !messageB.trim())
              }
              className="btn-gold w-full py-3"
            >
              {loading ? 'Loading…' : 'Preview & Continue →'}
            </button>
          </div>
        )}

        {stage === 'preview' && (
          <div className="space-y-6">
            <div className="card-gold">
              <h3 className="field-label mb-4">Preview</h3>

              <div className="text-center py-6 border-b border-gray-100 mb-6">
                <div className="text-5xl font-serif font-light text-black">{count}</div>
                <div className="text-[10px] text-gray-400 tracking-widest uppercase mt-1">Recipients</div>
                <div className="text-xs text-gray-400 mt-2">
                  {source ? SOURCE_OPTIONS.find(o => o.value === source)?.label : 'All sources'}
                  {status ? ` · ${STATUS_OPTIONS.find(o => o.value === status)?.label}` : ''}
                  {' '}· Excludes DNC
                </div>
                {mode === 'scheduled' && scheduledAt && (
                  <div className="mt-2 text-xs font-medium" style={{ color: '#9A7A2E' }}>
                    📅 Scheduled for {formatDT(new Date(scheduledAt).toISOString())}
                  </div>
                )}
              </div>

              <div>
                <div className="text-[9px] tracking-widest uppercase text-gray-400 mb-2">Sample message</div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg p-4 text-sm text-gray-800 leading-relaxed">
                  {preview}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStage('compose')} className="btn-ghost flex-1 py-3">← Back</button>
              <button
                onClick={mode === 'now' ? handleSendNow : mode === 'ab' ? handleAbSend : handleSchedule}
                disabled={count === 0}
                className="flex-1 py-3 text-white font-semibold rounded text-xs tracking-widest uppercase transition-colors disabled:opacity-30"
                style={{ background: count > 0 ? '#0A0A0A' : '#ccc' }}
              >
                {mode === 'now'       ? `Send to ${count} Contacts` :
                 mode === 'ab'        ? `A/B Test — ${count} Contacts` :
                                        `Schedule for ${count} Contacts`}
              </button>
            </div>
          </div>
        )}

        {stage === 'sending' && (
          <div className="card-gold text-center py-16">
            <div className="text-4xl font-serif font-light text-black mb-3">Sending…</div>
            <div className="text-gray-400 text-sm">Delivering personalized messages. Do not close this tab.</div>
            <div className="mt-6 w-8 h-8 border-2 border-gray-200 rounded-full animate-spin mx-auto"
                 style={{ borderTopColor: '#C9A84C' }} />
          </div>
        )}

        {stage === 'done' && mode === 'ab' && abResults && (
          <div className="space-y-4">
            <div className="card-gold py-8 px-6">
              <div className="text-center mb-6">
                <div className="text-2xl font-serif font-light text-black">A/B Test Complete</div>
                <div className="text-xs text-gray-400 mt-1">{abResults.a.total + abResults.b.total} contacts split 50/50</div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {(['a','b'] as const).map(v => (
                  <div key={v} className="border rounded-lg p-4 text-center"
                       style={{ borderColor: 'rgba(201,168,76,0.3)' }}>
                    <div className="text-[10px] tracking-widest uppercase mb-2" style={{ color: '#9A7A2E' }}>
                      Variant {v.toUpperCase()}
                    </div>
                    <div className="text-3xl font-light text-black">{abResults[v].sent}</div>
                    <div className="text-[9px] text-gray-400 tracking-widest uppercase mt-0.5">Sent</div>
                    {abResults[v].failed > 0 && (
                      <div className="text-xs text-red-400 mt-1">{abResults[v].failed} failed</div>
                    )}
                    <div className="mt-3 p-2 bg-gray-50 rounded text-xs text-gray-600 text-left leading-relaxed">
                      {abResults[v].message}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-400 text-center mt-4">
                Check the Inbox tab in 24–48 hours to compare reply rates between variants.
              </div>
            </div>
            <button onClick={reset} className="btn-gold-outline w-full py-3">Send Another Blast</button>
          </div>
        )}

        {stage === 'done' && mode !== 'ab' && (
          <div className="space-y-4">
            <div className="card-gold text-center py-12 space-y-6">
              {mode === 'scheduled' ? (
                <>
                  <div className="text-5xl" style={{ color: '#C9A84C' }}>📅</div>
                  <div>
                    <div className="text-2xl font-serif font-light text-black">Blast Scheduled</div>
                    <div className="text-sm text-gray-400 mt-1">
                      Will send to {count} contacts at {scheduledAt ? formatDT(new Date(scheduledAt).toISOString()) : ''}
                    </div>
                  </div>
                </>
              ) : results ? (
                <>
                  <div>
                    <div className="text-5xl font-serif font-light text-black">{results.sent}</div>
                    <div className="text-[10px] tracking-widest uppercase text-gray-400 mt-1">Messages Sent</div>
                  </div>
                  <div className="gold-line" />
                  <div className="flex justify-center gap-10 text-sm">
                    <div>
                      <div className="text-2xl font-light" style={{ color: '#9A7A2E' }}>{results.sent}</div>
                      <div className="text-[9px] tracking-widest uppercase text-gray-400">Delivered</div>
                    </div>
                    {results.failed > 0 && (
                      <div>
                        <div className="text-2xl font-light text-red-500">{results.failed}</div>
                        <div className="text-[9px] tracking-widest uppercase text-gray-400">Failed</div>
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
            <button onClick={reset} className="btn-gold-outline w-full py-3">Send Another Blast</button>
          </div>
        )}

        {/* ── Scheduled blasts list ───────────────────────── */}
        {scheduledBlasts.length > 0 && stage !== 'sending' && (
          <div className="mt-12">
            <div className="field-label mb-3">Scheduled Blasts</div>
            <div className="space-y-2">
              {scheduledBlasts.map(b => (
                <div key={b.id} className="card flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9px] tracking-widest uppercase font-semibold ${
                        b.status === 'pending'   ? 'text-yellow-700' :
                        b.status === 'sent'      ? 'text-green-600' : 'text-gray-400'
                      }`}>
                        {b.status}
                      </span>
                      <span className="text-xs text-gray-400">{formatDT(b.scheduledAt)}</span>
                    </div>
                    <div className="text-xs text-gray-600 truncate">{b.message}</div>
                    {b.status === 'sent' && b.sentCount !== undefined && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        {b.sentCount} sent · {b.failCount || 0} failed
                      </div>
                    )}
                  </div>
                  {b.status === 'pending' && (
                    <button
                      onClick={() => cancelScheduled(b.id)}
                      className="text-[9px] text-gray-300 hover:text-red-400 tracking-widest uppercase transition-colors flex-shrink-0"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
