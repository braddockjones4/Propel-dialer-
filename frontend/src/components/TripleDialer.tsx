import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTwilioDevice } from '../hooks/useTwilioDevice';
import DispositionPanel from './DispositionPanel';
import type { DispositionType } from '../types';
import { API_BASE, authFetch } from '../config';


interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  source: string;
  status: string;
}

interface CallRecord {
  sid: string;
  contactId: string;
  phone: string;
  firstName: string;
  name: string;
  status: 'initiated' | 'ringing' | 'connected' | 'cancelled' | 'failed' | 'machine';
}

interface Session {
  sessionId: string;
  calls: CallRecord[];
  connectedSid: string | null;
}

function formatDuration(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

const STATUS_COLOR: Record<string, string> = {
  initiated: '#A0A0A0',
  ringing:   '#C9A84C',
  connected: '#22C55E',
  cancelled: '#666',
  failed:    '#EF4444',
  machine:   '#888',
};

export default function TripleDialer() {
  const { deviceStatus, callStatus, callDuration, endCall, errorMessage } = useTwilioDevice();

  const [contacts, setContacts]     = useState<Contact[]>([]);
  const [index, setIndex]           = useState(0);
  const [session, setSession]       = useState<Session | null>(null);
  const [connectedContact, setConnectedContact] = useState<Contact | null>(null);
  const [dialing, setDialing]       = useState(false);
  const [sessionCalls, setSessionCalls] = useState(0);
  const [hotLeads, setHotLeads]     = useState(0);
  const [notes, setNotes]           = useState('');
  const [lastDisp, setLastDisp]     = useState<DispositionType | null>(null);
  const pollRef                     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load contacts
  useEffect(() => {
    authFetch(`${API_BASE}/contacts?limit=300`)
      .then(r => r.json())
      .then(setContacts)
      .catch(console.error);
  }, []);

  // Get next 3 contacts from current index
  const nextThree = contacts.slice(index, index + 3);

  // Poll session status until a call connects
  const startPolling = useCallback((sessionId: string, calls: CallRecord[]) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const data: Session = await authFetch(`${API_BASE}/triple-dial/session/${sessionId}`).then(r => r.json());
        setSession(data);
        if (data.connectedSid) {
          clearInterval(pollRef.current!);
          const connected = calls.find(c => c.sid === data.connectedSid);
          if (connected) {
            const contact = contacts.find(c => c.id === connected.contactId);
            setConnectedContact(contact || null);
            setSessionCalls(n => n + 1);
          }
        }
        // Stop polling if all calls are done
        const allDone = data.calls.every(c => ['connected','cancelled','failed','machine'].includes(c.status));
        if (allDone && !data.connectedSid) {
          clearInterval(pollRef.current!);
          setDialing(false);
        }
      } catch (e) { /* ignore */ }
    }, 800);
  }, [contacts]);

  // Start triple dial
  const handleTripleDial = async () => {
    if (nextThree.length === 0 || deviceStatus !== 'ready') return;
    setDialing(true);
    setSession(null);
    setConnectedContact(null);
    setNotes('');
    setLastDisp(null);

    const payload = nextThree.map(c => ({
      phone:     c.phone,
      contactId: c.id,
      firstName: c.firstName,
      name:      `${c.firstName} ${c.lastName}`,
    }));

    try {
      const data = await authFetch(`${API_BASE}/triple-dial/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: payload }),
      }).then(r => r.json());

      setSession({ sessionId: data.sessionId, calls: data.calls, connectedSid: null });
      startPolling(data.sessionId, data.calls);
    } catch (err) {
      console.error('Triple dial failed:', err);
      setDialing(false);
    }
  };

  // Log disposition and advance
  const handleDisposition = async (type: DispositionType) => {
    setLastDisp(type);
    if (type === 'hot-lead') setHotLeads(h => h + 1);

    if (connectedContact) {
      try {
        await authFetch(`${API_BASE}/contacts/${connectedContact.id}/calls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration: callDuration, disposition: type, notes }),
        });
      } catch (e) { /* ignore */ }
    }

    endCall();
    setTimeout(() => {
      setIndex(i => i + 3); // advance by 3
      setSession(null);
      setConnectedContact(null);
      setDialing(false);
      setLastDisp(null);
    }, 600);
  };

  // Cancel session
  const handleCancel = async () => {
    if (session) {
      await authFetch(`${API_BASE}/triple-dial/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
    }
    if (pollRef.current) clearInterval(pollRef.current);
    endCall();
    setDialing(false);
    setSession(null);
    setConnectedContact(null);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const isInCall     = callStatus === 'in-call';
  const isConnecting = dialing && !connectedContact;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Stats */}
      <div className="flex items-center justify-between px-8 py-3 bg-white border-b" style={{ borderColor: 'rgba(201,168,76,0.15)' }}>
        <div className="flex items-center gap-10">
          {[
            { label: 'Calls',     value: sessionCalls },
            { label: 'Hot Leads', value: hotLeads, gold: true },
            { label: 'Progress',  value: `${index}/${contacts.length}` },
          ].map(s => (
            <div key={s.label}>
              <div className="text-2xl font-light" style={s.gold ? { color: '#9A7A2E' } : { color: '#0A0A0A' }}>{s.value}</div>
              <div className="text-[10px] text-gray-400 tracking-widest uppercase">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-semibold tracking-widest uppercase px-2 py-0.5 rounded border"
               style={{ borderColor: 'rgba(201,168,76,0.4)', color: '#9A7A2E', background: 'rgba(201,168,76,0.06)' }}>
            Triple Line
          </div>
          <div className={`w-1.5 h-1.5 rounded-full ml-2 ${deviceStatus === 'ready' ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
          <span className="text-[10px] text-gray-400 capitalize">{deviceStatus}</span>
        </div>
      </div>

      {errorMessage && (
        <div className="bg-red-50 border-b border-red-100 text-red-500 text-xs px-8 py-2">{errorMessage}</div>
      )}

      <div className="flex flex-1 min-h-0">

        {/* Left: 3 contact cards */}
        <div className="w-80 border-r border-gray-100 bg-white p-4 flex flex-col gap-3">
          <div className="field-label mb-2">Next 3 Contacts</div>

          {nextThree.length === 0 ? (
            <p className="text-gray-400 text-sm">No more contacts.</p>
          ) : nextThree.map((c, i) => {
            const callRecord = session?.calls.find(r => r.contactId === c.id);
            const status = callRecord?.status;
            return (
              <div key={c.id} className="rounded-lg border p-3 transition-all"
                   style={{
                     borderColor: status === 'connected' ? '#22C55E' :
                                  status === 'ringing'   ? '#C9A84C' :
                                  status === 'machine'   ? '#999' :
                                  status === 'failed'    ? '#EF4444' : '#E8E8E8',
                     background: status === 'connected' ? 'rgba(34,197,94,0.04)' :
                                 status === 'ringing'   ? 'rgba(201,168,76,0.04)' : 'white',
                   }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-black">{c.firstName} {c.lastName}</span>
                  {status && (
                    <span className="text-[9px] tracking-widest uppercase font-semibold"
                          style={{ color: STATUS_COLOR[status] }}>
                      {status}
                    </span>
                  )}
                  {!status && (
                    <span className="text-[9px] text-gray-300 tracking-widest uppercase">Line {i + 1}</span>
                  )}
                </div>
                <div className="text-xs font-mono" style={{ color: '#C9A84C' }}>{c.phone}</div>
                {c.address && <div className="text-xs text-gray-400 mt-0.5 truncate">{c.address}</div>}
              </div>
            );
          })}

          <div className="gold-line mt-1" />

          {/* Dial controls */}
          {!dialing && callStatus !== 'in-call' ? (
            <button
              onClick={handleTripleDial}
              disabled={deviceStatus !== 'ready' || nextThree.length === 0}
              className="btn-gold w-full py-3 mt-1"
            >
              Triple Dial
            </button>
          ) : isConnecting ? (
            <div className="space-y-3 mt-1">
              <div className="text-center">
                <div className="text-lg font-light text-black tracking-widest">Dialing 3 Lines…</div>
                <div className="flex justify-center gap-1.5 mt-2">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
                         style={{ background: '#C9A84C', animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              </div>
              <button onClick={handleCancel} className="btn-danger w-full py-2 text-xs">Cancel</button>
            </div>
          ) : isInCall && connectedContact ? (
            <div className="space-y-2 mt-1">
              <div className="text-center">
                <div className="text-xs text-gray-400 tracking-widest uppercase mb-1">Connected</div>
                <div className="font-medium text-black">{connectedContact.firstName} {connectedContact.lastName}</div>
                <div className="text-2xl font-light font-mono text-black mt-1">{formatDuration(callDuration)}</div>
              </div>
              <button onClick={() => endCall()} className="btn-danger w-full py-2 text-xs">Hang Up</button>
            </div>
          ) : (
            <div className="text-center text-xs text-gray-400 tracking-widest uppercase mt-2">
              {lastDisp ? <span style={{ color: '#C9A84C' }}>Logged ✓</span> : 'Log outcome →'}
            </div>
          )}

          {/* Notes */}
          {(isInCall || lastDisp) && (
            <div className="mt-1">
              <label className="field-label">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="field-input resize-none" placeholder="Call notes…" />
            </div>
          )}

          <button
            onClick={() => { setIndex(i => i + 3); setSession(null); setConnectedContact(null); setDialing(false); }}
            disabled={dialing}
            className="text-[9px] text-gray-300 hover:text-black tracking-widest uppercase transition-colors disabled:opacity-30"
          >
            Skip 3 →
          </button>
        </div>

        {/* Center: status display */}
        <div className="flex-1 p-6 bg-gray-50 overflow-y-auto">
          {session ? (
            <div className="max-w-lg mx-auto space-y-4">
              <h3 className="field-label">Live Lines</h3>
              {session.calls.map((c, i) => (
                <div key={c.sid} className="card-gold flex items-center justify-between">
                  <div>
                    <div className="font-medium text-black text-sm">{c.name}</div>
                    <div className="text-xs font-mono mt-0.5" style={{ color: '#C9A84C' }}>{c.phone}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[9px] tracking-widest uppercase font-semibold"
                          style={{ color: STATUS_COLOR[c.status] }}>
                      {c.status}
                    </span>
                    {c.status === 'ringing' && (
                      <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#C9A84C' }} />
                    )}
                    {c.status === 'connected' && (
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    )}
                  </div>
                </div>
              ))}

              {connectedContact && isInCall && (
                <div className="card text-center py-6" style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
                  <div className="text-[10px] tracking-widest uppercase text-green-500 mb-2">Live Call</div>
                  <div className="text-2xl font-serif font-light text-black">{connectedContact.firstName} {connectedContact.lastName}</div>
                  <div className="text-3xl font-light font-mono mt-2">{formatDuration(callDuration)}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-4xl font-serif font-light text-gray-200 mb-3">Triple Line</div>
                <div className="text-gray-300 text-sm max-w-xs">
                  Dials 3 contacts simultaneously. The first human to answer connects — the others drop automatically.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Disposition */}
        <div className="w-52 border-l border-gray-100 p-4 bg-white">
          <DispositionPanel
            onDisposition={handleDisposition}
            disabled={!isInCall || !connectedContact}
          />
        </div>
      </div>
    </div>
  );
}
