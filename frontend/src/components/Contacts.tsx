import React, { useState, useEffect, useCallback } from 'react';
import CsvImportModal from './CsvImportModal';
import { useToast } from './Toast';
import { API_BASE, authFetch } from '../config';

const GOLD = '#C9A84C';
const DARK = '#0A0A0A';
const UNGROUPED = '__ungrouped__';
const GROUPS_KEY = 'propel_contact_groups';

const STATUS_COLORS: Record<string, string> = {
  hot:       '#ef4444',
  callback:  '#C9A84C',
  new:       '#9ca3af',
  contacted: '#3b82f6',
  dnc:       '#d1d5db',
};

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
  contactGroup?: string | null;
  leadScore?: number;
  createdAt: string;
  calls?: Array<{ id: string; disposition?: string; calledAt: string; duration: number }>;
}

interface ContactsProps {
  onNavigate?: (page: string) => void;
}

function fmtPhone(p: string) {
  const d = p.replace(/\D/g, '').replace(/^1/, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return p;
}

export default function Contacts({ onNavigate }: ContactsProps) {
  const toast = useToast();

  const [contacts, setContacts]   = useState<Contact[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');

  // Groups stored in localStorage so empty groups persist across reloads
  const [groups, setGroups] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); } catch { return []; }
  });

  // Drag state
  const [draggingId, setDraggingId]     = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  // Selected contact (detail panel)
  const [selected, setSelected]   = useState<Contact | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving]       = useState(false);

  // New group creation
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName]   = useState('');

  // Rename group
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameValue, setRenameValue]     = useState('');

  // Add contact modal
  const [showAdd, setShowAdd]       = useState<string | null>(null);
  const [newContact, setNewContact] = useState({ firstName: '', lastName: '', phone: '', email: '', address: '' });
  const [addSaving, setAddSaving]   = useState(false);

  // CSV import
  const [showImport, setShowImport] = useState(false);

  // ─── Data loading ──────────────────────────────────────────────────────────
  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch(`${API_BASE}/contacts?limit=500`);
      const data = await r.json();
      setContacts(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // Persist groups list to localStorage
  useEffect(() => {
    localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  }, [groups]);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const contactsInGroup = useCallback((group: string): Contact[] => {
    const q = search.toLowerCase();
    return contacts.filter(c => {
      const matchGroup = group === UNGROUPED
        ? !c.contactGroup || c.contactGroup === ''
        : c.contactGroup === group;
      if (!matchGroup) return false;
      if (!q) return true;
      return (
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.address || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, search]);

  // ─── Drag & drop ──────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, contactId: string) => {
    setDraggingId(contactId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: React.DragEvent, group: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroup(group);
  };

  const onDrop = async (e: React.DragEvent, group: string) => {
    e.preventDefault();
    setDragOverGroup(null);
    if (!draggingId) return;
    const newGroup = group === UNGROUPED ? null : group;
    setContacts(prev => prev.map(c => c.id === draggingId ? { ...c, contactGroup: newGroup } : c));
    setDraggingId(null);
    try {
      await authFetch(`${API_BASE}/contacts/${draggingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactGroup: newGroup }),
      });
    } catch {
      toast.error('Failed to move contact');
      loadContacts();
    }
  };

  const onDragEnd = () => { setDraggingId(null); setDragOverGroup(null); };

  // ─── Group management ─────────────────────────────────────────────────────
  const createGroup = () => {
    const name = newGroupName.trim();
    if (!name || groups.includes(name)) return;
    setGroups(prev => [...prev, name]);
    setCreatingGroup(false);
    setNewGroupName('');
  };

  const renameGroup = async (oldName: string) => {
    const newName = renameValue.trim();
    setRenamingGroup(null);
    if (!newName || newName === oldName) return;
    const affected = contacts.filter(c => c.contactGroup === oldName);
    setContacts(prev => prev.map(c => c.contactGroup === oldName ? { ...c, contactGroup: newName } : c));
    setGroups(prev => prev.map(g => g === oldName ? newName : g));
    if (selected?.contactGroup === oldName) setSelected(s => s ? { ...s, contactGroup: newName } : null);
    await Promise.all(affected.map(c =>
      authFetch(`${API_BASE}/contacts/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactGroup: newName }),
      })
    ));
  };

  const deleteGroup = async (name: string) => {
    if (!window.confirm(`Delete "${name}"? Contacts will become ungrouped.`)) return;
    const affected = contacts.filter(c => c.contactGroup === name);
    setContacts(prev => prev.map(c => c.contactGroup === name ? { ...c, contactGroup: null } : c));
    setGroups(prev => prev.filter(g => g !== name));
    await Promise.all(affected.map(c =>
      authFetch(`${API_BASE}/contacts/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactGroup: null }),
      })
    ));
  };

  // ─── Add contact ──────────────────────────────────────────────────────────
  const saveContact = async () => {
    if (!newContact.firstName || !newContact.phone) { toast.error('Name and phone required'); return; }
    setAddSaving(true);
    try {
      const res = await authFetch(`${API_BASE}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newContact,
          source: 'manual',
          contactGroup: showAdd === UNGROUPED ? null : showAdd,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast.success('Contact added');
      setShowAdd(null);
      setNewContact({ firstName: '', lastName: '', phone: '', email: '', address: '' });
      loadContacts();
    } catch { toast.error('Could not save contact'); }
    setAddSaving(false);
  };

  // ─── Notes ────────────────────────────────────────────────────────────────
  const saveNotes = async () => {
    if (!selected) return;
    setSaving(true);
    await authFetch(`${API_BASE}/contacts/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: editNotes }),
    });
    setSaving(false);
    setContacts(prev => prev.map(c => c.id === selected.id ? { ...c, notes: editNotes } : c));
    setSelected(prev => prev ? { ...prev, notes: editNotes } : null);
    toast.success('Notes saved');
  };

  // ─── Dial group ───────────────────────────────────────────────────────────
  const dialGroup = (group: string) => {
    const label = group === UNGROUPED ? 'Ungrouped' : group;
    localStorage.setItem('dialerGroupFilter', JSON.stringify({
      type: group === UNGROUPED ? 'all' : 'group',
      value: group === UNGROUPED ? undefined : group,
      label,
      count: contactsInGroup(group).length,
    }));
    onNavigate?.('dialer');
  };

  const allColumns = [UNGROUPED, ...groups];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.07)',
        padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <span style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 20, fontWeight: 300, letterSpacing: '0.12em', color: DARK }}>
          Contacts
        </span>
        <div style={{ width: 1, height: 18, background: '#e5e7eb' }} />
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: 220, padding: '6px 12px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', background: '#fafafa' }}
        />
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowImport(true)}
          style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', background: 'transparent', color: '#6b7280', cursor: 'pointer' }}
        >
          Import CSV
        </button>
        <button
          onClick={() => { setCreatingGroup(true); setNewGroupName(''); }}
          style={{ padding: '6px 16px', borderRadius: 7, border: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', background: DARK, color: '#fff', cursor: 'pointer' }}
        >
          + New Group
        </button>
      </div>

      {/* ── Kanban board ────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowX: 'auto', overflowY: 'hidden',
        display: 'flex', gap: 14, padding: '18px 20px',
        alignItems: 'flex-start',
      }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#9ca3af', fontSize: 13 }}>
            Loading contacts…
          </div>
        ) : (
          <>
            {allColumns.map(group => {
              const cards       = contactsInGroup(group);
              const isOver      = dragOverGroup === group;
              const isUngrouped = group === UNGROUPED;
              const label       = isUngrouped ? 'Ungrouped' : group;
              const isRenaming  = renamingGroup === group;

              return (
                <div
                  key={group}
                  onDragOver={e => onDragOver(e, group)}
                  onDrop={e => onDrop(e, group)}
                  onDragLeave={() => dragOverGroup === group && setDragOverGroup(null)}
                  style={{
                    width: 256,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    background: isOver ? 'rgba(201,168,76,0.04)' : '#fff',
                    borderRadius: 14,
                    border: `1.5px solid ${isOver ? 'rgba(201,168,76,0.45)' : 'rgba(0,0,0,0.07)'}`,
                    transition: 'border-color 0.15s, background 0.15s',
                    maxHeight: 'calc(100vh - 130px)',
                    overflow: 'hidden',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                  }}
                >
                  {/* Column header */}
                  <div style={{ padding: '13px 14px 10px', borderBottom: '1px solid rgba(0,0,0,0.05)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onBlur={() => renameGroup(group)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') renameGroup(group);
                            if (e.key === 'Escape') setRenamingGroup(null);
                          }}
                          style={{
                            flex: 1, fontSize: 13, fontWeight: 700,
                            border: 'none', borderBottom: `2px solid ${GOLD}`,
                            outline: 'none', background: 'transparent',
                            padding: '2px 0', color: DARK,
                          }}
                        />
                      ) : (
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: DARK, letterSpacing: '0.01em' }}>
                          {label}
                        </span>
                      )}
                      <span style={{
                        fontSize: 10, color: '#9ca3af', background: '#f3f4f6',
                        borderRadius: 10, padding: '1px 7px', fontWeight: 600,
                      }}>
                        {cards.length}
                      </span>
                      {!isUngrouped && !isRenaming && (
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button
                            onClick={() => { setRenamingGroup(group); setRenameValue(group); }}
                            title="Rename"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 5px', borderRadius: 4, fontSize: 12, lineHeight: 1 }}
                          >✏️</button>
                          <button
                            onClick={() => deleteGroup(group)}
                            title="Delete group"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', padding: '2px 5px', borderRadius: 4, fontSize: 12, lineHeight: 1 }}
                          >✕</button>
                        </div>
                      )}
                    </div>

                    {/* Add + Dial buttons */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setShowAdd(group)}
                        style={{
                          flex: 1, padding: '5px 0', borderRadius: 6,
                          border: '1.5px dashed #e5e7eb', fontSize: 10, fontWeight: 600,
                          letterSpacing: '0.06em', textTransform: 'uppercase',
                          color: '#9ca3af', background: 'transparent', cursor: 'pointer',
                        }}
                      >
                        + Add
                      </button>
                      {cards.length > 0 && (
                        <button
                          onClick={() => dialGroup(group)}
                          style={{
                            padding: '5px 12px', borderRadius: 6, border: 'none',
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                            textTransform: 'uppercase', color: '#fff', background: DARK,
                            cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          Dial
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Cards */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 8px' }}>
                    {cards.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '28px 0', color: isOver ? GOLD : '#d1d5db', fontSize: 12, transition: 'color 0.15s' }}>
                        {isOver ? '⬇ Drop here' : 'No contacts'}
                      </div>
                    ) : (
                      cards.map(c => (
                        <div
                          key={c.id}
                          draggable
                          onDragStart={e => onDragStart(e, c.id)}
                          onDragEnd={onDragEnd}
                          onClick={() => { setSelected(c); setEditNotes(c.notes || ''); }}
                          style={{
                            background: selected?.id === c.id ? 'rgba(201,168,76,0.06)' : '#fafafa',
                            borderRadius: 9,
                            border: `1px solid ${selected?.id === c.id ? 'rgba(201,168,76,0.3)' : 'rgba(0,0,0,0.06)'}`,
                            padding: '10px 12px',
                            marginBottom: 6,
                            cursor: 'grab',
                            opacity: draggingId === c.id ? 0.4 : 1,
                            transition: 'opacity 0.1s, border-color 0.1s, background 0.1s',
                            userSelect: 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontWeight: 600, fontSize: 13, color: DARK,
                                marginBottom: 3, whiteSpace: 'nowrap',
                                overflow: 'hidden', textOverflow: 'ellipsis',
                              }}>
                                {c.firstName} {c.lastName}
                              </div>
                              <div style={{ fontSize: 11, color: GOLD, fontFamily: 'monospace', letterSpacing: '0.01em' }}>
                                {fmtPhone(c.phone)}
                              </div>
                              {c.address && (
                                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {c.address}
                                </div>
                              )}
                            </div>
                            {/* Status dot */}
                            <div
                              title={c.status}
                              style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[c.status] || '#9ca3af', flexShrink: 0, marginTop: 4 }}
                            />
                          </div>
                          {c.calls && c.calls.length > 0 && (
                            <div style={{ marginTop: 6, fontSize: 10, color: '#9ca3af' }}>
                              {c.calls.length} call{c.calls.length !== 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}

            {/* ── New group creation column ──── */}
            {creatingGroup && (
              <div style={{
                width: 256, flexShrink: 0, background: '#fff', borderRadius: 14,
                border: '1.5px dashed rgba(201,168,76,0.5)', padding: '16px 14px',
                display: 'flex', flexDirection: 'column', gap: 10,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: GOLD }}>
                  New Group
                </div>
                <input
                  autoFocus
                  placeholder="e.g. AYC Group"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') createGroup(); if (e.key === 'Escape') setCreatingGroup(false); }}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none' }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={createGroup} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: DARK, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Create
                  </button>
                  <button onClick={() => setCreatingGroup(false)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'transparent', color: '#9ca3af', fontSize: 12, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Empty state ─────────────────── */}
            {groups.length === 0 && !creatingGroup && contacts.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16, paddingBottom: 40 }}>
                <div style={{ fontSize: 52, opacity: 0.3 }}>👥</div>
                <div style={{ fontSize: 17, fontWeight: 300, letterSpacing: '0.08em', color: '#9ca3af' }}>No contacts yet</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button onClick={() => setCreatingGroup(true)} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: DARK, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Create a Group
                  </button>
                  <button onClick={() => setShowImport(true)} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer' }}>
                    Import CSV
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Contact detail side panel ──────────────────────────────────── */}
      {selected && (
        <>
          {/* Backdrop on mobile */}
          <div
            onClick={() => setSelected(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 99, display: 'block' }}
            className="md:hidden"
          />
          <div style={{
            position: 'fixed', top: 49, right: 0, bottom: 0, width: 320,
            background: '#fff', borderLeft: '1px solid rgba(0,0,0,0.07)',
            boxShadow: '-6px 0 30px rgba(0,0,0,0.07)',
            display: 'flex', flexDirection: 'column', zIndex: 100,
          }}>
            {/* Header */}
            <div style={{ padding: '16px 18px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, fontWeight: 700, marginBottom: 4 }}>
                  {selected.contactGroup || 'Ungrouped'}
                </div>
                <div style={{ fontSize: 19, fontWeight: 300, color: DARK, letterSpacing: '0.02em' }}>
                  {selected.firstName} {selected.lastName}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9ca3af', padding: '2px 4px', marginTop: -2 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: 22 }}>

              {/* Info rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Phone',   value: selected.phone, mono: true },
                  selected.email   ? { label: 'Email',   value: selected.email }   : null,
                  selected.address ? { label: 'Address', value: [selected.address, selected.city].filter(Boolean).join(', ') } : null,
                ].filter(Boolean).map((row: any) => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', flexShrink: 0, marginTop: 2 }}>{row.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right', color: row.mono ? GOLD : DARK, fontFamily: row.mono ? 'monospace' : undefined }}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Status pills */}
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Status</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['new', 'contacted', 'callback', 'hot', 'dnc'] as const).map(s => (
                    <button
                      key={s}
                      onClick={async () => {
                        await authFetch(`${API_BASE}/contacts/${selected.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: s }),
                        });
                        setContacts(prev => prev.map(c => c.id === selected.id ? { ...c, status: s } : c));
                        setSelected(prev => prev ? { ...prev, status: s } : null);
                      }}
                      style={{
                        padding: '4px 11px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                        letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
                        border: `1.5px solid ${selected.status === s ? (STATUS_COLORS[s] || '#9ca3af') : '#e5e7eb'}`,
                        background: selected.status === s ? `${STATUS_COLORS[s]}18` : 'transparent',
                        color: selected.status === s ? (STATUS_COLORS[s] || '#374151') : '#9ca3af',
                        transition: 'all 0.1s',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Move to group */}
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Group</div>
                <select
                  value={selected.contactGroup || ''}
                  onChange={async e => {
                    const val = e.target.value || null;
                    await authFetch(`${API_BASE}/contacts/${selected.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ contactGroup: val }),
                    });
                    setContacts(prev => prev.map(c => c.id === selected.id ? { ...c, contactGroup: val } : c));
                    setSelected(prev => prev ? { ...prev, contactGroup: val } : null);
                  }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, background: '#fafafa', outline: 'none' }}
                >
                  <option value="">Ungrouped</option>
                  {groups.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>

              {/* Call history */}
              {selected.calls && selected.calls.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Call History</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selected.calls.map((call, i) => (
                      <div key={i} style={{ background: '#fafafa', borderRadius: 8, padding: '9px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                          <span style={{ fontWeight: 500, color: '#374151', textTransform: 'capitalize' }}>
                            {call.disposition?.replace(/-/g, ' ') || 'No disposition'}
                          </span>
                          <span style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: 11 }}>
                            {Math.floor(call.duration / 60)}:{String(call.duration % 60).padStart(2, '0')}
                          </span>
                        </div>
                        <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 3 }}>
                          {new Date(call.calledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Notes</div>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={4}
                  placeholder="Add notes…"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, resize: 'none', outline: 'none', background: '#fafafa', boxSizing: 'border-box', lineHeight: 1.5 }}
                />
                <button
                  onClick={saveNotes}
                  disabled={saving}
                  style={{ marginTop: 7, padding: '7px 16px', borderRadius: 7, border: '1px solid rgba(201,168,76,0.4)', background: 'transparent', color: '#9A7A2E', fontSize: 11, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', letterSpacing: '0.06em' }}
                >
                  {saving ? 'Saving…' : 'Save Notes'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Add Contact modal ──────────────────────────────────────────── */}
      {showAdd !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 400, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: GOLD, fontWeight: 700, marginBottom: 3 }}>
                  {showAdd === UNGROUPED ? 'Ungrouped' : showAdd}
                </div>
                <div style={{ fontSize: 17, fontWeight: 300, color: DARK }}>Add Contact</div>
              </div>
              <button onClick={() => setShowAdd(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#9ca3af' }}>✕</button>
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>First Name *</label>
                  <input
                    value={newContact.firstName}
                    onChange={e => setNewContact(p => ({ ...p, firstName: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Last Name</label>
                  <input
                    value={newContact.lastName}
                    onChange={e => setNewContact(p => ({ ...p, lastName: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Phone *</label>
                <input
                  value={newContact.phone}
                  onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+14155551234"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Email</label>
                <input
                  value={newContact.email}
                  onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Address</label>
                <input
                  value={newContact.address}
                  onChange={e => setNewContact(p => ({ ...p, address: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAdd(null)} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'transparent', color: '#6b7280', fontSize: 12, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveContact} disabled={addSaving} style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: DARK, color: '#fff', fontSize: 12, fontWeight: 600, cursor: addSaving ? 'not-allowed' : 'pointer' }}>
                {addSaving ? 'Saving…' : 'Add Contact'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <CsvImportModal onClose={() => setShowImport(false)} onImported={() => loadContacts()} />
      )}
    </div>
  );
}
