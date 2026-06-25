import React, { useEffect, useState, useCallback } from 'react';
import CsvImportModal from './CsvImportModal';
import { useToast } from './Toast';
import { ContactListSkeleton } from './Skeleton';
import { API_BASE } from '../config';


interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  email?: string;
  source: string;
  status: string;
  notes?: string;
  leadScore?: number;
  createdAt: string;
  calls?: Array<{ id: string; disposition?: string; calledAt: string; duration: number; recordingUrl?: string; twilioSid?: string }>;
}

const STATUS_STYLES: Record<string, { border: string; color: string }> = {
  new:       { border: '#E0E0E0',              color: '#888' },
  contacted: { border: 'rgba(59,130,246,0.4)', color: '#3b82f6' },
  callback:  { border: 'rgba(201,168,76,0.5)', color: '#9A7A2E' },
  hot:       { border: 'rgba(239,68,68,0.4)',  color: '#ef4444' },
  dnc:       { border: '#E0E0E0',              color: '#C0C0C0' },
};

const SOURCE_LABELS: Record<string, string> = {
  expired:       'Expired',
  fsbo:          'FSBO',
  circle:        'Circle',
  'past-client': 'Past Client',
  manual:        'Manual',
};

const STATUSES = ['all', 'new', 'contacted', 'callback', 'hot'] as const;

