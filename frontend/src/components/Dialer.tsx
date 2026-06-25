import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTwilioDevice } from '../hooks/useTwilioDevice';
import DispositionPanel from './DispositionPanel';
import NextActionPanel from './NextActionPanel';
import type { Contact, DispositionType } from '../types';
import { API_BASE } from '../config';


function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const SOURCE_LABELS: Record<string, string> = {
  expired:       'Expired Listing',
  fsbo:          'FSBO',
  circle:        'Circle Prospect',
  'past-client': 'Past Client',
  manual:        'Manual',
};

const SCRIPTS: Record<string, string[]> = {
  expired: [
    "Hi, is this [Name]? Hi [Name], my name is Braddock and I am a real estate agent here in [City]. I noticed your home at [Address] was recently listed and did not sell. I specialize in this neighborhood and I have helped several owners in similar situations. I would love to share a few ideas that I think could get your home sold. Do you have two minutes?",
    "Objection — Taking a break: Totally understand. A lot of sellers take a step back and re-evaluate. When you do decide to move forward, what would be most important to you in choosing an agent?",
    "Close for appointment: I would love to stop by, take a look at the property, and share what I would do differently to get it sold. Would [day] or [day] work for a quick 20-minute walk-through?",
  ],
  fsbo: [
    "Hi, is this [Name]? Hi [Name], my name is Braddock. I saw that your home at [Address] is for sale by owner. I am a local agent and I work with a lot of buyers actively looking in this area right now. Would you be open to working with a buyer's agent?",
    "Objection — Commission: That is fair, and I totally respect that. If I brought you a qualified buyer who was ready to move, would that change your perspective at all?",
  ],
  circle: [
    "Hi, is this [Name]? Hi [Name], my name is Braddock, I am a real estate agent in the area. I just helped a neighbor sell their home and I wanted to reach out — I have buyers who love this neighborhood. Have you given any thought to selling in the next 6-12 months?",
  ],
  'past-client': [
    "Hi [Name]! It is Braddock, hope you are doing great. I am reaching out to check in — it has been a while and I wanted to see how you are enjoying the home. Is there anything I can help with? And if you know anyone thinking about buying or selling, I would love to help.",
  ],
  manual: [
    "Hi, is this [Name]? Hi [Name], my name is Braddock, I am a local real estate agent. I am reaching out because I wanted to connect. Do you have a minute to chat?",
  ],
};

function mapContact(c: Record<string, string>): Contact {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    name: `${c.firstName} ${c.lastName}`.trim(),
    phone: c.phone,
    address: c.address ? `${c.address}${c.city ? ', ' + c.city : ''}${c.state ? ', ' + c.state : ''}` : undefined,
    source: (c.source as Contact['source']) || 'manual',
    status: c.status,
  };
}

