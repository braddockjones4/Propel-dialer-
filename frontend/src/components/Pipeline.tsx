import React, { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../config';


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
  updatedAt: string;
  calls?: Array<{ calledAt: string; disposition?: string }>;
}

const COLUMNS: { id: string; label: string; color: string; bgColor: string }[] = [
  { id: 'new',         label: 'New Leads',   color: '#888',     bgColor: '#F8F8F8' },
  { id: 'contacted',   label: 'Contacted',   color: '#3B82F6',  bgColor: '#EFF6FF' },
  { id: 'hot',         label: 'Hot Leads',   color: '#C9A84C',  bgColor: 'rgba(201,168,76,0.06)' },
  { id: 'appointment', label: 'Appointment', color: '#8B5CF6',  bgColor: '#F5F3FF' },
  { id: 'closed',      label: 'Closed',      color: '#22C55E',  bgColor: '#F0FDF4' },
];

const SOURCE_LABELS: Record<string, string> = {
  expired: 'Exp', fsbo: 'FSBO', circle: 'Circle',
  'past-client': 'PC', manual: 'Manual',
};

function timeSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return '1d ago';
  if (d < 7)  return `${d}d ago`;
  if (d < 30) return `${Math.floor(d/7)}w ago`;
  return `${Math.floor(d/30)}mo ago`;
}

