import React, { useState, useEffect, useRef } from 'react';
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
  const [mobileStage, setMobileStage] = useState('hot'); // mobile tab-based stage
  const dragRef = useRef<Contact | null>(null);

  const loadContacts = async () => {
    setLoading(true);
    // Load all statuses including appointment and closed
    const [regular, appt, closed] = await Promise.all([
      authFetch(`${API_BASE}/contacts?limit=500`).then(r => r.json()).then(d => Array.isArray(d) ? d : []).catch(() => []),
      authFetch(`${API_BASE}/contacts?status=appointment&limit=200`).then(r => r.json()).then(d => Array.isArray(d) ? d : []).catch(() => []),
      authFetch(`${API_BASE}/contacts?status=closed&limit=200`).then(r => r.json()).then(d => Array.isArray(d) ? d : []).catch(() => []),
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
    await authFetch(`${API_BASE}/contacts/${contactId}`, {
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
    <div className="flex flex-col h-[calc(100dvh-109px)] md:h-[calc(100vh-49px)]">

      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-8 py-3 bg-white border-b"
           style={{ borderColor: 'rgba(201,168,76,0.15)' }}>
        <div>
          <h1 className="font-serif font-light text-xl text-black tracking-wide">Pipeline</h1>
          <div className="text-[9px] tracking-widest uppercase text-gray-400 mt-0.5 hidden sm:block">
            {contacts.length} contacts · {byColumn('hot').length} hot · {byColumn('appointment').length} appts · {byColumn('closed').length} closed
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="field-input text-xs w-28 md:w-48"
          />
          <button onClick={loadContacts} className="btn-ghost px-3 py-1.5 text-xs">↺</button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-300 text-sm tracking-widest uppercase">Loading pipeline…</div>
        </div>
      ) : (
        <>
          {/* ── MOBILE: tab-based stage view ───────────────────── */}
          <div className="flex flex-col flex-1 md:hidden min-h-0">
            {/* Stage tabs */}
            <div className="flex overflow-x-auto hide-scrollbar border-b bg-white" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
              {COLUMNS.map(col => {
                const count = byColumn(col.id).length;
                const active = mobileStage === col.id;
                return (
                  <button
                    key={col.id}
                    onClick={() => setMobileStage(col.id)}
                    className="flex-shrink-0 flex flex-col items-center px-4 py-2.5 relative"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                  >
                    {active && (
                      <span style={{
                        position: 'absolute', bottom: 0, left: '15%', right: '15%',
                        height: 2, borderRadius: '2px 2px 0 0', background: col.color,
                      }} />
                    )}
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: active ? col.color : '#bbb', whiteSpace: 'nowrap',
                    }}>{col.label}</span>
                    <span style={{
                      fontSize: 14, fontWeight: 300, color: active ? col.color : '#ccc', marginTop: 1,
                    }}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Cards for active stage */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ background: '#f8f8f8' }}>
              {(() => {
                const col = COLUMNS.find(c => c.id === mobileStage)!;
                const cards = byColumn(mobileStage);
                if (cards.length === 0) return (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div style={{ fontSize: 36, marginBottom: 10 }}>🏆</div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>No contacts in this stage</div>
                  </div>
                );
                return cards.map(c => (
                  <div
                    key={c.id}
                    onClick={() => setDetailContact(c)}
                    className="bg-white rounded-xl border p-4 cursor-pointer active:scale-[0.98] transition-transform"
                    style={{ borderColor: col.color + '25', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>
                          {c.firstName} {c.lastName}
                        </div>
                        <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#C9A84C', marginTop: 2 }}>{c.phone}</div>
                      </div>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                        padding: '3px 8px', borderRadius: 99, background: col.color + '15', color: col.color,
                        border: `1px solid ${col.color}30`, flexShrink: 0, marginTop: 2,
                      }}>
                        {SOURCE_LABELS[c.source] || c.source}
                      </span>
                    </div>
                    {c.address && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>📍 {c.address}{c.city ? `, ${c.city}` : ''}</div>
                    )}
                    {/* Move stage row */}
                    <div className="flex gap-1.5 mt-3 flex-wrap" onClick={e => e.stopPropagation()}>
                      {COLUMNS.filter(opt => opt.id !== mobileStage).map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => { moveContact(c.id, opt.id); setMobileStage(opt.id); }}
                          style={{
                            fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                            padding: '4px 8px', borderRadius: 6,
                            border: `1px solid ${opt.color}30`, color: opt.color,
                            background: opt.color + '0D', cursor: 'pointer',
                          }}
                        >
                          → {opt.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 9, color: '#d1d5db', marginTop: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {c.calls && c.calls.length > 0
                        ? `Last called ${timeSince(c.calls[0].calledAt)}`
                        : `Added ${timeSince(c.updatedAt)}`}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* ── DESKTOP: full kanban ────────────────────────────── */}
          <div className="hidden md:flex flex-1 gap-0 overflow-x-auto min-h-0">
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
                  <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(201,168,76,0.1)', background: col.bgColor }}>
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: col.color }}>
                        {col.label}
                      </div>
                      <div className="text-[10px] font-mono rounded-full px-2 py-0.5" style={{ background: col.color + '18', color: col.color }}>
                        {cards.length}
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {cards.length === 0 && (
                      <div className="text-center py-8 text-gray-300 text-xs tracking-widest uppercase">Drop here</div>
                    )}
                    {cards.map(c => (
                      <div
                        key={c.id}
                        draggable
                        onDragStart={() => onDragStart(c)}
                        onDragEnd={onDragEnd}
                        onClick={() => setDetailContact(c)}
                        className="bg-white rounded-lg border p-3 cursor-grab active:cursor-grabbing hover:shadow-sm transition-all select-none"
                        style={{ borderColor: dragging?.id === c.id ? col.color : '#E8E8E8', opacity: dragging?.id === c.id ? 0.4 : 1 }}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="font-medium text-black text-sm leading-tight">{c.firstName} {c.lastName}</div>
                          <span className="text-[8px] tracking-widest uppercase ml-1 shrink-0 mt-0.5" style={{ color: col.color }}>
                            {SOURCE_LABELS[c.source] || c.source}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono mt-0.5" style={{ color: '#C9A84C' }}>{c.phone}</div>
                        {c.address && <div className="text-[10px] text-gray-400 mt-1 truncate">{c.address}</div>}
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
        </>
      )}

      {/* Contact detail drawer */}
      {detailContact && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setDetailContact(null)}>
          <div className="flex-1" />
          <div
            className="w-full md:w-80 bg-white shadow-2xl border-l p-5 md:p-6 overflow-y-auto flex flex-col gap-5"
            style={{ borderColor: 'rgba(201,168,76,0.2)', paddingBottom: 'max(20px, calc(env(safe-area-inset-bottom) + 80px))' }}
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
