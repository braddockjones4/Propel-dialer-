import React, { useState, useEffect } from 'react';
import { API_BASE } from '../config';


interface Template { id: string; name: string; subject: string; body: string; trigger?: string; }
interface EmailLog { id: string; toEmail: string; subject: string; status: string; openedAt?: string; createdAt: string; }

const DEFAULT_TEMPLATES: Omit<Template, 'id'>[] = [
  {
    name: 'Expired — First Touch',
    subject: 'Your Property at {address} — Quick Question',
    trigger: 'no-answer',
    body: `<p>Hi {firstName},</p>
<p>My name is {agentName} and I specialize in helping homeowners in your area get their properties sold — even when they've had difficulty with other agents.</p>
<p>I noticed your home at <strong>{address}</strong> recently came off the market, and I have a few ideas I believe could make a real difference.</p>
<p>Would you be open to a quick 15-minute call this week? I'd love to share what I'm seeing in the market and how I'd approach selling your home differently.</p>
<p>Best,<br/>{agentName}</p>`,
  },
  {
    name: 'Hot Lead — Follow Up',
    subject: 'Great talking with you, {firstName}!',
    trigger: 'hot-lead',
    body: `<p>Hi {firstName},</p>
<p>It was great speaking with you today. As promised, I wanted to follow up and confirm our next steps.</p>
<p>I'm excited about the opportunity to work together on <strong>{address}</strong>. Based on our conversation, I'm confident we can get you the result you're looking for.</p>
<p>I'll be in touch shortly to confirm our appointment. In the meantime, please don't hesitate to reach out with any questions.</p>
<p>Looking forward to working with you!<br/>{agentName}</p>`,
  },
  {
    name: 'Callback Scheduled',
    subject: 'Confirming our call, {firstName}',
    trigger: 'callback',
    body: `<p>Hi {firstName},</p>
<p>Just confirming I'll be calling you back as we discussed. I'll have some great information to share about {address} and the current market in your area.</p>
<p>Talk soon!<br/>{agentName}</p>`,
  },
];

