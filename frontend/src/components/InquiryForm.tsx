import React, { useState } from 'react';
import { API_BASE } from '../config';

// Public "Inquire" form on the landing page. Sends to POST /api/auth/inquiry,
// which saves the lead and emails it to Braddock. Accounts are invite-only.
const GOLD = '#C9A84C';

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(201,168,76,0.25)',
  borderRadius: 3,
  color: '#fff',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};

export default function InquiryForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', message: '', website: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setError('');
    try {
      const r = await fetch(`${API_BASE}/auth/inquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.error) {
        setError(data.error || 'Something went wrong. Please try again.');
        setStatus('error');
        return;
      }
      setStatus('sent');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return (
      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center', padding: '28px 24px', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 3 }}>
        <div className="serif" style={{ fontSize: 26, fontWeight: 300, color: '#fff', marginBottom: 8 }}>Thank you.</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7 }}>
          We received your inquiry and will be in touch shortly.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="serif" style={{ fontSize: 22, fontWeight: 300, color: '#fff', textAlign: 'center', marginBottom: 4 }}>
        Inquire about Propel
      </div>
      <input style={field} placeholder="Full name *" value={form.name} onChange={set('name')} required maxLength={120} />
      <input style={field} placeholder="Email *" type="email" value={form.email} onChange={set('email')} required maxLength={200} />
      <input style={field} placeholder="Phone" type="tel" value={form.phone} onChange={set('phone')} maxLength={40} />
      <input style={field} placeholder="Brokerage / team" value={form.company} onChange={set('company')} maxLength={200} />
      <textarea style={{ ...field, minHeight: 90, resize: 'vertical' }} placeholder="How can we help?" value={form.message} onChange={set('message')} maxLength={3000} />
      {/* Honeypot: hidden from people, bots fill it in and get silently ignored */}
      <input value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
      {error && <div style={{ fontSize: 12, color: '#f87171', textAlign: 'center' }}>{error}</div>}
      <button
        type="submit"
        disabled={status === 'sending'}
        style={{ marginTop: 4, padding: '14px 0', background: 'transparent', color: GOLD, border: `1px solid ${GOLD}`, borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', cursor: status === 'sending' ? 'wait' : 'pointer' }}
      >
        {status === 'sending' ? 'Sending…' : 'Send Inquiry'}
      </button>
    </form>
  );
}
