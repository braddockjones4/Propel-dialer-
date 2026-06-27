import React, { useEffect, useState } from 'react';
import { API_BASE, authFetch } from '../config';


interface SequenceStep { delayMinutes: number; channel: 'sms'; message: string; }
interface Sequence { id: string; trigger: string; label: string; description: string; enabled: boolean; steps: SequenceStep[]; }

const VARIABLES = ['{{firstName}}', '{{fullName}}', '{{address}}', '{{agentName}}', '{{agentPhone}}'];

function delayLabel(m: number): string {
  if (m === 0)    return 'Immediately';
  if (m < 60)     return `${m} min`;
  if (m === 60)   return '1 hour';
  if (m < 1440)   return `${m / 60} hours`;
  if (m === 1440) return '24 hours';
  return `${m / 1440} days`;
}

export default function Sequences() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [saving, setSaving]       = useState<string | null>(null);
  const [saved, setSaved]         = useState<string | null>(null);

  useEffect(() => { authFetch(`${API_BASE}/sequences`).then(r => r.json()).then(setSequences).catch(console.error); }, []);

  async function save(seq: Sequence) {
    setSaving(seq.id);
    try {
      const res = await authFetch(`${API_BASE}/sequences/${seq.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(seq) });
      const updated = await res.json();
      setSequences(prev => prev.map(s => s.id === updated.id ? updated : s));
      setSaved(seq.id);
      setTimeout(() => setSaved(null), 2000);
    } finally { setSaving(null); }
  }

  function updateSequence(id: string, patch: Partial<Sequence>) {
    setSequences(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  }
  function updateStep(seqId: string, idx: number, patch: Partial<SequenceStep>) {
    setSequences(prev => prev.map(s => s.id !== seqId ? s : { ...s, steps: s.steps.map((st, i) => i === idx ? { ...st, ...patch } : st) }));
  }
  function addStep(seqId: string) {
    setSequences(prev => prev.map(s => s.id !== seqId ? s : { ...s, steps: [...s.steps, { delayMinutes: 1440, channel: 'sms', message: '' }] }));
  }
  function removeStep(seqId: string, idx: number) {
    setSequences(prev => prev.map(s => s.id !== seqId ? s : { ...s, steps: s.steps.filter((_, i) => i !== idx) }));
  }
  async function resetAll() {
    if (!confirm('Reset all sequences to defaults?')) return;
    setSequences(await (await authFetch(`${API_BASE}/sequences/reset`, { method: 'POST' })).json());
  }

  return (
    <div className="min-h-screen bg-gray-50 p-10">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="text-[9px] tracking-widest uppercase mb-2" style={{ color: 'rgba(154,122,46,0.7)' }}>Automation</div>
            <h1 className="text-3xl font-serif font-light text-black tracking-wide">Follow-Up Sequences</h1>
            <div className="gold-line mt-4 w-48" />
            <p className="text-gray-400 mt-4 text-sm leading-relaxed">
              Messages fire automatically based on call outcome. Use{' '}
              {VARIABLES.map(v => <code key={v} className="text-xs mx-0.5 font-mono" style={{ color: '#C9A84C' }}>{v}</code>)}.
            </p>
          </div>
          <button onClick={resetAll} className="text-[9px] text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 rounded px-3 py-1.5 tracking-widest uppercase transition-colors">
            Reset Defaults
          </button>
        </div>

        <div className="space-y-5">
          {sequences.map(seq => (
            <div key={seq.id} className="bg-white border border-gray-100 rounded-lg overflow-hidden"
                 style={{ borderColor: 'rgba(201,168,76,0.15)' }}>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                <div>
                  <span className="font-medium text-black tracking-wide text-sm">{seq.label}</span>
                  <span className="ml-3 text-xs text-gray-400">{seq.description}</span>
                </div>
                <div className="flex items-center gap-3">
                  {saved === seq.id && (
                    <span className="text-[9px] tracking-widest uppercase" style={{ color: '#C9A84C' }}>Saved ✓</span>
                  )}
                  <button onClick={() => save(seq)} disabled={saving === seq.id} className="btn-gold-outline py-1 px-3 text-[9px]">
                    {saving === seq.id ? 'Saving…' : 'Save'}
                  </button>
                  {/* Toggle */}
                  <button
                    onClick={() => updateSequence(seq.id, { enabled: !seq.enabled })}
                    className="relative w-9 h-[18px] rounded-full transition-colors"
                    style={{ background: seq.enabled ? '#C9A84C' : '#E0E0E0' }}
                  >
                    <span className="absolute top-0.5 left-0.5 w-[14px] h-[14px] rounded-full shadow transition-transform bg-white"
                          style={{ transform: seq.enabled ? 'translateX(18px)' : 'translateX(0)' }} />
                  </button>
                </div>
              </div>

              {/* Steps */}
              {seq.enabled && (
                <div className="p-5 space-y-3 bg-gray-50/50">
                  {seq.steps.map((step, i) => (
                    <div key={i} className="bg-white border border-gray-100 rounded-lg p-4"
                         style={{ borderColor: 'rgba(201,168,76,0.12)' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: 'rgba(154,122,46,0.7)' }}>SMS</span>
                          <select
                            value={step.delayMinutes}
                            onChange={e => updateStep(seq.id, i, { delayMinutes: Number(e.target.value) })}
                            className="text-xs border border-gray-200 text-gray-600 rounded px-2 py-1 focus:outline-none bg-gray-50"
                          >
                            {[0, 5, 15, 30, 60, 120, 360, 720, 1440, 2880, 4320, 10080].map(m => (
                              <option key={m} value={m}>{delayLabel(m)}</option>
                            ))}
                          </select>
                        </div>
                        {seq.steps.length > 1 && (
                          <button onClick={() => removeStep(seq.id, i)} className="text-[9px] text-gray-300 hover:text-red-500 tracking-widest uppercase transition-colors">
                            Remove
                          </button>
                        )}
                      </div>
                      <textarea
                        value={step.message}
                        onChange={e => updateStep(seq.id, i, { message: e.target.value })}
                        rows={3}
                        placeholder="Type your message… use {{firstName}}, {{address}}, etc."
                        className="field-input resize-none"
                      />
                    </div>
                  ))}
                  <button
                    onClick={() => addStep(seq.id)}
                    className="w-full text-[9px] text-gray-300 hover:text-black border border-dashed border-gray-200 hover:border-gray-400 rounded py-2.5 tracking-widest uppercase transition-colors"
                  >
                    + Add Step
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