export default function Email() {
  const [tab, setTab]               = useState<'compose' | 'templates' | 'logs'>('compose');
  const [templates, setTemplates]   = useState<Template[]>([]);
  const [logs, setLogs]             = useState<EmailLog[]>([]);
  const [contacts, setContacts]     = useState<any[]>([]);

  // Compose state
  const [toEmail,     setToEmail]   = useState('');
  const [contactId,   setContactId] = useState('');
  const [subject,     setSubject]   = useState('');
  const [body,        setBody]      = useState('');
  const [sending,     setSending]   = useState(false);
  const [sendMsg,     setSendMsg]   = useState('');

  // Template editor state
  const [editTpl,     setEditTpl]   = useState<Partial<Template> | null>(null);
  const [saving,      setSaving]    = useState(false);

  const loadTemplates = () => fetch(`${API_BASE}/email/templates`).then(r => r.json()).then(setTemplates).catch(() => {});
  const loadLogs      = () => fetch(`${API_BASE}/email/logs`).then(r => r.json()).then(setLogs).catch(() => {});

  useEffect(() => {
    loadTemplates();
    loadLogs();
    fetch(`${API_BASE}/contacts?limit=300`).then(r => r.json()).then(setContacts).catch(() => {});
  }, []);

  const seedTemplates = async () => {
    for (const tpl of DEFAULT_TEMPLATES) {
      await fetch(`${API_BASE}/email/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tpl) });
    }
    loadTemplates();
  };

  const handleSend = async () => {
    if (!subject || !body) { setSendMsg('Subject and body required'); return; }
    setSending(true); setSendMsg('');
    const r = await fetch(`${API_BASE}/email/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toEmail, contactId: contactId || undefined, subject, body }),
    });
    const data = await r.json();
    setSending(false);
    if (r.ok) { setSendMsg('Email sent ✓'); setSubject(''); setBody(''); loadLogs(); }
    else      { setSendMsg(data.error || 'Failed'); }
  };

  const handleSaveTpl = async () => {
    if (!editTpl?.name || !editTpl?.subject || !editTpl?.body) return;
    setSaving(true);
    if (editTpl.id) {
      await fetch(`${API_BASE}/email/templates/${editTpl.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editTpl) });
    } else {
      await fetch(`${API_BASE}/email/templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editTpl) });
    }
    setSaving(false); setEditTpl(null); loadTemplates();
  };

  const deleteTpl = async (id: string) => {
    await fetch(`${API_BASE}/email/templates/${id}`, { method: 'DELETE' });
    loadTemplates();
  };

  const openRate = logs.length ? Math.round((logs.filter(l => l.status === 'opened').length / logs.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-light text-black tracking-tight">Email</h1>
            <p className="text-sm text-gray-400 mt-0.5">HTML email sequences with open tracking</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-light">{logs.length}</div>
              <div className="text-[10px] text-gray-400 tracking-widest uppercase">Sent</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-light" style={{ color: '#9A7A2E' }}>{openRate}%</div>
              <div className="text-[10px] text-gray-400 tracking-widest uppercase">Open Rate</div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-6 border-b border-gray-100">
          {(['compose', 'templates', 'logs'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-[11px] tracking-widest uppercase font-medium relative transition-colors ${tab === t ? 'text-black' : 'text-gray-400 hover:text-gray-600'}`}>
              {t}
              {tab === t && <span className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ background: '#C9A84C' }} />}
            </button>
          ))}
        </div>

        {/* ── Compose ───────────────────────────── */}
        {tab === 'compose' && (
          <div className="card space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Contact (optional)</label>
                <select value={contactId} onChange={e => {
                  setContactId(e.target.value);
                  const c = contacts.find(x => x.id === e.target.value);
                  if (c?.email) setToEmail(c.email);
                }} className="field-input">
                  <option value="">Select contact…</option>
                  {contacts.filter(c => c.email).map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">To Email *</label>
                <input type="email" value={toEmail} onChange={e => setToEmail(e.target.value)} placeholder="name@email.com" className="field-input" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="field-label">Subject *</label>
                {templates.length > 0 && (
                  <select onChange={e => {
                    const tpl = templates.find(t => t.id === e.target.value);
                    if (tpl) { setSubject(tpl.subject); setBody(tpl.body); }
                  }} className="text-[10px] text-gray-400 border-0 bg-transparent cursor-pointer">
                    <option value="">Load template…</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
              </div>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject line…" className="field-input" />
            </div>

            <div>
              <label className="field-label">Body (HTML)</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={12}
                className="field-input resize-none font-mono text-xs" placeholder="<p>Hi {firstName},</p>&#10;<p>…</p>" />
              <p className="text-[10px] text-gray-300 mt-1">Variables: {'{firstName}'} {'{lastName}'} {'{address}'} {'{agentName}'}</p>
            </div>

            {sendMsg && <p className="text-sm" style={{ color: sendMsg.includes('✓') ? '#22c55e' : '#ef4444' }}>{sendMsg}</p>}
            <button onClick={handleSend} disabled={sending} className="btn-gold w-full py-3">
              {sending ? 'Sending…' : 'Send Email'}
            </button>
          </div>
        )}

        {/* ── Templates ─────────────────────────── */}
        {tab === 'templates' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-400">{templates.length} templates</span>
              <div className="flex gap-2">
                {templates.length === 0 && (
                  <button onClick={seedTemplates} className="btn-ghost text-xs px-3 py-1.5">Seed defaults</button>
                )}
                <button onClick={() => setEditTpl({ name: '', subject: '', body: '<p>Hi {firstName},</p>\n<p></p>\n<p>Best,<br/>{agentName}</p>' })}
                  className="btn-gold text-xs px-3 py-1.5">+ New Template</button>
              </div>
            </div>

            {editTpl && (
              <div className="card mb-4 space-y-3">
                <h3 className="field-label">{editTpl.id ? 'Edit Template' : 'New Template'}</h3>
                <input value={editTpl.name || ''} onChange={e => setEditTpl(p => ({ ...p, name: e.target.value }))} placeholder="Template name" className="field-input" />
                <input value={editTpl.subject || ''} onChange={e => setEditTpl(p => ({ ...p, subject: e.target.value }))} placeholder="Subject line" className="field-input" />
                <select value={editTpl.trigger || ''} onChange={e => setEditTpl(p => ({ ...p, trigger: e.target.value }))} className="field-input">
                  <option value="">No trigger</option>
                  <option value="hot-lead">Hot lead</option>
                  <option value="callback">Callback</option>
                  <option value="no-answer">No answer</option>
                  <option value="manual">Manual only</option>
                </select>
                <textarea value={editTpl.body || ''} onChange={e => setEditTpl(p => ({ ...p, body: e.target.value }))} rows={8} className="field-input resize-none font-mono text-xs" />
                <div className="flex gap-2">
                  <button onClick={() => setEditTpl(null)} className="btn-ghost flex-1 py-2">Cancel</button>
                  <button onClick={handleSaveTpl} disabled={saving} className="btn-gold flex-1 py-2">{saving ? '…' : 'Save'}</button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {templates.map(t => (
                <div key={t.id} className="card flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t.subject}</p>
                    {t.trigger && <span className="text-[9px] px-1.5 py-0.5 rounded mt-1 inline-block" style={{ background: 'rgba(201,168,76,0.1)', color: '#9A7A2E' }}>{t.trigger}</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditTpl(t)} className="text-xs text-gray-400 hover:text-black">Edit</button>
                    <button onClick={() => deleteTpl(t.id)} className="text-xs text-red-400 hover:text-red-600">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Logs ──────────────────────────────── */}
        {tab === 'logs' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-400">{logs.length} emails · {openRate}% open rate</span>
              <button onClick={loadLogs} className="text-[10px] text-gray-400 hover:text-black tracking-widest uppercase">↺ Refresh</button>
            </div>
            <div className="card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 text-[10px] tracking-widest uppercase text-gray-400 font-normal">To</th>
                    <th className="text-left py-2 text-[10px] tracking-widest uppercase text-gray-400 font-normal">Subject</th>
                    <th className="text-left py-2 text-[10px] tracking-widest uppercase text-gray-400 font-normal">Status</th>
                    <th className="text-left py-2 text-[10px] tracking-widest uppercase text-gray-400 font-normal">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.slice(0, 50).map(l => (
                    <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 text-xs text-gray-600 max-w-[140px] truncate">{l.toEmail}</td>
                      <td className="py-2 text-xs text-gray-700 max-w-[220px] truncate">{l.subject}</td>
                      <td className="py-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                          style={{
                            background: l.status === 'opened' ? 'rgba(34,197,94,0.1)'  : l.status === 'failed' ? 'rgba(239,68,68,0.1)'  : 'rgba(0,0,0,0.05)',
                            color:      l.status === 'opened' ? '#16a34a'               : l.status === 'failed' ? '#dc2626'              : '#6b7280',
                          }}>
                          {l.status === 'opened' ? '👁 Opened' : l.status}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-gray-400">{new Date(l.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length === 0 && <p className="text-center text-gray-300 text-sm py-8">No emails sent yet</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
