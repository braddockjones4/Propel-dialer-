import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTwilioDevice } from '../hooks/useTwilioDevice';
import DispositionPanel from './DispositionPanel';
import NextActionPanel from './NextActionPanel';
import type { Contact, DispositionType } from '../types';
import { API_BASE, authFetch } from '../config';

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

const SOURCE_COLORS: Record<string, string> = {
  expired:       '#ef4444',
  fsbo:          '#3b82f6',
  circle:        '#8b5cf6',
  'past-client': '#10b981',
  manual:        '#9ca3af',
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

// Disposition emoji map for the session log
const DISP_EMOJI: Record<string, string> = {
  'not-home': '📵', 'left-voicemail': '📬', 'callback-scheduled': '📅',
  'not-interested': '👎', 'wrong-number': '🔢', 'dnc': '🚫', 'hot-lead': '🔥',
};

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
  const [vmDropped, setVmDropped]             = useState(false);
  const [autoAdvance, setAutoAdvance]         = useState(false);
  const [countdown, setCountdown]             = useState<number | null>(null);
  const [aiScript, setAiScript]               = useState<any>(null);
  const [aiScriptLoading, setAiScriptLoading] = useState(false);
  const [smartHoursWarning, setSmartHoursWarning] = useState('');
  const [searchQuery, setSearchQuery]         = useState('');
  const [searchOpen, setSearchOpen]           = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const searchResults = searchQuery.trim().length > 0
    ? contacts.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery)).slice(0, 8)
    : [];

  const jumpToContact = (index: number) => {
    setCurrentContactIndex(index);
    setLastDisposition(null);
    setNotes('');
    setVmDropped(false);
    setSearchQuery('');
    setSearchOpen(false);
  };

  useEffect(() => {
    authFetch(`${API_BASE}/contacts?limit=300`)
      .then(r => r.json())
      .then(data => {
        const arr = Array.isArray(data) ? data : [];
        const sorted = [...arr].sort((a: any, b: any) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
        setContacts(sorted.map(mapContact));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const contact = contacts[currentContactIndex];
    if (!contact) return;
    setAiScript(null);
    setAiScriptLoading(true);
    authFetch(`${API_BASE}/ai-script/${contact.id}`)
      .then(r => r.json())
      .then(data => { setAiScript(data); setAiScriptLoading(false); })
      .catch(() => setAiScriptLoading(false));
  }, [currentContactIndex, contacts]);

  useEffect(() => {
    const contact = contacts[currentContactIndex];
    if (!contact?.phone) { setSmartHoursWarning(''); return; }
    const hour = new Date().getHours();
    if (hour < 8 || hour >= 21) {
      setSmartHoursWarning(`It's ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} — calling outside 8am–9pm may violate TCPA`);
    } else {
      setSmartHoursWarning('');
    }
  }, [currentContactIndex, contacts]);

  const currentContact = contacts[currentContactIndex] ?? null;
  const isInCall = callStatus === 'in-call' || callStatus === 'connecting' || callStatus === 'ringing';
  const isPostCall = callStatus === 'completed' || callStatus === 'idle';
  const showDisposition = isPostCall && !lastDisposition && sessionCalls > 0;

  const handleDial = useCallback(async () => {
    const phone = currentContact?.phone || manualPhone;
    if (!phone) return;
    await startCall(phone);
    setSessionCalls(c => c + 1);
    setNotes('');
    setLastDisposition(null);
    setVmDropped(false);
  }, [currentContact, manualPhone, startCall]);

  const handleDisposition = useCallback(async (type: DispositionType) => {
    setLastDisposition(type);
    if (type === 'hot-lead') setHotLeads(h => h + 1);
    if (currentContact) {
      setCallHistory(h => [{ name: currentContact.name, phone: currentContact.phone, disposition: type, duration: callDuration }, ...h]);
      try {
        const twilioSid = (activeCall as any)?.parameters?.CallSid || undefined;
        await authFetch(`${API_BASE}/contacts/${currentContact.id}/calls`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration: callDuration, disposition: type, notes, twilioSid }),
        });
        if (type === 'hot-lead' || type === 'callback-scheduled') {
          await authFetch(`${API_BASE}/twilio/disposition`, {
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

  const sourceLabel = currentContact ? (SOURCE_LABELS[currentContact.source] || SOURCE_LABELS.manual) : null;
  const sourceColor = currentContact ? (SOURCE_COLORS[currentContact.source] || SOURCE_COLORS.manual) : '#9ca3af';

  // Progress percent through queue
  const queuePercent = contacts.length > 0 ? Math.round((currentContactIndex / contacts.length) * 100) : 0;

  return (
    <div style={{ minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column' }}>

      {/* ── Stats bar ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', background: '#fff',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          {/* Session stats */}
          {[
            { label: 'Calls Today', value: sessionCalls, gold: false },
            { label: 'Hot Leads',   value: hotLeads,     gold: true  },
          ].map(stat => (
            <div key={stat.label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: '-0.5px', color: stat.gold ? '#9A7A2E' : '#111', lineHeight: 1 }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 9, color: '#aaa', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>
                {stat.label}
              </div>
            </div>
          ))}

          {/* Queue progress */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 9, color: '#aaa', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Queue</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#555' }}>
                {currentContactIndex + 1} / {contacts.length}
              </span>
            </div>
            <div style={{ width: 80, height: 3, background: '#eee', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${queuePercent}%`, background: '#C9A84C', borderRadius: 99, transition: 'width 0.4s' }} />
            </div>
          </div>

          {/* Daily goal — desktop only */}
          <div className="hidden sm:flex" style={{ flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: '#aaa', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Daily Goal</span>
              <input
                type="number" value={dailyGoal}
                onChange={e => setDailyGoal(Number(e.target.value))}
                style={{ width: 36, fontSize: 10, textAlign: 'center', border: 'none', borderBottom: '1px solid #e5e7eb', background: 'transparent', outline: 'none', color: '#555' }}
              />
            </div>
            <div style={{ width: 80, height: 3, background: '#eee', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, (sessionCalls / dailyGoal) * 100)}%`, background: sessionCalls >= dailyGoal ? '#10b981' : '#C9A84C', borderRadius: 99, transition: 'width 0.4s' }} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Auto-advance toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#aaa', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Auto</span>
            <button
              onClick={() => setAutoAdvance(a => !a)}
              style={{
                position: 'relative', width: 36, height: 18, borderRadius: 99, border: 'none', cursor: 'pointer',
                background: autoAdvance ? '#C9A84C' : '#e5e7eb', transition: 'background 0.25s',
              }}
            >
              <span style={{
                position: 'absolute', top: 2, left: autoAdvance ? 18 : 2,
                width: 14, height: 14, borderRadius: '50%', background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s',
              }} />
            </button>
          </div>

          {/* Device status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: deviceStatus === 'ready' ? '#10b981' : deviceStatus === 'error' ? '#ef4444' : '#d1d5db',
              boxShadow: deviceStatus === 'ready' ? '0 0 0 2px rgba(16,185,129,0.2)' : 'none',
            }} />
            <span style={{ fontSize: 9, color: '#aaa', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {deviceStatus === 'ready' ? 'Ready' : deviceStatus === 'loading' ? 'Connecting…' : deviceStatus === 'error' ? 'Error' : deviceStatus}
            </span>
          </div>
        </div>
      </div>

      {/* ── Banners ────────────────────────────────────────── */}
      {smartHoursWarning && (
        <div style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#92400e', fontSize: 11, padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
          ⚠️ <span>{smartHoursWarning}</span>
        </div>
      )}
      {countdown !== null && (
        <div style={{ background: '#111', color: '#fff', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13 }}>Auto-dialing next contact in <strong style={{ color: '#C9A84C' }}>{countdown}s</strong>…</span>
          <button onClick={cancelAutoAdvance} style={{ fontSize: 11, color: '#C9A84C', background: 'none', border: '1px solid rgba(201,168,76,0.4)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      )}
      {errorMessage && (
        <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#dc2626', fontSize: 11, padding: '8px 20px' }}>
          ⚠️ {errorMessage}
        </div>
      )}

      {/* ── Main layout ────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* ── LEFT: Contact card ───────────────────────────── */}
        <div style={{
          width: 280, flexShrink: 0,
          borderRight: '1px solid rgba(0,0,0,0.06)',
          background: '#fff',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
          className="w-full md:w-[280px]"
        >
          {/* ── Search / Jump to Contact ── */}
          <div ref={searchRef} style={{ padding: '10px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)', position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: '#bbb', pointerEvents: 'none' }}>🔍</span>
              <input
                type="text"
                placeholder="Jump to contact…"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                disabled={isInCall}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '7px 10px 7px 28px',
                  border: '1px solid #e5e7eb', borderRadius: 7,
                  fontSize: 12, color: '#374151', outline: 'none', background: '#fafafa',
                  opacity: isInCall ? 0.4 : 1,
                  cursor: isInCall ? 'not-allowed' : 'text',
                }}
              />
            </div>
            {searchOpen && searchResults.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 12, right: 12, zIndex: 50,
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.1)', overflow: 'hidden',
              }}>
                {searchResults.map(contact => {
                  const idx = contacts.indexOf(contact);
                  return (
                    <button
                      key={contact.id}
                      onClick={() => jumpToContact(idx)}
                      style={{
                        width: '100%', textAlign: 'left', padding: '9px 12px',
                        background: idx === currentContactIndex ? 'rgba(201,168,76,0.07)' : '#fff',
                        border: 'none', borderBottom: '1px solid #f5f5f5',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(201,168,76,0.05)')}
                      onMouseLeave={e => (e.currentTarget.style.background = idx === currentContactIndex ? 'rgba(201,168,76,0.07)' : '#fff')}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact.name}</div>
                        <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>{contact.phone}</div>
                      </div>
                      <div style={{ fontSize: 9, color: '#ccc', flexShrink: 0 }}>#{idx + 1}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {searchOpen && searchQuery.trim().length > 0 && searchResults.length === 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 12, right: 12, zIndex: 50,
                background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.1)', padding: '12px',
                fontSize: 11, color: '#9ca3af', textAlign: 'center',
              }}>
                No contacts match "{searchQuery}"
              </div>
            )}
          </div>

          {loading ? (
            <div style={{ padding: 24 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 16, background: '#f3f4f6', borderRadius: 4, marginBottom: 10, width: i === 1 ? '60%' : i === 2 ? '40%' : '80%' }} className="animate-pulse" />
              ))}
            </div>
          ) : currentContact ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>

              {/* Contact header */}
              <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                {/* Source badge + lead score */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                    padding: '2px 8px', borderRadius: 99,
                    background: `${sourceColor}15`,
                    color: sourceColor,
                    border: `1px solid ${sourceColor}30`,
                  }}>
                    {sourceLabel}
                  </span>
                  {currentContact.leadScore != null && (
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      padding: '2px 8px', borderRadius: 99,
                      background: currentContact.leadScore >= 70 ? 'rgba(201,168,76,0.12)' : 'rgba(0,0,0,0.04)',
                      color: currentContact.leadScore >= 70 ? '#9A7A2E' : '#9ca3af',
                      border: `1px solid ${currentContact.leadScore >= 70 ? 'rgba(201,168,76,0.3)' : 'rgba(0,0,0,0.08)'}`,
                    }}>
                      {currentContact.leadScore >= 70 ? '🔥 ' : ''}{currentContact.leadScore}
                    </span>
                  )}
                </div>

                <h2 style={{ fontSize: 22, fontWeight: 300, color: '#111', letterSpacing: '0.02em', margin: 0, lineHeight: 1.2 }}>
                  {currentContact.name}
                </h2>
                <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#C9A84C', marginTop: 6, letterSpacing: '0.05em' }}>
                  {currentContact.phone}
                </div>
                {currentContact.address && (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4, lineHeight: 1.5 }}>
                    📍 {currentContact.address}
                  </div>
                )}
              </div>

              {/* ── IDLE: Call button ── */}
              {!isInCall && callStatus !== 'completed' && (
                <div style={{ padding: '20px 20px 0' }}>
                  <button
                    onClick={handleDial}
                    disabled={deviceStatus !== 'ready'}
                    style={{
                      width: '100%',
                      padding: '14px 0',
                      borderRadius: 10,
                      border: 'none',
                      background: deviceStatus !== 'ready' ? '#e5e7eb' : 'linear-gradient(135deg, #C9A84C, #e8c96e)',
                      color: deviceStatus !== 'ready' ? '#9ca3af' : '#fff',
                      fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                      cursor: deviceStatus !== 'ready' ? 'not-allowed' : 'pointer',
                      boxShadow: deviceStatus !== 'ready' ? 'none' : '0 4px 14px rgba(201,168,76,0.35)',
                      transition: 'all 0.2s',
                    }}
                  >
                    📞 Call {currentContact.firstName || currentContact.name.split(' ')[0]}
                  </button>
                  {deviceStatus !== 'ready' && (
                    <p style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center', marginTop: 8, letterSpacing: '0.05em' }}>
                      {deviceStatus === 'loading' ? 'Setting up phone…' : 'Device not ready'}
                    </p>
                  )}
                </div>
              )}

              {/* ── IN-CALL state ── */}
              {isInCall && (
                <div style={{ padding: '16px 20px 0' }}>
                  {/* Live indicator */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '10px 0', marginBottom: 12,
                    background: callStatus === 'in-call' ? 'rgba(239,68,68,0.06)' : 'rgba(201,168,76,0.06)',
                    borderRadius: 8, border: `1px solid ${callStatus === 'in-call' ? 'rgba(239,68,68,0.2)' : 'rgba(201,168,76,0.2)'}`,
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: callStatus === 'in-call' ? '#ef4444' : '#C9A84C',
                      boxShadow: callStatus === 'in-call' ? '0 0 0 3px rgba(239,68,68,0.2)' : '0 0 0 3px rgba(201,168,76,0.2)',
                      animation: 'pulse 1.5s infinite',
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: callStatus === 'in-call' ? '#ef4444' : '#9A7A2E' }}>
                      {callStatus === 'connecting' ? 'Connecting…' : callStatus === 'ringing' ? 'Ringing…' : 'Live'}
                    </span>
                    {callStatus === 'in-call' && (
                      <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 300, color: '#111', letterSpacing: '0.1em' }}>
                        {formatDuration(callDuration)}
                      </span>
                    )}
                  </div>

                  {/* Mute + Hang Up */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button
                      onClick={() => muteCall(!isMuted)}
                      style={{
                        flex: 1, padding: '10px 0', borderRadius: 8,
                        border: `1px solid ${isMuted ? 'rgba(239,68,68,0.4)' : 'rgba(0,0,0,0.12)'}`,
                        background: isMuted ? 'rgba(239,68,68,0.08)' : '#f9f9f9',
                        color: isMuted ? '#ef4444' : '#555',
                        fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      {isMuted ? '🔇 Muted' : '🎤 Mute'}
                    </button>
                    <button
                      onClick={endCall}
                      style={{
                        flex: 1, padding: '10px 0', borderRadius: 8,
                        border: 'none',
                        background: '#ef4444',
                        color: '#fff',
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(239,68,68,0.35)',
                      }}
                    >
                      📵 Hang Up
                    </button>
                  </div>

                  {/* VM Drop */}
                  <button
                    disabled={vmDropped}
                    onClick={async () => {
                      const callSid = (activeCall as any)?.parameters?.CallSid;
                      if (!callSid) return;
                      await authFetch(`${API_BASE}/twilio/voicemail-drop`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ callSid }),
                      });
                      setVmDropped(true);
                      setTimeout(() => endCall(), 1000);
                    }}
                    style={{
                      width: '100%', padding: '8px 0', borderRadius: 7,
                      border: `1px solid ${vmDropped ? 'rgba(201,168,76,0.3)' : 'rgba(201,168,76,0.4)'}`,
                      background: vmDropped ? 'rgba(201,168,76,0.08)' : 'transparent',
                      color: vmDropped ? '#C9A84C' : '#9A7A2E',
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                      cursor: vmDropped ? 'not-allowed' : 'pointer',
                      opacity: vmDropped ? 0.7 : 1,
                    }}
                  >
                    {vmDropped ? '✓ Voicemail Sent' : '📤 Drop Voicemail'}
                  </button>
                </div>
              )}

              {/* ── POST-CALL: Logged confirmation ── */}
              {lastDisposition && (
                <div style={{ padding: '16px 20px 0', textAlign: 'center' }}>
                  <div style={{
                    padding: '10px', borderRadius: 8,
                    background: 'rgba(16,185,129,0.08)',
                    border: '1px solid rgba(16,185,129,0.2)',
                    color: '#059669', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                  }}>
                    ✓ Logged — moving to next
                  </div>
                </div>
              )}

              {/* Notes */}
              <div style={{ padding: '16px 20px 0' }}>
                <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#aaa', display: 'block', marginBottom: 6 }}>
                  Call Notes
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="What did they say? Any follow-up needed?"
                  rows={3}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '8px 10px', borderRadius: 7,
                    border: '1px solid #e5e7eb', background: '#fafafa',
                    fontSize: 12, color: '#374151', resize: 'none', outline: 'none',
                    lineHeight: 1.5,
                  }}
                />
              </div>

              {/* Disposition — mobile only */}
              <div className="md:hidden" style={{ padding: '12px 20px 0' }}>
                <DispositionPanel
                  onDisposition={handleDisposition}
                  disabled={isInCall || Boolean(lastDisposition)}
                />
                {lastDisposition && currentContact && (
                  <div style={{ marginTop: 12 }}>
                    <NextActionPanel contactId={currentContact.id} onBook={() => {}} />
                  </div>
                )}
              </div>

              {/* Skip button */}
              <div style={{ padding: '16px 20px 20px', marginTop: 'auto' }}>
                <button
                  onClick={() => {
                    if (currentContactIndex < contacts.length - 1) {
                      setCurrentContactIndex(i => i + 1);
                      setLastDisposition(null);
                      setNotes('');
                      setVmDropped(false);
                    }
                  }}
                  disabled={isInCall || currentContactIndex >= contacts.length - 1}
                  style={{
                    width: '100%', padding: '8px 0',
                    borderRadius: 7, border: '1px solid #e5e7eb',
                    background: 'transparent', color: '#9ca3af',
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                    cursor: isInCall || currentContactIndex >= contacts.length - 1 ? 'not-allowed' : 'pointer',
                    opacity: isInCall || currentContactIndex >= contacts.length - 1 ? 0.4 : 1,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!isInCall) (e.currentTarget as HTMLButtonElement).style.borderColor = '#C9A84C'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb'; }}
                >
                  Skip Contact →
                </button>
              </div>
            </div>

          ) : (
            /* No contacts — manual dial */
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: 16, borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb', textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
                <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>No contacts in queue.<br />Enter a number to dial manually.</p>
              </div>
              <label style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#aaa' }}>Phone Number</label>
              <input
                type="tel" value={manualPhone}
                onChange={e => setManualPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                style={{ padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, outline: 'none' }}
              />
              <button
                onClick={handleDial}
                disabled={deviceStatus !== 'ready' || !manualPhone}
                style={{
                  padding: '12px 0', borderRadius: 8, border: 'none',
                  background: !manualPhone || deviceStatus !== 'ready' ? '#e5e7eb' : 'linear-gradient(135deg, #C9A84C, #e8c96e)',
                  color: !manualPhone || deviceStatus !== 'ready' ? '#9ca3af' : '#fff',
                  fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  cursor: !manualPhone || deviceStatus !== 'ready' ? 'not-allowed' : 'pointer',
                }}
              >
                📞 Dial
              </button>
            </div>
          )}
        </div>

        {/* ── CENTER: AI Script ─────────────────────────────── */}
        <div className="hidden md:flex" style={{ flex: 1, flexDirection: 'column', gap: 16, padding: 20, overflow: 'auto', background: '#f8f8f8' }}>

          {/* AI Script card */}
          <div style={{
            background: '#fff', borderRadius: 12, border: '1px solid rgba(201,168,76,0.18)',
            padding: 20, flex: 1, overflow: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9A7A2E' }}>
                  ✨ AI Script
                </span>
                {aiScript?.cached && (
                  <span style={{ fontSize: 9, color: '#ccc', letterSpacing: '0.08em', textTransform: 'uppercase' }}>cached</span>
                )}
                {aiScriptLoading && (
                  <span style={{ fontSize: 9, color: '#C9A84C', letterSpacing: '0.08em', textTransform: 'uppercase' }}>generating…</span>
                )}
              </div>
              <button
                onClick={() => {
                  if (!currentContact) return;
                  setAiScript(null);
                  setAiScriptLoading(true);
                  authFetch(`${API_BASE}/ai-script/${currentContact.id}?refresh=true`)
                    .then(r => r.json()).then(d => { setAiScript(d); setAiScriptLoading(false); })
                    .catch(() => setAiScriptLoading(false));
                }}
                style={{ fontSize: 10, color: '#C9A84C', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.06em' }}
              >
                ↺ Refresh
              </button>
            </div>

            {aiScript ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Opener */}
                <div style={{ padding: '14px 16px', borderRadius: 8, background: 'rgba(201,168,76,0.05)', border: '1px solid rgba(201,168,76,0.25)' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C9A84C', marginBottom: 8 }}>
                    Opener
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.65, color: '#1f2937', margin: 0 }}>{aiScript.opener}</p>
                </div>

                {/* Objections */}
                {aiScript.objections?.map((obj: any, i: number) => (
                  <div key={i} style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid #f0f0f0', background: '#fff', cursor: 'pointer', transition: 'border-color 0.15s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(201,168,76,0.3)'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = '#f0f0f0'}
                  >
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 6 }}>
                      If they say: "{obj.trigger}"
                    </div>
                    <p style={{ fontSize: 12, lineHeight: 1.6, color: '#4b5563', margin: 0 }}>{obj.response}</p>
                  </div>
                ))}

                {/* Close */}
                <div style={{ padding: '12px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fafafa' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#C9A84C', marginBottom: 6 }}>
                    Close Attempt
                  </div>
                  <p style={{ fontSize: 12, lineHeight: 1.6, color: '#374151', margin: 0 }}>{aiScript.closeAttempt}</p>
                </div>

                {/* Tip */}
                {aiScript.tip && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #f0f0f0', background: '#f9fafb' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#d1d5db', marginBottom: 5 }}>
                      💡 Coach Tip
                    </div>
                    <p style={{ fontSize: 11, lineHeight: 1.55, color: '#6b7280', margin: 0 }}>{aiScript.tip}</p>
                  </div>
                )}
              </div>
            ) : aiScriptLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[80, 120, 60].map((h, i) => (
                  <div key={i} className="animate-pulse" style={{ height: h, borderRadius: 8, background: 'rgba(201,168,76,0.06)' }} />
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✨</div>
                <p style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.5 }}>Select a contact to generate a personalized AI script.</p>
              </div>
            )}
          </div>

          {/* Session Log */}
          {callHistory.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', padding: '16px 20px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 12 }}>
                Session Log
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {callHistory.slice(0, 8).map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                    <span style={{ fontSize: 14 }}>{DISP_EMOJI[c.disposition] || '📞'}</span>
                    <span style={{ flex: 1, fontWeight: 500, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af' }}>{formatDuration(c.duration)}</span>
                    <span style={{ fontSize: 10, color: '#6b7280', textTransform: 'capitalize', letterSpacing: '0.02em' }}>{c.disposition.replace(/-/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Disposition ───────────────────────────── */}
        <div
          className="hidden md:flex"
          style={{
            width: 200, flexShrink: 0,
            borderLeft: '1px solid rgba(0,0,0,0.06)',
            background: '#fff', padding: '20px 16px',
            flexDirection: 'column', gap: 16,
            overflow: 'auto',
          }}
        >
          {/* Step hint */}
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: isInCall ? 'rgba(239,68,68,0.05)' : showDisposition ? 'rgba(201,168,76,0.08)' : 'rgba(0,0,0,0.03)',
            border: `1px solid ${isInCall ? 'rgba(239,68,68,0.2)' : showDisposition ? 'rgba(201,168,76,0.25)' : 'rgba(0,0,0,0.06)'}`,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: isInCall ? '#ef4444' : showDisposition ? '#9A7A2E' : '#9ca3af', marginBottom: 3 }}>
              {isInCall ? 'On a call' : showDisposition ? 'Call ended' : 'Waiting'}
            </div>
            <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.4 }}>
              {isInCall
                ? 'Use Hang Up when done'
                : showDisposition
                ? 'Log the outcome below ↓'
                : sessionCalls === 0
                ? 'Press Call to start'
                : 'Press Call for next contact'}
            </div>
          </div>

          <DispositionPanel
            onDisposition={handleDisposition}
            disabled={isInCall || Boolean(lastDisposition) || sessionCalls === 0}
          />

          {lastDisposition && currentContact && (
            <NextActionPanel contactId={currentContact.id} onBook={() => {}} />
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
