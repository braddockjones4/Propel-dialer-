import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../config';

const GOLD  = '#C9A84C';
const BLACK = '#0A0A0A';
const GRAY  = '#6B7280';

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  contactGroup?: string;
}

interface GmailStatus {
  connected: boolean;
  email: string | null;
}

interface BlastResult {
  sent: number;
  failed: number;
  total: number;
  errors: string[];
  errorDetails?: { email: string; reason: string }[];
}

type RecipientMode = 'all' | 'group' | 'select';
type Step = 'connect' | 'compose' | 'confirm' | 'sending' | 'done';

const BACKEND = API_BASE.replace('/api', '');

export default function EmailBlast() {
  const [step, setStep]               = useState<Step>('connect');
  const [gmailStatus, setGmailStatus] = useState<GmailStatus>({ connected: false, email: null });
  const [contacts, setContacts]       = useState<Contact[]>([]);
  const [groups, setGroups]           = useState<string[]>([]);
  const [loading, setLoading]         = useState(true);

  // Compose state
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('all');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [subject, setSubject]             = useState('');
  const [body, setBody]                   = useState('');
  const [result, setResult]               = useState<BlastResult | null>(null);
  const [sendError, setSendError]         = useState('');

  // Refs for cursor-position token insertion
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef    = useRef<HTMLTextAreaElement>(null);
  const lastFocus  = useRef<'subject' | 'body'>('body');

  const insertToken = useCallback((token: string) => {
    const field = lastFocus.current;
    if (field === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? subject.length;
      const end   = el.selectionEnd   ?? subject.length;
      const next  = subject.slice(0, start) + token + subject.slice(end);
      setSubject(next);
      // Restore cursor after the inserted token
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? body.length;
      const end   = el.selectionEnd   ?? body.length;
      const next  = body.slice(0, start) + token + body.slice(end);
      setBody(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    }
  }, [subject, body]);

  const token = localStorage.getItem('propel_token');
  const authHeader = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ── Load status + contacts on mount ──────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, contactsRes] = await Promise.all([
        fetch(`${API_BASE}/gmail/status`, { headers: authHeader }),
        fetch(`${API_BASE}/contacts?limit=500`, { headers: authHeader }),
      ]);
      const status   = await statusRes.json();
      const allContacts: Contact[] = await contactsRes.json();

      setGmailStatus(status);
      setContacts(allContacts);

      // Derive unique groups
      const gs = [...new Set(allContacts.map((c: Contact) => c.contactGroup).filter(Boolean))] as string[];
      setGroups(gs);

      setStep(status.connected ? 'compose' : 'connect');
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();

    // Handle OAuth redirect params
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmailConnected') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      loadData();
    }
    if (params.get('gmailError')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // ── Recipient filtering ───────────────────────────────────────────────────
  const withEmail = contacts.filter(c => c.email?.includes('@'));

  const recipients: Contact[] = (() => {
    switch (recipientMode) {
      case 'all':    return withEmail;
      case 'group':  return withEmail.filter(c => c.contactGroup === selectedGroup);
      case 'select': return withEmail.filter(c => selectedIds.has(c.id));
      default:       return withEmail;
    }
  })();

  // ── Connect Gmail ─────────────────────────────────────────────────────────
  const connectGmail = () => {
    window.location.href = `${BACKEND}/api/gmail/auth?token=${token}`;
  };

  // Because the OAuth redirect can't carry a Bearer header, we embed the token
  // in the auth URL via a redirect that the backend exchanges for the user session.
  // (Backend reads state param = userId which is safe for OAuth flows.)
  const connectGmailViaAPI = () => {
    window.location.href = `${API_BASE}/gmail/auth?token=${token}`;
  };

  const disconnect = async () => {
    await fetch(`${API_BASE}/gmail/disconnect`, { method: 'DELETE', headers: authHeader });
    setGmailStatus({ connected: false, email: null });
    setStep('connect');
  };

  // ── Send blast ────────────────────────────────────────────────────────────
  const sendBlast = async () => {
    setStep('sending');
    setSendError('');
    try {
      const body_payload: any = { subject, body };
      if (recipientMode === 'all')    body_payload.allContacts = true;
      if (recipientMode === 'group')  body_payload.group = selectedGroup;
      if (recipientMode === 'select') body_payload.contactIds = [...selectedIds];

      const res = await fetch(`${API_BASE}/gmail/blast`, {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify(body_payload),
      });
      const data = await res.json();
      if (!res.ok) { setSendError(data.error || 'Send failed'); setStep('confirm'); return; }
      setResult(data);
      setStep('done');
    } catch (e: any) {
      setSendError(e.message);
      setStep('confirm');
    }
  };

  const reset = () => {
    setSubject('');
    setBody('');
    setRecipientMode('all');
    setSelectedGroup('');
    setSelectedIds(new Set());
    setResult(null);
    setSendError('');
    setStep('compose');
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: '#fff',
    border: '1px solid rgba(0,0,0,0.07)',
    borderRadius: 12,
    padding: 'clamp(16px, 4vw, 32px) clamp(16px, 5vw, 36px)',
  };

  const label: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: GRAY,
    display: 'block',
    marginBottom: 6,
  };

  const input: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    border: '1.5px solid rgba(0,0,0,0.1)',
    borderRadius: 6,
    fontSize: 13,
    color: BLACK,
    background: '#fafafa',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  const btnPrimary: React.CSSProperties = {
    padding: '12px 28px',
    background: GOLD,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  const btnGhost: React.CSSProperties = {
    padding: '11px 24px',
    background: 'transparent',
    color: GRAY,
    border: '1.5px solid rgba(0,0,0,0.1)',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <div style={{ fontSize: 13, color: GRAY }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 'clamp(16px, 4vw, 32px) clamp(12px, 4vw, 24px)' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>
          Email Blast
        </div>
        <h1 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 32, fontWeight: 300, color: BLACK, margin: 0 }}>
          Send from your Gmail
        </h1>
        <p style={{ fontSize: 13, color: GRAY, marginTop: 8, lineHeight: 1.7 }}>
          Emails go out from your personal Gmail account — not a bulk server. Best possible deliverability.
        </p>
      </div>

      {/* ── STEP: CONNECT ───────────────────────────────────────────────── */}
      {step === 'connect' && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 28 }}>
            <div style={{ width: 52, height: 52, borderRadius: 12, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {/* Google G icon */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16, color: BLACK, marginBottom: 4 }}>Connect your Gmail</div>
              <div style={{ fontSize: 13, color: GRAY, lineHeight: 1.6 }}>
                Authorize Propel Dialer to send emails on your behalf. Your password is never stored.
              </div>
            </div>
          </div>

          <div style={{ background: '#fafaf8', borderRadius: 8, padding: '16px 20px', marginBottom: 24, border: '1px solid rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: BLACK, marginBottom: 10 }}>What this allows:</div>
            {[
              'Send emails from your personal Gmail address',
              'Emails appear in your Gmail Sent folder',
              'Recipients see your real email — not a bulk service',
              'No email password stored — Google OAuth only',
            ].map(item => (
              <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                <span style={{ color: GOLD, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                <span style={{ fontSize: 12.5, color: GRAY }}>{item}</span>
              </div>
            ))}
          </div>

          <button onClick={connectGmailViaAPI} style={{ ...btnPrimary, width: '100%', padding: '14px' }}>
            Connect Gmail Account →
          </button>
        </div>
      )}

      {/* ── STEP: COMPOSE ───────────────────────────────────────────────── */}
      {step === 'compose' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Connected badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: '#16a34a', fontSize: 14 }}>●</span>
              <span style={{ fontSize: 13, color: '#15803d', fontWeight: 500 }}>Sending from <strong>{gmailStatus.email}</strong></span>
            </div>
            <button onClick={disconnect} style={{ background: 'none', border: 'none', fontSize: 11, color: GRAY, cursor: 'pointer', textDecoration: 'underline' }}>
              Disconnect
            </button>
          </div>

          {/* Recipients */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: BLACK, marginBottom: 16 }}>Recipients</div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              {(['all', 'group', 'select'] as RecipientMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setRecipientMode(mode)}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 20,
                    border: `1.5px solid ${recipientMode === mode ? GOLD : 'rgba(0,0,0,0.1)'}`,
                    background: recipientMode === mode ? 'rgba(201,168,76,0.08)' : 'transparent',
                    color: recipientMode === mode ? '#9A7A2E' : GRAY,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {mode === 'all' ? 'All Contacts' : mode === 'group' ? 'By Group' : 'Select Contacts'}
                </button>
              ))}
            </div>

            {recipientMode === 'group' && (
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Select Group</label>
                <select
                  value={selectedGroup}
                  onChange={e => setSelectedGroup(e.target.value)}
                  style={{ ...input, cursor: 'pointer' }}
                >
                  <option value="">— Choose a group —</option>
                  {groups.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            )}

            {recipientMode === 'select' && (
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1.5px solid rgba(0,0,0,0.08)', borderRadius: 8 }}>
                {withEmail.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: 13, color: GRAY }}>No contacts with email addresses</div>
                ) : withEmail.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={e => {
                        const next = new Set(selectedIds);
                        e.target.checked ? next.add(c.id) : next.delete(c.id);
                        setSelectedIds(next);
                      }}
                      style={{ accentColor: GOLD, width: 14, height: 14 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: BLACK }}>{c.firstName} {c.lastName}</div>
                      <div style={{ fontSize: 11, color: GRAY }}>{c.email}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {/* Recipient count */}
            <div style={{ marginTop: 14, padding: '10px 14px', background: recipients.length > 0 ? 'rgba(201,168,76,0.06)' : '#fef2f2', borderRadius: 6, border: `1px solid ${recipients.length > 0 ? 'rgba(201,168,76,0.2)' : '#fecaca'}` }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: recipients.length > 0 ? '#9A7A2E' : '#dc2626' }}>
                {recipients.length > 0
                  ? `${recipients.length} contact${recipients.length !== 1 ? 's' : ''} will receive this email`
                  : recipientMode === 'group' && !selectedGroup
                    ? 'Select a group above'
                    : recipientMode === 'select' && selectedIds.size === 0
                      ? 'Select at least one contact'
                      : 'No contacts with email addresses in this selection'}
              </span>
            </div>
          </div>

          {/* Compose */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: BLACK }}>Message</div>
              {/* Token insert chips */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: GRAY, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Insert:</span>
                {[
                  { label: 'First Name', token: '{{firstName}}' },
                  { label: 'Last Name',  token: '{{lastName}}'  },
                  { label: 'Full Name',  token: '{{fullName}}'  },
                ].map(({ label, token: t }) => (
                  <button
                    key={t}
                    onMouseDown={e => { e.preventDefault(); insertToken(t); }}
                    style={{
                      padding: '4px 10px',
                      border: `1.5px solid ${GOLD}`,
                      borderRadius: 20,
                      background: 'rgba(201,168,76,0.07)',
                      color: '#9A7A2E',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      letterSpacing: '0.03em',
                    }}
                  >
                    + {label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={label}>Subject Line</label>
              <input
                ref={subjectRef}
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                onFocus={() => { lastFocus.current = 'subject'; }}
                placeholder="e.g. Quick update for you, {{firstName}}"
                style={input}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={label}>Message Body</label>
              <textarea
                ref={bodyRef}
                value={body}
                onChange={e => setBody(e.target.value)}
                onFocus={() => { lastFocus.current = 'body'; }}
                placeholder={`Hi {{firstName}},\n\nI wanted to reach out with a quick update on the market in your area...\n\nBest,\n[Your Name]`}
                rows={10}
                style={{ ...input, resize: 'vertical', minHeight: 200, lineHeight: 1.7 }}
              />
            </div>

            <div style={{ fontSize: 11, color: GRAY }}>
              Click a token above to insert it at your cursor position — each recipient's name fills in automatically when sent.
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              onClick={() => setStep('confirm')}
              disabled={!subject.trim() || !body.trim() || recipients.length === 0}
              style={{
                ...btnPrimary,
                opacity: (!subject.trim() || !body.trim() || recipients.length === 0) ? 0.4 : 1,
                cursor: (!subject.trim() || !body.trim() || recipients.length === 0) ? 'not-allowed' : 'pointer',
              }}
            >
              Review & Send →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP: CONFIRM ───────────────────────────────────────────────── */}
      {step === 'confirm' && (
        <div style={card}>
          <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 26, fontWeight: 300, color: BLACK, marginBottom: 24 }}>
            Ready to send?
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: 12, color: GRAY, fontWeight: 500 }}>From</span>
              <span style={{ fontSize: 13, color: BLACK, fontWeight: 600 }}>{gmailStatus.email}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: 12, color: GRAY, fontWeight: 500 }}>Recipients</span>
              <span style={{ fontSize: 13, color: BLACK, fontWeight: 600 }}>{recipients.length} contact{recipients.length !== 1 ? 's' : ''}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: 12, color: GRAY, fontWeight: 500 }}>Subject</span>
              <span style={{ fontSize: 13, color: BLACK, fontWeight: 600, maxWidth: 400, textAlign: 'right' }}>{subject}</span>
            </div>
            <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: 12, color: GRAY, fontWeight: 500, display: 'block', marginBottom: 8 }}>Preview</span>
              <div style={{ fontSize: 13, color: BLACK, lineHeight: 1.75, whiteSpace: 'pre-wrap', background: '#fafaf8', padding: '14px 16px', borderRadius: 6, maxHeight: 180, overflowY: 'auto' }}>
                {(body || '').replace(/\{\{firstName\}\}/gi, recipients[0]?.firstName || 'Sarah')
                             .replace(/\{\{lastName\}\}/gi, recipients[0]?.lastName || 'Chen')
                             .replace(/\{\{fullName\}\}/gi, `${recipients[0]?.firstName || 'Sarah'} ${recipients[0]?.lastName || 'Chen'}`)}
              </div>
              <div style={{ fontSize: 10, color: GRAY, marginTop: 6 }}>Showing with first recipient's name filled in</div>
            </div>
          </div>

          {sendError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#dc2626', marginBottom: 16 }}>
              {sendError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => setStep('compose')} style={btnGhost}>← Back</button>
            <button onClick={sendBlast} style={{ ...btnPrimary, flex: 1 }}>
              Send to {recipients.length} Contact{recipients.length !== 1 ? 's' : ''} →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP: SENDING ───────────────────────────────────────────────── */}
      {step === 'sending' && (
        <div style={{ ...card, textAlign: 'center', padding: 'clamp(32px,8vw,64px) clamp(16px,5vw,36px)' }}>
          <div style={{ width: 52, height: 52, border: `3px solid ${GOLD}`, borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 26, fontWeight: 300, color: BLACK, marginBottom: 10 }}>
            Sending emails…
          </div>
          <div style={{ fontSize: 13, color: GRAY }}>
            Sending to {recipients.length} contact{recipients.length !== 1 ? 's' : ''} via Gmail. This may take a moment.
          </div>
        </div>
      )}

      {/* ── STEP: DONE ──────────────────────────────────────────────────── */}
      {step === 'done' && result && (
        <div style={{ ...card, textAlign: 'center', padding: 'clamp(28px,6vw,52px) clamp(16px,5vw,36px)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(201,168,76,0.1)', border: `2px solid ${GOLD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', fontSize: 22 }}>
            ✓
          </div>
          <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 30, fontWeight: 300, color: BLACK, marginBottom: 8 }}>
            Blast sent.
          </div>
          <div style={{ fontSize: 14, color: GRAY, marginBottom: 32, lineHeight: 1.7 }}>
            {result.sent} email{result.sent !== 1 ? 's' : ''} delivered from {gmailStatus.email}.
            {result.failed > 0 && <><br /><span style={{ color: '#dc2626' }}>{result.failed} failed to send.</span></>}
          </div>

          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 32 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 40, fontWeight: 300, color: GOLD, lineHeight: 1 }}>{result.sent}</div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: GRAY, marginTop: 4 }}>Sent</div>
            </div>
            {result.failed > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 40, fontWeight: 300, color: '#dc2626', lineHeight: 1 }}>{result.failed}</div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: GRAY, marginTop: 4 }}>Failed</div>
              </div>
            )}
          </div>

          {result.errors.length > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '12px 16px', marginBottom: 24, textAlign: 'left' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>Failed addresses:</div>
              {(result.errorDetails || result.errors.map(e => ({ email: e, reason: '' }))).map(({ email, reason }) => (
                <div key={email} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{email}</div>
                  {reason && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>{reason}</div>}
                </div>
              ))}
            </div>
          )}

          <button onClick={reset} style={btnPrimary}>Send Another Blast</button>
        </div>
      )}
    </div>
  );
}