export default function Dialer() {
  const { deviceStatus, callStatus, callDuration, activeCall, startCall, endCall, muteCall, isMuted, errorMessage } = useTwilioDevice();

  const [contacts, setContacts]               = useState<Contact[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [currentContactIndex, setCurrentContactIndex] = useState(0);
  const [manualPhone, setManualPhone]         = useState('');
  const [sessionCalls, setSessionCalls]       = useState(0);
  const [dailyGoal, setDailyGoal]             = useState(50);
  const [hotLeads, setHotLeads]               = useState(0);
  const [notes, setNotes]                     = useState('');
  const [lastDisposition, setLastDisposition] = useState<DispositionType | null>(null);
  const [callHistory, setCallHistory]         = useState<Array<{ name: string; phone: string; disposition: DispositionType; duration: number }>>([]);
  const [scriptIndex, setScriptIndex]         = useState(0);
  const [vmDropped, setVmDropped]             = useState(false);
  const [autoAdvance, setAutoAdvance]         = useState(false);
  const [countdown, setCountdown]             = useState<number | null>(null);
  const [aiScript, setAiScript]               = useState<any>(null);
  const [aiScriptLoading, setAiScriptLoading] = useState(false);
  const [smartHoursWarning, setSmartHoursWarning] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Sort by lead score desc (hottest first)
    fetch(`${API_BASE}/contacts?limit=300`)
      .then(r => r.json())
      .then(data => {
        const sorted = [...data].sort((a: any, b: any) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
        setContacts(sorted.map(mapContact));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Load AI script whenever contact changes
  useEffect(() => {
    const contact = contacts[currentContactIndex];
    if (!contact) return;
    setAiScript(null);
    setAiScriptLoading(true);
    fetch(`${API_BASE}/ai-script/${contact.id}`)
      .then(r => r.json())
      .then(data => { setAiScript(data); setAiScriptLoading(false); })
      .catch(() => setAiScriptLoading(false));
  }, [currentContactIndex, contacts]);

  // Smart hours: check if it's an ok time to call (8am-9pm contact's local time)
  useEffect(() => {
    const contact = contacts[currentContactIndex];
    if (!contact?.phone) { setSmartHoursWarning(''); return; }
    const areaCode = contact.phone.replace(/\D/g,'').slice(contact.phone.replace(/\D/g,'').length > 10 ? 1 : 0, 4);
    // Simplified: eastern time zone for area codes 2xx-4xx, central for 5xx-6xx, mountain/pacific for 7xx-9xx
    const hour = new Date().getHours();
    if (hour < 8 || hour >= 21) {
      setSmartHoursWarning(`⚠ It's ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} — calling outside 8am–9pm may violate TCPA`);
    } else {
      setSmartHoursWarning('');
    }
  }, [currentContactIndex, contacts]);

  const currentContact = contacts[currentContactIndex] ?? null;
  const isInCall = callStatus === 'in-call' || callStatus === 'connecting' || callStatus === 'ringing';

  const handleDial = useCallback(async () => {
    const phone = currentContact?.phone || manualPhone;
    if (!phone) return;
    await startCall(phone);
    setSessionCalls(c => c + 1);
    setNotes('');
    setLastDisposition(null);
    setScriptIndex(0);
    setVmDropped(false);
  }, [currentContact, manualPhone, startCall]);

  const handleDisposition = useCallback(async (type: DispositionType) => {
    setLastDisposition(type);
    if (type === 'hot-lead') setHotLeads(h => h + 1);
    if (currentContact) {
      setCallHistory(h => [{ name: currentContact.name, phone: currentContact.phone, disposition: type, duration: callDuration }, ...h]);
      try {
        const twilioSid = (activeCall as any)?.parameters?.CallSid || undefined;
        await fetch(`${API_BASE}/contacts/${currentContact.id}/calls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration: callDuration, disposition: type, notes, twilioSid }),
        });
        if (type === 'hot-lead' || type === 'callback-scheduled') {
          await fetch(`${API_BASE}/twilio/disposition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              disposition: type === 'hot-lead' ? 'hot-lead' : 'callback',
              contact: {
                firstName: currentContact.firstName || currentContact.name.split(' ')[0],
                fullName: currentContact.name,
                address: currentContact.address || 'your property',
                phone: currentContact.phone,
              },
            }),
          });
        }
      } catch (err) { console.error('Failed to save call:', err); }
    }
    endCall();

    const advanceToNext = () => {
      if (currentContactIndex < contacts.length - 1) setCurrentContactIndex(i => i + 1);
      setLastDisposition(null);
      setNotes('');
      setVmDropped(false);
    };

    if (autoAdvance && currentContactIndex < contacts.length - 1) {
      // Start 3-second countdown then auto-dial
      setCountdown(3);
      let count = 3;
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) {
          clearInterval(countdownRef.current!);
          setCountdown(null);
          advanceToNext();
          // Auto-dial next contact after a brief pause for state to settle
          setTimeout(() => {
            const nextContact = contacts[currentContactIndex + 1];
            if (nextContact?.phone) startCall(nextContact.phone);
          }, 400);
        }
      }, 1000);
    } else {
      setTimeout(advanceToNext, 800);
    }
  }, [currentContact, callDuration, currentContactIndex, contacts, endCall, notes, autoAdvance, startCall]);

  const cancelAutoAdvance = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(null);
  };

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  const scripts     = currentContact ? (SCRIPTS[currentContact.source] || SCRIPTS.manual) : [];
  const sourceLabel = currentContact ? (SOURCE_LABELS[currentContact.source] || SOURCE_LABELS.manual) : null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Stats bar ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-8 py-3 bg-white border-b border-gray-100">
        <div className="flex items-center gap-10">
          {[
            { label: 'Calls Today', value: sessionCalls,                                    gold: false },
            { label: 'Hot Leads',   value: hotLeads,                                        gold: true  },
            { label: 'Queue',       value: `${currentContactIndex + 1}/${contacts.length}`, gold: false },
          ].map(stat => (
            <div key={stat.label}>
              <div className="text-2xl font-light tracking-tight"
                   style={{ color: stat.gold ? '#9A7A2E' : '#000' }}>
                {stat.value}
              </div>
              <div className="text-[10px] text-gray-400 tracking-widest uppercase mt-0.5">{stat.label}</div>
            </div>
          ))}
          {/* Daily goal bar */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-gray-400 tracking-widest uppercase">Goal</span>
              <input
                type="number" value={dailyGoal}
                onChange={e => setDailyGoal(Number(e.target.value))}
                className="w-10 text-[11px] text-center border-b border-gray-200 focus:outline-none bg-transparent"
              />
            </div>
            <div className="w-28 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all"
                   style={{ width: `${Math.min(100, (sessionCalls / dailyGoal) * 100)}%`, background: '#C9A84C' }} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Auto-advance toggle */}
          <button
            onClick={() => setAutoAdvance(a => !a)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium tracking-wider transition-all"
            style={autoAdvance
              ? { background: '#C9A84C', color: '#fff' }
              : { background: '#f3f4f6', color: '#6b7280' }}
          >
            ⚡ AUTO {autoAdvance ? 'ON' : 'OFF'}
          </button>
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${
              deviceStatus === 'ready'   ? 'bg-green-500 animate-pulse' :
              deviceStatus === 'loading' ? 'bg-gray-400' :
              deviceStatus === 'error'   ? 'bg-red-500' : 'bg-gray-300'
            }`} />
            <span className="text-[10px] text-gray-400 capitalize tracking-widest">{deviceStatus}</span>
          </div>
        </div>
      </div>

      {/* ── Smart hours / TCPA warning ──────────────────── */}
      {smartHoursWarning && (
        <div className="bg-amber-50 border-b border-amber-100 text-amber-700 text-xs px-8 py-2 tracking-wide font-medium">
          {smartHoursWarning}
        </div>
      )}

      {/* ── Auto-advance countdown banner ───────────────── */}
      {countdown !== null && (
        <div className="flex items-center justify-between bg-black text-white px-8 py-2 text-sm">
          <span>Auto-dialing next contact in <strong>{countdown}s</strong>…</span>
          <button onClick={cancelAutoAdvance} className="text-xs underline" style={{ color: '#C9A84C' }}>
            Cancel
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="bg-red-50 border-b border-red-100 text-red-600 text-xs px-8 py-2 tracking-wide">
          {errorMessage}
        </div>
      )}

      <div className="flex flex-1 min-h-0">

        {/* ── Left: Prospect card ───────────────────────── */}
        <div className="w-72 border-r border-gray-100 bg-white p-5 flex flex-col gap-5">
          {loading ? (
            <p className="text-gray-400 text-sm">Loading contacts…</p>
          ) : currentContact ? (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  {sourceLabel && (
                    <div className="text-[10px] tracking-widest uppercase"
                         style={{ color: 'rgba(154,122,46,0.7)' }}>
                      {sourceLabel}
                    </div>
                  )}
                  {/* Lead score badge */}
                  {currentContact.leadScore != null && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                         style={{
                           background: currentContact.leadScore >= 70 ? 'rgba(201,168,76,0.15)' : 'rgba(0,0,0,0.05)',
                           color:      currentContact.leadScore >= 70 ? '#9A7A2E' : '#6b7280',
                           border:     currentContact.leadScore >= 70 ? '1px solid rgba(201,168,76,0.3)' : '1px solid rgba(0,0,0,0.08)',
                         }}>
                      🔥 {currentContact.leadScore}
                    </div>
                  )}
                </div>
                <h2 className="text-xl font-light text-black tracking-wide">{currentContact.name}</h2>
                <p className="font-mono text-sm mt-1" style={{ color: '#C9A84C' }}>{currentContact.phone}</p>
                {currentContact.address && (
                  <p className="text-gray-400 text-xs mt-1.5 leading-relaxed">{currentContact.address}</p>
                )}
              </div>

              <div className="gold-line" />

              {/* Call controls */}
              <div className="flex flex-col gap-2">
                {!isInCall && callStatus !== 'completed' ? (
                  <button onClick={handleDial} disabled={deviceStatus !== 'ready'} className="btn-gold w-full py-3">
                    Dial
                  </button>
                ) : isInCall ? (
                  <>
                    <div className="text-center py-2">
                      <div className="text-3xl font-light tracking-widest text-black font-mono">
                        {callStatus === 'connecting' ? 'Connecting' :
                         callStatus === 'ringing'    ? 'Ringing' :
                         formatDuration(callDuration)}
                      </div>
                      <div className="text-[10px] tracking-widest uppercase mt-1" style={{ color: '#C9A84C' }}>
                        {callStatus === 'in-call' ? 'Live' : callStatus}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => muteCall(!isMuted)} className={`flex-1 btn-ghost py-2 text-xs ${isMuted ? 'border-red-300 text-red-500' : ''}`}>
                        {isMuted ? 'Unmute' : 'Mute'}
                      </button>
                      <button onClick={endCall} className="flex-1 btn-danger py-2 text-xs">Hang Up</button>
                    </div>
                    {/* Voicemail drop */}
                    <button
                      disabled={vmDropped}
                      onClick={async () => {
                        const callSid = (activeCall as any)?.parameters?.CallSid;
                        if (!callSid) return;
                        await fetch(`${API_BASE}/twilio/voicemail-drop`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ callSid }),
                        });
                        setVmDropped(true);
                        setTimeout(() => endCall(), 1000);
                      }}
                      className="w-full text-[10px] tracking-widest uppercase py-2 rounded border transition-colors disabled:opacity-30"
                      style={{ borderColor: 'rgba(201,168,76,0.4)', color: '#9A7A2E' }}
                    >
                      {vmDropped ? 'Voicemail Dropped ✓' : 'Drop Voicemail'}
                    </button>
                  </>
                ) : (
                  <div className="text-center py-2 text-[10px] tracking-widest text-gray-400 uppercase">
                    {lastDisposition ? <span style={{ color: '#C9A84C' }}>Logged ✓</span> : 'Log outcome →'}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="field-label">Call Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Notes during the call…"
                  rows={4}
                  className="field-input resize-none"
                />
              </div>

              <button
                onClick={() => setCurrentContactIndex(i => Math.min(i + 1, contacts.length - 1))}
                disabled={isInCall}
                className="text-[10px] text-gray-300 hover:text-black tracking-widest uppercase transition-colors disabled:opacity-30"
              >
                Skip →
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-gray-400 text-sm">No contacts. Enter a number manually.</p>
              <input type="tel" value={manualPhone} onChange={e => setManualPhone(e.target.value)} placeholder="+1 (555) 000-0000" className="field-input" />
              <button onClick={handleDial} disabled={deviceStatus !== 'ready' || !manualPhone} className="btn-gold">Dial</button>
            </div>
          )}
        </div>

        {/* ── Center: AI Script ──────────────────────────── */}
        <div className="flex-1 flex flex-col gap-4 p-6 overflow-y-auto bg-gray-50">
          <div className="card-gold flex-1">
            <div className="flex items-center justify-between mb-4">
              <h3 className="field-label flex items-center gap-2">
                <span>AI Script</span>
                {aiScript?.cached && <span className="text-[9px] text-gray-300 tracking-widest">CACHED</span>}
                {aiScriptLoading && <span className="text-[9px]" style={{ color: '#C9A84C' }}>GENERATING…</span>}
              </h3>
              <button
                onClick={() => {
                  if (!currentContact) return;
                  setAiScript(null);
                  setAiScriptLoading(true);
                  fetch(`${API_BASE}/ai-script/${currentContact.id}?refresh=true`)
                    .then(r => r.json()).then(d => { setAiScript(d); setAiScriptLoading(false); })
                    .catch(() => setAiScriptLoading(false));
                }}
                className="text-[9px] tracking-widest uppercase hover:underline"
                style={{ color: '#C9A84C' }}
              >↺ Refresh</button>
            </div>

            {aiScript ? (
              <div className="space-y-3">
                {/* Opener */}
                <div className="p-4 rounded border" style={{ borderColor: 'rgba(201,168,76,0.3)', background: 'rgba(201,168,76,0.04)' }}>
                  <span className="text-[9px] font-bold tracking-widest uppercase block mb-1.5" style={{ color: '#C9A84C' }}>
                    Opener
                  </span>
                  <span className="text-sm leading-relaxed text-gray-800">{aiScript.opener}</span>
                </div>

                {/* Objections */}
                {aiScript.objections?.map((obj: any, i: number) => (
                  <div key={i} className="p-3 rounded cursor-pointer transition-all hover:bg-white border border-transparent hover:border-gray-100">
                    <span className="text-[9px] font-bold tracking-widest uppercase block mb-1" style={{ color: '#999' }}>
                      If they say: "{obj.trigger}"
                    </span>
                    <span className="text-xs leading-relaxed text-gray-600">{obj.response}</span>
                  </div>
                ))}

                {/* Close */}
                <div className="p-3 rounded border border-gray-100 bg-white">
                  <span className="text-[9px] font-bold tracking-widest uppercase block mb-1" style={{ color: '#C9A84C' }}>
                    Close Attempt
                  </span>
                  <span className="text-xs leading-relaxed text-gray-700">{aiScript.closeAttempt}</span>
                </div>

                {/* Coaching tip */}
                {aiScript.tip && (
                  <div className="p-3 rounded bg-gray-50 border border-gray-100">
                    <span className="text-[9px] font-bold tracking-widest uppercase block mb-1 text-gray-400">
                      Coach Tip
                    </span>
                    <span className="text-xs text-gray-500 leading-relaxed">{aiScript.tip}</span>
                  </div>
                )}
              </div>
            ) : aiScriptLoading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => (
                  <div key={i} className="h-16 rounded animate-pulse" style={{ background: 'rgba(201,168,76,0.06)' }} />
                ))}
              </div>
            ) : (
              <p className="text-gray-300 text-sm">Select a contact to generate script.</p>
            )}
          </div>

          {callHistory.length > 0 && (
            <div className="card">
              <h3 className="field-label mb-3">Session Log</h3>
              <div className="space-y-2">
                {callHistory.slice(0, 6).map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-800 font-medium w-36 truncate">{c.name}</span>
                    <span className="text-gray-400 font-mono">{formatDuration(c.duration)}</span>
                    <span className="text-gray-500 capitalize tracking-wide">{c.disposition.replace(/-/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Disposition + AI Next Action ────────── */}
        <div className="w-56 border-l border-gray-100 p-4 bg-white flex flex-col gap-4">
          <DispositionPanel
            onDisposition={handleDisposition}
            disabled={isInCall || (callStatus === 'idle' && lastDisposition !== null)}
          />

          {/* AI Next Action — shows after call ends */}
          {lastDisposition && currentContact && (
            <NextActionPanel contactId={currentContact.id} onBook={() => {/* future: open appointment modal */}} />
          )}
        </div>
      </div>
    </div>
  );
}