export default function Pipeline() {
  const [contacts, setContacts]     = useState<Contact[]>([]);
  const [loading, setLoading]       = useState(true);
  const [dragging, setDragging]     = useState<Contact | null>(null);
  const [overCol, setOverCol]       = useState<string | null>(null);
  const [search, setSearch]         = useState('');
  const [detailContact, setDetailContact] = useState<Contact | null>(null);
  const dragRef = useRef<Contact | null>(null);

  const loadContacts = async () => {
    setLoading(true);
    // Load all statuses including appointment and closed
    const [regular, appt, closed] = await Promise.all([
      fetch(`${API_BASE}/contacts?limit=500`).then(r => r.json()).catch(() => []),
      fetch(`${API_BASE}/contacts?status=appointment&limit=200`).then(r => r.json()).catch(() => []),
      fetch(`${API_BASE}/contacts?status=closed&limit=200`).then(r => r.json()).catch(() => []),
    ]);
    // Merge and dedupe by id
    const all = [...regular, ...appt, ...closed];
    const seen = new Set<string>();
    const deduped = all.filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    setContacts(deduped);
    setLoading(false);
  };

  useEffect(() => { loadContacts(); }, []);

  const moveContact = async (contactId: string, newStatus: string) => {
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status: newStatus } : c));
    await fetch(`${API_BASE}/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
  };

  // Drag events
  const onDragStart = (c: Contact) => { setDragging(c); dragRef.current = c; };
  const onDragEnd   = () => { setDragging(null); dragRef.current = null; setOverCol(null); };
  const onDragOver  = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setOverCol(colId);
  };
  const onDrop = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    const c = dragRef.current;
    if (c && c.status !== colId) moveContact(c.id, colId);
    setOverCol(null);
    setDragging(null);
  };

  const filterQ = search.toLowerCase();
  const filtered = contacts.filter(c =>
    !filterQ ||
    `${c.firstName} ${c.lastName}`.toLowerCase().includes(filterQ) ||
    c.phone.includes(filterQ) ||
    (c.address || '').toLowerCase().includes(filterQ)
  );

  const byColumn = (colId: string) => filtered.filter(c => c.status === colId);

  const totalValue = byColumn('appointment').length + byColumn('closed').length;

  return (
    <div className="flex flex-col h-[calc(100vh-49px)]">

      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 bg-white border-b"
           style={{ borderColor: 'rgba(201,168,76,0.15)' }}>
        <div>
          <h1 className="font-serif font-light text-xl text-black tracking-wide">Pipeline</h1>
          <div className="text-[9px] tracking-widest uppercase text-gray-400 mt-0.5">
            {contacts.length} contacts · {byColumn('hot').length} hot · {byColumn('appointment').length} appointments · {byColumn('closed').length} closed
          </div>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className="field-input text-xs w-48"
          />
          <button onClick={loadContacts} className="btn-ghost px-3 py-1.5 text-xs">Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-300 text-sm tracking-widest uppercase">Loading pipeline…</div>
        </div>
      ) : (
        <div className="flex-1 flex gap-0 overflow-x-auto min-h-0">
          {COLUMNS.map(col => {
            const cards = byColumn(col.id);
            const isOver = overCol === col.id;
            return (
              <div
                key={col.id}
                className="flex flex-col min-w-[220px] flex-1 border-r border-gray-100 transition-colors"
                style={{ background: isOver ? col.bgColor : 'white' }}
                onDragOver={e => onDragOver(e, col.id)}
                onDragLeave={() => setOverCol(null)}
                onDrop={e => onDrop(e, col.id)}
              >
                {/* Column header */}
                <div className="px-4 py-3 border-b"
                     style={{ borderColor: 'rgba(201,168,76,0.1)', background: col.bgColor }}>
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-semibold tracking-widest uppercase"
                         style={{ color: col.color }}>
                      {col.label}
                    </div>
                    <div className="text-[10px] font-mono rounded-full px-2 py-0.5"
                         style={{ background: col.color + '18', color: col.color }}>
                      {cards.length}
                    </div>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {cards.length === 0 && (
                    <div className="text-center py-8 text-gray-300 text-xs tracking-widest uppercase">
                      Drop here
                    </div>
                  )}
                  {cards.map(c => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => onDragStart(c)}
                      onDragEnd={onDragEnd}
                      onClick={() => setDetailContact(c)}
                      className="bg-white rounded-lg border p-3 cursor-grab active:cursor-grabbing hover:shadow-sm transition-all select-none"
                      style={{
                        borderColor: dragging?.id === c.id ? col.color : '#E8E8E8',
                        opacity: dragging?.id === c.id ? 0.4 : 1,
                      }}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <div className="font-medium text-black text-sm leading-tight">
                          {c.firstName} {c.lastName}
                        </div>
                        <span className="text-[8px] tracking-widest uppercase ml-1 shrink-0 mt-0.5"
                              style={{ color: col.color }}>
                          {SOURCE_LABELS[c.source] || c.source}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono mt-0.5" style={{ color: '#C9A84C' }}>{c.phone}</div>
                      {c.address && (
                        <div className="text-[10px] text-gray-400 mt-1 truncate">{c.address}</div>
                      )}
                      <div className="text-[9px] text-gray-300 mt-2 tracking-widest uppercase">
                        {c.calls && c.calls.length > 0
                          ? `Last called ${timeSince(c.calls[0].calledAt)}`
                          : `Added ${timeSince(c.updatedAt)}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Contact detail drawer */}
      {detailContact && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setDetailContact(null)}>
          <div className="flex-1" />
          <div
            className="w-80 h-full bg-white shadow-2xl border-l p-6 overflow-y-auto flex flex-col gap-5"
            style={{ borderColor: 'rgba(201,168,76,0.2)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-serif font-light text-xl text-black">
                  {detailContact.firstName} {detailContact.lastName}
                </h3>
                <div className="text-xs font-mono mt-1" style={{ color: '#C9A84C' }}>{detailContact.phone}</div>
              </div>
              <button onClick={() => setDetailContact(null)} className="text-gray-300 hover:text-black text-lg">✕</button>
            </div>

            <div className="gold-line" />

            {detailContact.address && (
              <div>
                <div className="field-label">Address</div>
                <div className="text-sm text-gray-700">{detailContact.address}{detailContact.city ? `, ${detailContact.city}` : ''}</div>
              </div>
            )}

            <div>
              <div className="field-label mb-2">Move to Stage</div>
              <div className="space-y-1.5">
                {COLUMNS.map(col => (
                  <button
                    key={col.id}
                    onClick={() => { moveContact(detailContact.id, col.id); setDetailContact({ ...detailContact, status: col.id }); }}
                    className="w-full text-left px-3 py-2 rounded text-xs font-semibold tracking-widest uppercase transition-colors border"
                    style={detailContact.status === col.id
                      ? { borderColor: col.color, color: col.color, background: col.bgColor }
                      : { borderColor: '#E0E0E0', color: '#999' }}
                  >
                    {detailContact.status === col.id ? '✓ ' : ''}{col.label}
                  </button>
                ))}
              </div>
            </div>

            {detailContact.calls && detailContact.calls.length > 0 && (
              <div>
                <div className="field-label mb-2">Call History</div>
                <div className="space-y-1.5">
                  {detailContact.calls.slice(0, 5).map((call, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-gray-600 capitalize">{call.disposition?.replace(/-/g,' ') || '—'}</span>
                      <span className="text-gray-400">{timeSince(call.calledAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