export default function Contacts() {
  const toast = useToast();
  const [contacts, setContacts]   = useState<Contact[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState('all');
  const [search, setSearch]       = useState('');
  const [selected, setSelected]   = useState<Contact | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving]       = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newContact, setNewContact] = useState({ firstName: '', lastName: '', phone: '', email: '', address: '', city: '', state: '', zip: '', source: 'manual' });
  const [addSaving, setAddSaving] = useState(false);
  // Bulk selection
  const [checkedIds, setCheckedIds]   = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction]   = useState('');
  const [bulkWorking, setBulkWorking] = useState(false);
  const [scoreMsg, setScoreMsg]       = useState('');

  const loadContacts = () => {
    setLoading(true);
    fetch(`${API_BASE}/contacts?limit=500`)
      .then(r => r.json())
      .then(data => { setContacts(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadContacts(); }, []);

  const saveNewContact = async () => {
    if (!newContact.firstName || !newContact.phone) { toast.error('First name and phone are required'); return; }
    setAddSaving(true);
    try {
      const res = await fetch(`${API_BASE}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newContact }),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Failed'); }
      toast.success('Contact added');
      setShowAdd(false);
      setNewContact({ firstName: '', lastName: '', phone: '', email: '', address: '', city: '', state: '', zip: '', source: 'manual' });
      loadContacts();
    } catch {
      toast.error('Could not save contact');
    }
    setAddSaving(false);
  };

  // Bulk action handler
  const executeBulkAction = useCallback(async () => {
    if (!bulkAction || checkedIds.size === 0) return;
    setBulkWorking(true);
    const ids = Array.from(checkedIds);

    if (bulkAction === 'delete') {
      const confirmed = window.confirm(`Delete ${ids.length} contacts? This cannot be undone.`);
      if (!confirmed) { setBulkWorking(false); return; }
    }

    const isStatus = bulkAction.startsWith('status:');
    await fetch(`${API_BASE}/contacts/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids,
        action: isStatus ? 'setStatus' : bulkAction,
        value:  isStatus ? bulkAction.replace('status:', '') : undefined,
      }),
    });

    setCheckedIds(new Set());
    setBulkAction('');
    setBulkWorking(false);
    toast.success(`Updated ${ids.length} contact${ids.length !== 1 ? 's' : ''}`);
    loadContacts();
  }, [bulkAction, checkedIds]);

  const toggleCheck = (id: string) => setCheckedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => setCheckedIds(prev =>
    prev.size === filtered.length ? new Set() : new Set(filtered.map(c => c.id))
  );

  // Re-score all leads
  const rescoreAll = async () => {
    setScoreMsg('Scoring…');
    await fetch(`${API_BASE}/contacts/score-all`, { method: 'POST' });
    setScoreMsg('');
    toast.success('Lead scores updated');
    loadContacts();
  };

  const filtered = contacts.filter(c => {
    const matchStatus = filter === 'all' || c.status === filter;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      (c.address || '').toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const openContact = (c: Contact) => { setSelected(c); setEditNotes(c.notes || ''); };

  const saveNotes = async () => {
    if (!selected) return;
    setSaving(true);
    await fetch(`${API_BASE}/contacts/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: editNotes }),
    });
    setSaving(false);
    setContacts(prev => prev.map(c => c.id === selected.id ? { ...c, notes: editNotes } : c));
    setSelected(prev => prev ? { ...prev, notes: editNotes } : null);
    toast.success('Notes saved');
  };

  const setStatus = async (status: string) => {
    if (!selected) return;
    await fetch(`${API_BASE}/contacts/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setContacts(prev => prev.map(c => c.id === selected.id ? { ...c, status } : c));
    setSelected(prev => prev ? { ...prev, status } : null);
  };

  const counts: Record<string, number> = {
    all: contacts.length,
    new: contacts.filter(c => c.status === 'new').length,
    contacted: contacts.filter(c => c.status === 'contacted').length,
    callback: contacts.filter(c => c.status === 'callback').length,
    hot: contacts.filter(c => c.status === 'hot').length,
  };

  return (
    <div className="flex h-[calc(100vh-49px)]">

      {/* ── Left: List ───────────────────────────────────── */}
      <div className="flex flex-col w-80 border-r border-gray-100 bg-white">

        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search name, phone, address…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="field-input flex-1"
            />
            <button
              onClick={() => setShowAdd(true)}
              className="btn-gold px-3 py-1.5 text-[10px] tracking-widest uppercase whitespace-nowrap"
              title="Add contact"
            >
              + Add
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="btn-gold-outline px-3 py-1.5 text-[10px] tracking-widest uppercase whitespace-nowrap"
              title="Import CSV"
            >
              CSV
            </button>
          </div>

          {/* Bulk action bar */}
          {checkedIds.size > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 tracking-widest">{checkedIds.size} selected</span>
              <select
                value={bulkAction}
                onChange={e => setBulkAction(e.target.value)}
                className="field-input flex-1 text-xs py-1"
              >
                <option value="">Action…</option>
                <option value="status:new">Set New</option>
                <option value="status:contacted">Set Contacted</option>
                <option value="status:callback">Set Callback</option>
                <option value="status:hot">Set Hot</option>
                <option value="status:dnc">Set DNC</option>
                <option value="delete">Delete</option>
              </select>
              <button
                onClick={executeBulkAction}
                disabled={!bulkAction || bulkWorking}
                className="btn-gold text-[10px] px-3 py-1.5 whitespace-nowrap"
              >
                {bulkWorking ? '…' : 'Apply'}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-300 tracking-widest">{filtered.length} contacts</span>
              <button onClick={rescoreAll} className="text-[9px] tracking-widest uppercase hover:underline" style={{ color: '#C9A84C' }}>
                {scoreMsg || '↺ Score Leads'}
              </button>
            </div>
          )}
          <div className="flex gap-1.5 flex-wrap">
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className="px-2.5 py-1 rounded text-[9px] font-semibold tracking-widest uppercase transition-colors border"
                style={filter === s
                  ? { background: '#C9A84C', borderColor: '#C9A84C', color: '#0A0A0A' }
                  : { borderColor: '#E0E0E0', color: '#999' }}
              >
                {s} <span style={{ opacity: 0.5 }}>({counts[s] ?? 0})</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <ContactListSkeleton rows={10} />
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
              <div className="text-sm text-gray-400 font-medium">No contacts found</div>
              <div className="text-xs text-gray-300 mt-1">Import a CSV or add one manually</div>
            </div>
          ) : filtered.map(c => {
            const ss = STATUS_STYLES[c.status] || STATUS_STYLES.new;
            const isChecked = checkedIds.has(c.id);
            return (
              <div
                key={c.id}
                className="flex items-center gap-2 px-3 py-3.5 border-b border-gray-50 cursor-pointer transition-colors hover:bg-gray-50"
                style={selected?.id === c.id ? { background: 'rgba(201,168,76,0.05)' } : {}}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleCheck(c.id)}
                  onClick={e => e.stopPropagation()}
                  className="accent-yellow-600 flex-shrink-0"
                  style={{ accentColor: '#C9A84C' }}
                />
                <div className="flex-1 min-w-0" onClick={() => openContact(c)}>
                  <div className="flex items-center gap-2">
                    <span className="text-black font-medium text-sm">{c.firstName} {c.lastName}</span>
                    <span className="status-badge border" style={{ borderColor: ss.border, color: ss.color }}>
                      {c.status}
                    </span>
                    {c.leadScore != null && c.leadScore >= 60 && (
                      <span className="text-[9px] font-bold" style={{ color: c.leadScore >= 80 ? '#C9A84C' : '#9ca3af' }}>
                        🔥{c.leadScore}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5 font-mono" style={{ color: '#C9A84C' }}>{c.phone}</div>
                  {c.address && (
                    <div className="text-gray-400 text-xs mt-0.5 truncate">{c.address}, {c.city}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[9px] tracking-widest uppercase text-gray-300">{SOURCE_LABELS[c.source] || c.source}</div>
                  {c.calls && c.calls.length > 0 && (
                    <div className="text-gray-300 text-xs mt-0.5">{c.calls.length} call{c.calls.length !== 1 ? 's' : ''}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: Detail ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-10 bg-gray-50">
        {!selected ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl font-serif font-light text-gray-200 mb-2">Select a Contact</div>
              <div className="text-gray-300 text-sm tracking-wide">Choose from the list to view details</div>
            </div>
          </div>
        ) : (
          <div className="max-w-xl space-y-8">

            {/* Header */}
            <div>
              <div className="text-[9px] tracking-widest uppercase mb-2" style={{ color: 'rgba(154,122,46,0.7)' }}>
                {SOURCE_LABELS[selected.source] || selected.source}
              </div>
              <h2 className="text-3xl font-serif font-light text-black tracking-wide">
                {selected.firstName} {selected.lastName}
              </h2>
              <div className="gold-line mt-4" />
            </div>

            {/* Info */}
            <div className="card-gold space-y-3 text-sm">
              {[
                { label: 'Phone',   value: selected.phone,   mono: true },
                selected.email ? { label: 'Email', value: selected.email } : null,
                selected.address ? { label: 'Address', value: `${selected.address}, ${selected.city}, ${selected.state} ${selected.zip}` } : null,
                { label: 'Source',  value: SOURCE_LABELS[selected.source] || selected.source },
                { label: 'Added',   value: new Date(selected.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
              ].filter(Boolean).map((row: any) => (
                <div key={row.label} className="flex justify-between items-start gap-4">
                  <span className="text-[9px] tracking-widest uppercase text-gray-400 shrink-0">{row.label}</span>
                  <span className="text-right font-medium" style={row.mono ? { color: '#C9A84C', fontFamily: 'monospace' } : { color: '#111' }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Call history */}
            {selected.calls && selected.calls.length > 0 && (
              <div>
                <h3 className="field-label mb-3">Call History</h3>
                <div className="space-y-3">
                  {selected.calls.map((call, i) => (
                    <div key={i} className="card py-3 px-4 space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-700 capitalize font-medium">{call.disposition?.replace(/-/g, ' ') || 'No disposition'}</span>
                        <span className="text-gray-400 font-mono text-xs">{Math.floor(call.duration / 60)}:{String(call.duration % 60).padStart(2,'0')}</span>
                        <span className="text-gray-400 text-xs">{new Date(call.calledAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span>
                      </div>
                      {call.recordingUrl && (
                        <div className="pt-1">
                          <div className="text-[9px] tracking-widest uppercase text-gray-400 mb-1.5">Recording</div>
                          <audio
                            controls
                            preload="none"
                            className="w-full h-8"
                            src={`${API_BASE}/twilio/recording-proxy?url=${encodeURIComponent(call.recordingUrl)}`}
                            style={{ accentColor: '#C9A84C' }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="field-label">Notes</label>
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={4} className="field-input resize-none" placeholder="Add notes…" />
              <button onClick={saveNotes} disabled={saving} className="btn-gold-outline mt-3">
                {saving ? 'Saving…' : 'Save Notes'}
              </button>
            </div>

            {/* Status */}
            <div>
              <label className="field-label">Status</label>
              <div className="flex gap-2 flex-wrap">
                {(['new', 'contacted', 'callback', 'hot', 'appointment', 'closed', 'dnc'] as const).map(s => (
                  <button
                    key={s}
                    disabled={selected.status === s}
                    onClick={() => setStatus(s)}
                    className="px-3 py-1.5 rounded text-[9px] tracking-widest uppercase font-semibold border transition-colors"
                    style={selected.status === s
                      ? { borderColor: '#C9A84C', color: '#9A7A2E', background: 'rgba(201,168,76,0.08)', cursor: 'default' }
                      : s === 'dnc'
                      ? { borderColor: '#fca5a5', color: '#ef4444', background: 'transparent' }
                      : { borderColor: '#E0E0E0', color: '#888', background: 'transparent' }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>

      {showImport && (
        <CsvImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { loadContacts(); }}
        />
      )}

      {/* ── Add Contact Modal ─────────────────────────── */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#C9A84C', fontWeight: 700, marginBottom: 2 }}>New Contact</div>
                <div style={{ fontSize: 16, fontWeight: 300, color: '#111' }}>Add to CRM</div>
              </div>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af' }}>✕</button>
            </div>

            {/* Form */}
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>First Name *</label>
                  <input className="field-input" value={newContact.firstName} onChange={e => setNewContact(p => ({ ...p, firstName: e.target.value }))} placeholder="John" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Last Name</label>
                  <input className="field-input" value={newContact.lastName} onChange={e => setNewContact(p => ({ ...p, lastName: e.target.value }))} placeholder="Smith" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Phone *</label>
                <input className="field-input" value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} placeholder="+14155551234" />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Email</label>
                <input className="field-input" value={newContact.email} onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))} placeholder="john@email.com" />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Address</label>
                <input className="field-input" value={newContact.address} onChange={e => setNewContact(p => ({ ...p, address: e.target.value }))} placeholder="123 Main St" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>City</label>
                  <input className="field-input" value={newContact.city} onChange={e => setNewContact(p => ({ ...p, city: e.target.value }))} placeholder="Baltimore" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>State</label>
                  <input className="field-input" value={newContact.state} onChange={e => setNewContact(p => ({ ...p, state: e.target.value }))} placeholder="MD" />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Zip</label>
                  <input className="field-input" value={newContact.zip} onChange={e => setNewContact(p => ({ ...p, zip: e.target.value }))} placeholder="21201" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Lead Type</label>
                <select className="field-input" value={newContact.source} onChange={e => setNewContact(p => ({ ...p, source: e.target.value }))}>
                  <option value="manual">Manual</option>
                  <option value="expired">Expired Listing</option>
                  <option value="fsbo">FSBO</option>
                  <option value="circle">Circle Prospect</option>
                  <option value="past-client">Past Client</option>
                </select>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAdd(false)} className="btn-gold-outline px-5 py-2 text-xs">Cancel</button>
              <button onClick={saveNewContact} disabled={addSaving} className="btn-gold px-6 py-2 text-xs">
                {addSaving ? 'Saving…' : 'Save Contact'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
