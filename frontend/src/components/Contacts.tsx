import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import CsvImportModal from './CsvImportModal';
import { useToast } from './Toast';
import { API_BASE, SOCKET_URL, authFetch } from '../config';
import { io as socketIo } from 'socket.io-client';

const GOLD  = '#C9A84C';
const DARK  = '#0A0A0A';
const UNGROUPED = '__ungrouped__';

// Group accent colours the user can choose
const GROUP_COLORS = [
  '#9ca3af', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6',
  '#ec4899', '#C9A84C',
];

const STATUS_COLORS: Record<string, string> = {
  hot:         '#ef4444',
  callback:    '#C9A84C',
  new:         '#9ca3af',
  contacted:   '#3b82f6',
  appointment: '#22c55e',
  closed:      '#14b8a6',
  dnc:         '#d1d5db',
};

interface ContactGroup {
  id: string;
  name: string;
  color: string;
  position: number;
  contactCount: number;
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  email?: string | null;
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
  sharedVcfText?: string;
}

function fmtPhone(p: string | null | undefined) {
  if (!p) return '';
  const d = p.replace(/\D/g, '').replace(/^1/, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return p;
}

export default function Contacts({ onNavigate, sharedVcfText }: ContactsProps) {
  const toast = useToast();

  // ── State ──────────────────────────────────────────────────────────────────
  const [contacts, setContacts]       = useState<Contact[]>([]);
  const [groups,   setGroups]         = useState<ContactGroup[]>([]);
  const [loading,  setLoading]        = useState(true);
  const [grpLoading, setGrpLoading]  = useState(true);
  const [search,   setSearch]         = useState('');

  // Drag state
  const [draggingId,    setDraggingId]    = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  // Selected contact detail panel
  const [selected,  setSelected]  = useState<Contact | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [saving,    setSaving]    = useState(false);

  // New group creation
  const [creatingGroup,  setCreatingGroup]  = useState(false);
  const [newGroupName,   setNewGroupName]   = useState('');
  const [newGroupColor,  setNewGroupColor]  = useState(GROUP_COLORS[0]);
  const [createSaving,   setCreateSaving]   = useState(false);

  // Rename / recolor group
  const [renamingGroup,  setRenamingGroup]  = useState<string | null>(null);  // group.id
  const [renameValue,    setRenameValue]    = useState('');
  const [renameColor,    setRenameColor]    = useState('');

  // Add contact modal
  const [showAdd,    setShowAdd]    = useState<string | null>(null);  // group name or UNGROUPED
  const [newContact, setNewContact] = useState({ firstName: '', lastName: '', phone: '', email: '', address: '' });
  const [addSaving,  setAddSaving]  = useState(false);

  // CSV import
  const [showImport, setShowImport] = useState(false);

  // Quick Add (dead-simple single contact form)
  const [showQuickAdd, setShowQuickAdd]   = useState(false);
  const [quickName,    setQuickName]      = useState('');
  const [quickPhone,   setQuickPhone]     = useState('');
  const [quickEmail,   setQuickEmail]     = useState('');
  const [quickAddress, setQuickAddress]   = useState('');
  const [quickSaving,  setQuickSaving]    = useState(false);

  // iCloud one-tap sync
  const [icloudConnected, setIcloudConnected] = useState(false);
  const [icloudSyncing,   setIcloudSyncing]   = useState(false);

  // Gmail contacts import
  const [showGmailImport,    setShowGmailImport]    = useState(false);
  const [gmailContacts,      setGmailContacts]      = useState<{ firstName: string; lastName: string; email: string | null; phone: string | null }[]>([]);
  const [gmailSelectedIds,   setGmailSelectedIds]   = useState<Set<number>>(new Set());
  const [gmailGroupName,     setGmailGroupName]     = useState('Gmail Contacts');
  const [gmailLoading,       setGmailLoading]       = useState(false);
  const [gmailImporting,     setGmailImporting]     = useState(false);
  const [gmailError,         setGmailError]         = useState<string | null>(null);
  const [gmailNeedsReauth,   setGmailNeedsReauth]   = useState(false);
  const [gmailNeedsPeopleApi, setGmailNeedsPeopleApi] = useState(false);

  // Multi-select
  const [selectMode,    setSelectMode]    = useState(false);
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [bulkGroupOpen, setBulkGroupOpen] = useState(false);

  // PWA share target — auto-open import modal when a .vcf was shared to the app
  useEffect(() => {
    if (sharedVcfText) {
      setShowImport(true);
    }
  }, [sharedVcfText]);

  // Mobile: which group column is currently displayed
  const [mobileGroup, setMobileGroup] = useState<string>(UNGROUPED);

  // Socket ref for cleanup
  const socketRef = useRef<ReturnType<typeof socketIo> | null>(null);

  // ── Socket: real-time agent group events ──────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('propel_token');
    const s = socketIo(SOCKET_URL, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = s;

    // Agent assigned a contact to a group — refresh both lists
    s.on('agent-group', () => {
      loadGroups();
      loadContacts();
    });

    return () => { s.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── iCloud status check ──────────────────────────────────────────────────
  useEffect(() => {
    authFetch(`${API_BASE}/contacts/icloud-status`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setIcloudConnected(d.connected); })
      .catch(() => {});
  }, []);

  const handleIcloudSync = async () => {
    setIcloudSyncing(true);
    try {
      const r = await authFetch(`${API_BASE}/contacts/icloud-sync`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || 'Sync failed'); return; }
      toast.success(`✓ ${j.imported} new contacts synced`);
      loadContacts();
    } catch { toast.error('Sync failed — try again'); }
    finally { setIcloudSyncing(false); }
  };

  // ── Gmail contacts import ────────────────────────────────────────────────
  const openGmailImport = async () => {
    setShowGmailImport(true);
    setGmailError(null);
    setGmailNeedsReauth(false);
    setGmailNeedsPeopleApi(false);
    setGmailContacts([]);
    setGmailSelectedIds(new Set());
    setGmailGroupName('Gmail Contacts');
    setGmailLoading(true);
    try {
      const r = await authFetch(`${API_BASE}/gmail/contacts`);
      if (r.status === 403) {
        const j = await r.json().catch(() => ({}));
        if (j.needsPeopleApi) {
          setGmailNeedsPeopleApi(true);
        } else {
          setGmailNeedsReauth(true);
        }
        setGmailLoading(false);
        return;
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setGmailError(j.error || 'Failed to fetch Gmail contacts');
        setGmailLoading(false);
        return;
      }
      const j = await r.json();
      setGmailContacts(j.contacts || []);
      // Select all by default
      setGmailSelectedIds(new Set((j.contacts || []).map((_: any, i: number) => i)));
    } catch {
      setGmailError('Could not reach server — try again');
    } finally {
      setGmailLoading(false);
    }
  };

  const handleGmailImport = async () => {
    const selected = gmailContacts.filter((_, i) => gmailSelectedIds.has(i));
    if (!selected.length) return;
    setGmailImporting(true);
    setGmailError(null);
    try {
      const r = await authFetch(`${API_BASE}/gmail/import-contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contacts: selected,
          groupName: gmailGroupName.trim() || 'Gmail Contacts',
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setGmailError(j.error || 'Import failed');
        return;
      }
      const { imported, enriched, skipped } = j as { imported: number; enriched: number; skipped: number };
      const parts: string[] = [];
      if (imported > 0)  parts.push(`${imported} new contacts added`);
      if (enriched > 0)  parts.push(`${enriched} existing contacts got email added`);
      if (skipped > 0)   parts.push(`${skipped} already in address book`);
      const base = parts.join(' · ') || 'All contacts already in your address book';
      toast.success(`✓ ${base} — check Email Contacts section`);
      setShowGmailImport(false);
      loadContacts();
      loadGroups();
    } catch {
      setGmailError('Import failed — try again');
    } finally {
      setGmailImporting(false);
    }
  };

  const handleQuickAdd = async () => {
    if (!quickPhone.trim()) return;
    setQuickSaving(true);
    try {
      const parts = quickName.trim().split(' ');
      const r = await authFetch(`${API_BASE}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' ') || '',
          phone: quickPhone.trim(),
          email: quickEmail.trim() || undefined,
          address: quickAddress.trim() || undefined,
          source: 'manual',
        }),
      });
      if (r.ok) {
        toast.success('Contact added');
        setShowQuickAdd(false);
        setQuickName(''); setQuickPhone(''); setQuickEmail(''); setQuickAddress('');
        loadContacts();
      } else {
        const j = await r.json().catch(() => ({}));
        toast.error(j.error || 'Failed to add contact');
      }
    } catch { toast.error('Network error — could not save contact'); }
    finally { setQuickSaving(false); }
  };

  // ── Multi-select helpers ─────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); setBulkGroupOpen(false); };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!window.confirm(`Delete ${ids.length} contact${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    await authFetch(`${API_BASE}/contacts/bulk`, { method: 'POST', body: JSON.stringify({ ids, action: 'delete' }) });
    setContacts(prev => prev.filter(c => !selectedIds.has(c.id)));
    exitSelectMode();
    loadGroups();
    toast.success(`${ids.length} contact${ids.length !== 1 ? 's' : ''} deleted`);
  };

  const bulkMoveToGroup = async (groupName: string) => {
    const ids = Array.from(selectedIds);
    await authFetch(`${API_BASE}/contacts/bulk`, { method: 'POST', body: JSON.stringify({ ids, action: 'setGroup', value: groupName || null }) });
    setContacts(prev => prev.map(c => selectedIds.has(c.id) ? { ...c, contactGroup: groupName || null } : c));
    exitSelectMode();
    loadGroups();
    toast.success(`${ids.length} contact${ids.length !== 1 ? 's' : ''} moved`);
  };

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadGroups = useCallback(async () => {
    setGrpLoading(true);
    try {
      const r = await authFetch(`${API_BASE}/contact-groups`);
      if (r.ok) {
        const data = await r.json();
        setGroups(Array.isArray(data) ? data : []);
      }
    } catch {}
    setGrpLoading(false);
  }, []);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch(`${API_BASE}/contacts?limit=500`);
      const data = await r.json();
      setContacts(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadGroups();
    loadContacts();
  }, [loadGroups, loadContacts]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const contactsInGroup = useCallback((groupName: string): Contact[] => {
    const q = search.toLowerCase();
    return contacts.filter(c => {
      if (!c.phone) return false; // phone-less (email-only) contacts shown in Email section
      const matchGroup = groupName === UNGROUPED
        ? !c.contactGroup || c.contactGroup === ''
        : c.contactGroup === groupName;
      if (!matchGroup) return false;
      if (!q) return true;
      return (
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.address || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, search]);

  // Email contacts — shown in dedicated section; includes any contact with an email address
  const gmailContactsList = useMemo(() => {
    const q = search.toLowerCase();
    return contacts.filter(c => {
      if (!c.email || c.email.trim() === '') return false;
      if (!q) return true;
      return (
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q)
      );
    });
  }, [contacts, search]);

  const groupByName = (name: string) => groups.find(g => g.name === name);

  // ── Drag & drop ──────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, contactId: string) => {
    setDraggingId(contactId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: React.DragEvent, groupName: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroup(groupName);
  };

  const onDrop = async (e: React.DragEvent, groupName: string) => {
    e.preventDefault();
    setDragOverGroup(null);
    if (!draggingId) return;
    const newGroup = groupName === UNGROUPED ? null : groupName;

    // Optimistic update
    setContacts(prev => prev.map(c => c.id === draggingId ? { ...c, contactGroup: newGroup } : c));
    setDraggingId(null);

    try {
      await authFetch(`${API_BASE}/contacts/${draggingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ contactGroup: newGroup }),
      });
      // Refresh group counts
      loadGroups();
    } catch {
      toast.error('Failed to move contact');
      loadContacts();
    }
  };

  const onDragEnd = () => { setDraggingId(null); setDragOverGroup(null); };

  // ── Group CRUD ────────────────────────────────────────────────────────────
  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    if (groups.some(g => g.name === name)) {
      toast.error(`Group "${name}" already exists`);
      return;
    }
    setCreateSaving(true);
    try {
      const r = await authFetch(`${API_BASE}/contact-groups`, {
        method: 'POST',
        body: JSON.stringify({ name, color: newGroupColor }),
      });
      if (!r.ok) {
        const err = await r.json();
        toast.error(err.error || 'Could not create group');
      } else {
        const g = await r.json();
        setGroups(prev => [...prev, g]);
        toast.success(`Group "${name}" created`);
      }
    } catch { toast.error('Network error'); }
    setCreateSaving(false);
    setCreatingGroup(false);
    setNewGroupName('');
    setNewGroupColor(GROUP_COLORS[0]);
  };

  const startRename = (g: ContactGroup) => {
    setRenamingGroup(g.id);
    setRenameValue(g.name);
    setRenameColor(g.color);
  };

  const commitRename = async (gId: string) => {
    setRenamingGroup(null);
    const newName  = renameValue.trim();
    const existing = groups.find(g => g.id === gId);
    if (!existing) return;
    if (!newName || (newName === existing.name && renameColor === existing.color)) return;

    // Optimistic UI
    setGroups(prev => prev.map(g => g.id === gId ? { ...g, name: newName, color: renameColor } : g));
    if (newName !== existing.name) {
      setContacts(prev => prev.map(c =>
        c.contactGroup === existing.name ? { ...c, contactGroup: newName } : c
      ));
      if (selected?.contactGroup === existing.name) {
        setSelected(s => s ? { ...s, contactGroup: newName } : null);
      }
    }

    try {
      const r = await authFetch(`${API_BASE}/contact-groups/${gId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: newName, color: renameColor }),
      });
      if (!r.ok) {
        toast.error('Rename failed');
        loadGroups(); loadContacts();
      } else {
        toast.success('Group updated');
      }
    } catch { toast.error('Network error'); loadGroups(); loadContacts(); }
  };

  const deleteGroup = async (g: ContactGroup) => {
    if (!window.confirm(`Delete "${g.name}"? Contacts will become ungrouped.`)) return;

    // Optimistic
    setContacts(prev => prev.map(c => c.contactGroup === g.name ? { ...c, contactGroup: null } : c));
    setGroups(prev => prev.filter(x => x.id !== g.id));

    try {
      const r = await authFetch(`${API_BASE}/contact-groups/${g.id}`, { method: 'DELETE' });
      if (!r.ok) {
        toast.error('Delete failed');
        loadGroups(); loadContacts();
      } else {
        toast.success(`"${g.name}" deleted`);
      }
    } catch { toast.error('Network error'); loadGroups(); loadContacts(); }
  };

  // ── Add contact ──────────────────────────────────────────────────────────
  const saveContact = async () => {
    if (!newContact.firstName || !newContact.phone) {
      toast.error('Name and phone required');
      return;
    }
    setAddSaving(true);
    try {
      const res = await authFetch(`${API_BASE}/contacts`, {
        method: 'POST',
        body: JSON.stringify({
          ...newContact,
          source: 'manual',
          contactGroup: showAdd === UNGROUPED ? null : showAdd,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Could not save contact');
      } else {
        toast.success('Contact added');
        setShowAdd(null);
        setNewContact({ firstName: '', lastName: '', phone: '', email: '', address: '' });
        loadContacts();
        loadGroups();
      }
    } catch { toast.error('Network error — could not save contact'); }
    setAddSaving(false);
  };

  // ── Notes ────────────────────────────────────────────────────────────────
  const saveNotes = async () => {
    if (!selected) return;
    setSaving(true);
    await authFetch(`${API_BASE}/contacts/${selected.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes: editNotes }),
    });
    setSaving(false);
    setContacts(prev => prev.map(c => c.id === selected.id ? { ...c, notes: editNotes } : c));
    setSelected(prev => prev ? { ...prev, notes: editNotes } : null);
    toast.success('Notes saved');
  };

  // ── Reassign group from detail panel ─────────────────────────────────────
  const reassignGroup = async (contactId: string, groupName: string | null) => {
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, contactGroup: groupName } : c));
    setSelected(prev => prev ? { ...prev, contactGroup: groupName } : null);
    await authFetch(`${API_BASE}/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({ contactGroup: groupName }),
    });
    loadGroups();
  };

  // ── Dial group ───────────────────────────────────────────────────────────
  const dialGroup = (groupName: string) => {
    const label = groupName === UNGROUPED ? 'Ungrouped' : groupName;
    localStorage.setItem('dialerGroupFilter', JSON.stringify({
      type: groupName === UNGROUPED ? 'all' : 'group',
      value: groupName === UNGROUPED ? undefined : groupName,
      label,
      count: contactsInGroup(groupName).length,
    }));
    onNavigate?.('dialer');
  };

  // ── Column ordering ──────────────────────────────────────────────────────
  const allColumns = [UNGROUPED, ...groups.map(g => g.name)];

  const isInitialising = grpLoading && loading;

  // ── Render ───────────────────────────────────────────────────────────────

  // Contacts visible in the current mobile group
  const mobileCards = contactsInGroup(mobileGroup).filter(c =>
    !search || `${c.firstName} ${c.lastName} ${c.phone || ''}`.toLowerCase().includes(search.toLowerCase())
  );
  const mobileGroupObj = groups.find(g => g.name === mobileGroup) ?? null;
  const mobileAccent = mobileGroupObj?.color || '#9ca3af';

  return (
    <div className="full-page-h" style={{ display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.07)',
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span className="hidden md:inline" style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 20, fontWeight: 300, letterSpacing: '0.12em', color: DARK }}>
          Contacts
        </span>
        <div className="hidden md:block" style={{ width: 1, height: 18, background: '#e5e7eb' }} />
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: 220, padding: '6px 12px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', background: '#fafafa' }}
        />
        <div className="hidden md:block" style={{ flex: 1 }} />

        {/* Live AI indicator — desktop only */}
        <div className="hidden md:flex" style={{ alignItems: 'center', gap: 5, opacity: 0.65 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
            boxShadow: '0 0 5px #22c55e', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b7280', fontWeight: 600 }}>
            AI Active
          </span>
        </div>

        {/* iCloud one-tap sync — desktop only (mobile has it in the action bar) */}
        {icloudConnected && (
          <button
            onClick={handleIcloudSync}
            disabled={icloudSyncing}
            className="hidden md:flex"
            style={{ padding: '6px 12px', borderRadius: 7, border: '1.5px solid #0071e3', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', background: icloudSyncing ? '#e8f2fd' : '#f0f7ff', color: '#0071e3', cursor: icloudSyncing ? 'default' : 'pointer', whiteSpace: 'nowrap', alignItems: 'center', gap: 5 }}
          >
            {icloudSyncing ? '⏳' : '☁️'} {icloudSyncing ? 'Syncing…' : 'Sync iCloud'}
          </button>
        )}
        <button
          onClick={openGmailImport}
          className="hidden md:flex"
          style={{ padding: '6px 12px', borderRadius: 7, border: '1.5px solid #ea4335', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', background: '#fff8f7', color: '#ea4335', cursor: 'pointer', whiteSpace: 'nowrap', alignItems: 'center', gap: 5 }}
        >
          <span>G</span> Gmail
        </button>
        <button
          onClick={() => setShowImport(true)}
          className="hidden md:block"
          style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', background: 'transparent', color: '#6b7280', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          Import
        </button>
        <button
          onClick={() => { setShowQuickAdd(true); setQuickName(''); setQuickPhone(''); setQuickEmail(''); setQuickAddress(''); }}
          className="hidden md:block"
          style={{ padding: '6px 14px', borderRadius: 7, border: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', background: GOLD, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          + Contact
        </button>
        <button
          onClick={() => { setCreatingGroup(true); setNewGroupName(''); setNewGroupColor(GROUP_COLORS[0]); }}
          className="hidden md:block"
          style={{ padding: '6px 12px', borderRadius: 7, border: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', background: DARK, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          + Group
        </button>
        <button
          onClick={() => { setSelectMode(s => !s); setSelectedIds(new Set()); }}
          className="hidden md:block"
          style={{ padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', border: `1.5px solid ${selectMode ? GOLD : '#e5e7eb'}`, background: selectMode ? `${GOLD}15` : 'transparent', color: selectMode ? GOLD : '#6b7280' }}
        >
          {selectMode ? '✓ Selecting' : 'Select'}
        </button>
        {selectMode && (
          <button
            onClick={() => {
              if (selectedIds.size === contacts.length) {
                setSelectedIds(new Set());
              } else {
                setSelectedIds(new Set(contacts.map(c => c.id)));
              }
            }}
            className="hidden md:block"
            style={{ padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', border: `1.5px solid ${GOLD}`, background: GOLD, color: '#fff' }}
          >
            {selectedIds.size === contacts.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          MOBILE VIEW — group tab bar + vertical contact list
          Only visible on small screens (hidden on md+)
      ══════════════════════════════════════════════════════════════════ */}
      <div className="flex md:hidden flex-col" style={{ flex: 1, overflow: 'hidden' }}>

        {/* Group tab strip */}
        <div style={{
          display: 'flex', overflowX: 'auto', background: '#fff',
          borderBottom: '1px solid rgba(0,0,0,0.07)', flexShrink: 0,
        }} className="hide-scrollbar">
          {allColumns.map(gName => {
            const gObj = gName === UNGROUPED ? null : groups.find(g => g.name === gName);
            const accent = gObj?.color || '#9ca3af';
            const label = gName === UNGROUPED ? 'All' : gName;
            const isActive = mobileGroup === gName;
            const count = contactsInGroup(gName).length;
            return (
              <button key={gName} onClick={() => setMobileGroup(gName)} style={{
                flexShrink: 0, padding: '10px 14px', background: 'none', border: 'none',
                borderBottom: `2px solid ${isActive ? accent : 'transparent'}`,
                cursor: 'pointer', textAlign: 'center', marginBottom: -1,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? DARK : '#9ca3af', whiteSpace: 'nowrap' }}>
                  {label}
                </div>
                <div style={{ fontSize: 10, color: isActive ? accent : '#d1d5db', marginTop: 1 }}>{count}</div>
              </button>
            );
          })}
          {/* Gmail tab */}
          {gmailContactsList.length > 0 && (
            <button onClick={() => setMobileGroup('__gmail__')} style={{
              flexShrink: 0, padding: '10px 14px', background: 'none', border: 'none',
              borderBottom: `2px solid ${mobileGroup === '__gmail__' ? '#ea4335' : 'transparent'}`,
              cursor: 'pointer', textAlign: 'center', marginBottom: -1,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: mobileGroup === '__gmail__' ? '#ea4335' : '#9ca3af', whiteSpace: 'nowrap' }}>
                Email
              </div>
              <div style={{ fontSize: 10, color: mobileGroup === '__gmail__' ? '#ea4335' : '#d1d5db', marginTop: 1 }}>
                {gmailContactsList.length}
              </div>
            </button>
          )}
        </div>

        {/* Dial group button */}
        {/* Action bar: Dial + Import */}
        <div style={{ padding: '8px 14px', background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.05)', flexShrink: 0, display: 'flex', gap: 8 }}>
          {mobileCards.length > 0 ? (
            <button
              onClick={() => dialGroup(mobileGroup)}
              style={{
                flex: 1, padding: '10px', borderRadius: 8, border: 'none',
                fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: '#fff', cursor: 'pointer',
                background: mobileGroup === UNGROUPED ? DARK : mobileAccent,
              }}
            >
              ▶ Dial {mobileCards.length}
            </button>
          ) : (
            <div style={{ flex: 1 }} />
          )}
          {icloudConnected && (
            <button
              onClick={handleIcloudSync}
              disabled={icloudSyncing}
              style={{
                padding: '10px 14px', borderRadius: 8, border: '1.5px solid #0071e3',
                fontSize: 12, fontWeight: 700, color: '#0071e3',
                background: '#f0f7ff', cursor: icloudSyncing ? 'default' : 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {icloudSyncing ? '⏳' : '☁️'}
            </button>
          )}
          <button
            onClick={() => { setShowQuickAdd(true); setQuickName(''); setQuickPhone(''); setQuickEmail(''); setQuickAddress(''); }}
            style={{
              padding: '10px 14px', borderRadius: 8, border: 'none',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
              color: '#fff', background: GOLD, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            + Add
          </button>
          <button
            onClick={openGmailImport}
            style={{
              padding: '10px 14px', borderRadius: 8, border: '1.5px solid #ea4335',
              fontSize: 12, fontWeight: 700,
              color: '#ea4335', background: '#fff8f7', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            G
          </button>
          <button
            onClick={() => setShowImport(true)}
            style={{
              padding: '10px 14px', borderRadius: 8, border: '1.5px solid rgba(0,0,0,0.1)',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
              color: DARK, background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            ⬆
          </button>
          <button
            onClick={() => { setSelectMode(s => !s); setSelectedIds(new Set()); }}
            style={{
              padding: '10px 14px', borderRadius: 8,
              border: `1.5px solid ${selectMode ? GOLD : 'rgba(0,0,0,0.1)'}`,
              fontSize: 12, fontWeight: 700, letterSpacing: '0.04em',
              color: selectMode ? GOLD : DARK, background: selectMode ? `${GOLD}15` : '#fff',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            ✓
          </button>
        </div>

        {/* Contact list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {isInitialising ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>Loading…</div>

          ) : mobileGroup === '__gmail__' ? (
            /* ── Gmail tab ── */
            gmailContactsList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 32, opacity: 0.25 }}>✉️</div>
                <div style={{ fontSize: 13, color: '#9ca3af' }}>No Gmail contacts yet</div>
                <button onClick={openGmailImport} style={{ padding: '12px 24px', borderRadius: 10, border: 'none', background: '#ea4335', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  Import Gmail Contacts
                </button>
              </div>
            ) : (
              <>
                <button onClick={openGmailImport} style={{ width: '100%', marginBottom: 10, padding: '10px', borderRadius: 8, border: '1.5px dashed rgba(234,67,53,0.4)', fontSize: 12, fontWeight: 600, color: '#ea4335', background: 'transparent', cursor: 'pointer' }}>
                  + Import More Gmail Contacts
                </button>
                {gmailContactsList.map(c => (
                  <div
                    key={c.id}
                    onClick={() => { setSelected(c); setEditNotes(c.notes || ''); setEditEmail(c.email || ''); }}
                    style={{
                      background: selected?.id === c.id ? 'rgba(234,67,53,0.04)' : '#fff',
                      borderRadius: 10,
                      border: `1px solid ${selected?.id === c.id ? 'rgba(234,67,53,0.3)' : 'rgba(0,0,0,0.07)'}`,
                      padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 12,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}
                  >
                    <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#ea4335' }}>
                      {(c.firstName?.[0] || '?').toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: DARK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.firstName} {c.lastName}
                      </div>
                      {c.email && (
                        <div style={{ fontSize: 12, color: '#ea4335', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ✉ {c.email}
                        </div>
                      )}
                      {c.phone && (
                        <div style={{ fontSize: 11, color: GOLD, fontFamily: 'monospace', marginTop: 1 }}>{fmtPhone(c.phone)}</div>
                      )}
                    </div>
                    <span style={{ color: '#d1d5db', fontSize: 14 }}>›</span>
                  </div>
                ))}
              </>
            )

          ) : mobileCards.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div style={{ fontSize: 32, opacity: 0.25 }}>📋</div>
              <div style={{ fontSize: 13, color: '#9ca3af' }}>
                {search ? 'No contacts match your search' : 'No contacts in this group yet'}
              </div>
              {!search && (
                <button
                  onClick={() => setShowImport(true)}
                  style={{
                    padding: '12px 24px', borderRadius: 10, border: 'none',
                    background: DARK, color: '#fff', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', letterSpacing: '0.04em',
                  }}
                >
                  Import Contacts
                </button>
              )}
            </div>
          ) : (
            mobileCards.map(c => (
              <div
                key={c.id}
                onClick={() => {
                  if (selectMode) { toggleSelect(c.id); }
                  else { setSelected(c); setEditNotes(c.notes || ''); setEditEmail(c.email || ''); }
                }}
                style={{
                  background: selectedIds.has(c.id) ? 'rgba(201,168,76,0.08)' : selected?.id === c.id ? 'rgba(201,168,76,0.06)' : '#fff',
                  borderRadius: 10,
                  border: `1px solid ${selectedIds.has(c.id) ? 'rgba(201,168,76,0.45)' : selected?.id === c.id ? 'rgba(201,168,76,0.3)' : 'rgba(0,0,0,0.07)'}`,
                  padding: '12px 14px',
                  marginBottom: 8,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                {selectMode ? (
                  <div style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    border: `2px solid ${selectedIds.has(c.id) ? GOLD : '#d1d5db'}`,
                    background: selectedIds.has(c.id) ? GOLD : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {selectedIds.has(c.id) && <span style={{ color: '#fff', fontSize: 13, lineHeight: 1 }}>✓</span>}
                  </div>
                ) : (
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                    background: mobileGroup === UNGROUPED ? '#f3f4f6' : `${mobileAccent}22`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: mobileGroup === UNGROUPED ? '#9ca3af' : mobileAccent,
                  }}>
                    {(c.firstName?.[0] || '?').toUpperCase()}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: DARK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.firstName} {c.lastName}
                  </div>
                  <div style={{ fontSize: 12, color: GOLD, fontFamily: 'monospace', marginTop: 1 }}>
                    {fmtPhone(c.phone)}
                  </div>
                  {c.status && c.status !== 'new' && (
                    <div style={{ fontSize: 10, color: STATUS_COLORS[c.status] || '#9ca3af', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                      {c.status}
                    </div>
                  )}
                </div>
                {!selectMode && <span style={{ color: '#d1d5db', fontSize: 14 }}>›</span>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          DESKTOP KANBAN — hidden on mobile, shown on md+
      ══════════════════════════════════════════════════════════════════ */}
      {/* ── Kanban board ─────────────────────────────────────────────── */}
      <div className="hidden md:flex" style={{
        flex: 1, overflowX: 'auto', overflowY: 'hidden',
        gap: 14, padding: '18px 20px',
        alignItems: 'flex-start',
      }}>
        {isInitialising ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#9ca3af', fontSize: 13 }}>
            Loading…
          </div>
        ) : (
          <>
            {allColumns.map(groupName => {
              const cards      = contactsInGroup(groupName);
              const isOver     = dragOverGroup === groupName;
              const isUngroup  = groupName === UNGROUPED;
              const label      = isUngroup ? 'Ungrouped' : groupName;
              const groupObj   = isUngroup ? null : groupByName(groupName);
              const accentColor = groupObj?.color || '#9ca3af';
              const isRenaming = !isUngroup && renamingGroup === groupObj?.id;

              return (
                <div
                  key={groupName}
                  onDragOver={e => onDragOver(e, groupName)}
                  onDrop={e => onDrop(e, groupName)}
                  onDragLeave={() => dragOverGroup === groupName && setDragOverGroup(null)}
                  style={{
                    width: 256,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    background: isOver ? 'rgba(201,168,76,0.03)' : '#fff',
                    borderRadius: 14,
                    border: `1.5px solid ${isOver ? 'rgba(201,168,76,0.45)' : 'rgba(0,0,0,0.07)'}`,
                    transition: 'border-color 0.15s, background 0.15s',
                    maxHeight: 'calc(100vh - 130px)',
                    overflow: 'hidden',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                  }}
                >
                  {/* Column top accent bar */}
                  <div style={{ height: 3, background: accentColor, borderRadius: '14px 14px 0 0', flexShrink: 0, opacity: isUngroup ? 0.25 : 0.85 }} />

                  {/* Column header */}
                  <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgba(0,0,0,0.05)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      {isRenaming && groupObj ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => commitRename(groupObj.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitRename(groupObj.id);
                              if (e.key === 'Escape') setRenamingGroup(null);
                            }}
                            style={{
                              width: '100%', fontSize: 13, fontWeight: 700,
                              border: 'none', borderBottom: `2px solid ${GOLD}`,
                              outline: 'none', background: 'transparent',
                              padding: '2px 0', color: DARK, boxSizing: 'border-box',
                            }}
                          />
                          {/* Color picker in rename mode */}
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {GROUP_COLORS.map(c => (
                              <div
                                key={c}
                                onClick={() => setRenameColor(c)}
                                style={{
                                  width: 16, height: 16, borderRadius: '50%', background: c,
                                  cursor: 'pointer', border: renameColor === c ? '2px solid #fff' : '2px solid transparent',
                                  boxShadow: renameColor === c ? `0 0 0 2px ${c}` : 'none',
                                  flexShrink: 0,
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: DARK, letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {label}
                        </span>
                      )}

                      <span style={{
                        fontSize: 10, color: '#9ca3af', background: '#f3f4f6',
                        borderRadius: 10, padding: '1px 7px', fontWeight: 600, flexShrink: 0,
                      }}>
                        {cards.length}
                      </span>

                      {!isUngroup && !isRenaming && groupObj && (
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button
                            onClick={() => startRename(groupObj)}
                            title="Rename / recolor"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px 5px', borderRadius: 4, fontSize: 12, lineHeight: 1 }}
                          >✏️</button>
                          <button
                            onClick={() => deleteGroup(groupObj)}
                            title="Delete group"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', padding: '2px 5px', borderRadius: 4, fontSize: 12, lineHeight: 1 }}
                          >✕</button>
                        </div>
                      )}
                    </div>

                    {/* Add + Dial buttons */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setShowAdd(groupName)}
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
                          onClick={() => dialGroup(groupName)}
                          title={`Dial all ${cards.length} contacts in this group`}
                          style={{
                            padding: '5px 12px', borderRadius: 6, border: 'none',
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                            textTransform: 'uppercase', color: '#fff',
                            background: DARK,
                            cursor: 'pointer', whiteSpace: 'nowrap',
                            boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
                          }}
                        >
                          ▶ Dial
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Cards list */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                    {cards.length === 0 ? (
                      <div style={{
                        textAlign: 'center', padding: '32px 0',
                        color: isOver ? GOLD : '#d1d5db', fontSize: 12,
                        transition: 'color 0.15s',
                      }}>
                        {isOver ? '⬇ Drop here' : 'No contacts'}
                      </div>
                    ) : (
                      cards.map(c => {
                        const scoreColor = c.leadScore != null
                          ? c.leadScore >= 70 ? '#22c55e' : c.leadScore >= 40 ? GOLD : '#9ca3af'
                          : null;
                        return (
                          <div
                            key={c.id}
                            draggable={!selectMode}
                            onDragStart={e => !selectMode && onDragStart(e, c.id)}
                            onDragEnd={onDragEnd}
                            onClick={() => {
                              if (selectMode) { toggleSelect(c.id); }
                              else { setSelected(c); setEditNotes(c.notes || ''); setEditEmail(c.email || ''); }
                            }}
                            style={{
                              background: selectedIds.has(c.id) ? 'rgba(201,168,76,0.08)' : selected?.id === c.id ? 'rgba(201,168,76,0.06)' : '#fafafa',
                              borderRadius: 9,
                              border: `1px solid ${selectedIds.has(c.id) ? 'rgba(201,168,76,0.45)' : selected?.id === c.id ? 'rgba(201,168,76,0.3)' : 'rgba(0,0,0,0.06)'}`,
                              padding: '10px 12px',
                              marginBottom: 6,
                              cursor: selectMode ? 'pointer' : 'grab',
                              opacity: draggingId === c.id ? 0.35 : 1,
                              transition: 'opacity 0.1s, border-color 0.1s, background 0.1s',
                              userSelect: 'none',
                              position: 'relative',
                            }}
                          >
                            {/* Lead score bar */}
                            {c.leadScore != null && (
                              <div style={{
                                position: 'absolute', top: 0, left: 0, bottom: 0,
                                width: 3, borderRadius: '9px 0 0 9px',
                                background: scoreColor || 'transparent',
                              }} />
                            )}

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
                              {/* Checkbox (select mode) or status dot */}
                              {selectMode ? (
                                <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: `2px solid ${selectedIds.has(c.id) ? GOLD : '#d1d5db'}`, background: selectedIds.has(c.id) ? GOLD : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {selectedIds.has(c.id) && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                                </div>
                              ) : (
                                <div title={c.status} style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[c.status] || '#9ca3af', flexShrink: 0, marginTop: 4 }} />
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                              {c.calls && c.calls.length > 0 && (
                                <span style={{ fontSize: 10, color: '#9ca3af' }}>
                                  📞 {c.calls.length}
                                </span>
                              )}
                              {c.leadScore != null && (
                                <span style={{ fontSize: 10, color: scoreColor || '#9ca3af', fontWeight: 600 }}>
                                  {c.leadScore}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}

            {/* ── Email Contacts section — all contacts with email, separate from phone kanban ── */}
            {gmailContactsList.length > 0 && (
              <div style={{
                width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column',
                background: '#fff', borderRadius: 14,
                border: '1.5px solid rgba(234,67,53,0.25)',
                maxHeight: 'calc(100vh - 130px)', overflow: 'hidden',
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}>
                <div style={{ height: 3, background: '#ea4335', borderRadius: '14px 14px 0 0', flexShrink: 0 }} />
                <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid rgba(0,0,0,0.05)', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: DARK }}>Email Contacts</span>
                    <span style={{ fontSize: 10, color: '#ea4335', background: '#fef2f2', borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>
                      {gmailContactsList.length}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>Email contacts · not mixed with phone list</div>
                  <button
                    onClick={openGmailImport}
                    style={{
                      marginTop: 8, width: '100%', padding: '5px 0', borderRadius: 6,
                      border: '1.5px dashed rgba(234,67,53,0.4)', fontSize: 10, fontWeight: 600,
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                      color: '#ea4335', background: 'transparent', cursor: 'pointer',
                    }}
                  >
                    + Import More
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                  {gmailContactsList.map(c => (
                    <div
                      key={c.id}
                      onClick={() => { setSelected(c); setEditNotes(c.notes || ''); setEditEmail(c.email || ''); }}
                      style={{
                        background: selected?.id === c.id ? 'rgba(234,67,53,0.04)' : '#fafafa',
                        borderRadius: 9,
                        border: `1px solid ${selected?.id === c.id ? 'rgba(234,67,53,0.3)' : 'rgba(0,0,0,0.06)'}`,
                        padding: '10px 12px', marginBottom: 6, cursor: 'pointer',
                        transition: 'border-color 0.1s, background 0.1s',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: 12, color: DARK, marginBottom: 3 }}>
                        {c.firstName} {c.lastName}
                      </div>
                      {c.email && (
                        <div style={{ fontSize: 11, color: '#ea4335', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ✉ {c.email}
                        </div>
                      )}
                      {c.phone && (
                        <div style={{ fontSize: 11, color: GOLD, fontFamily: 'monospace', marginTop: 2 }}>
                          {fmtPhone(c.phone)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── New group creation column ──── */}
            {creatingGroup && (
              <div style={{
                width: 256, flexShrink: 0, background: '#fff', borderRadius: 14,
                border: '1.5px dashed rgba(201,168,76,0.5)', padding: '16px 14px',
                display: 'flex', flexDirection: 'column', gap: 12,
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
                {/* Color picker */}
                <div>
                  <div style={{ fontSize: 9, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>Color</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {GROUP_COLORS.map(c => (
                      <div
                        key={c}
                        onClick={() => setNewGroupColor(c)}
                        style={{
                          width: 20, height: 20, borderRadius: '50%', background: c,
                          cursor: 'pointer',
                          border: newGroupColor === c ? '2px solid #fff' : '2px solid transparent',
                          boxShadow: newGroupColor === c ? `0 0 0 2px ${c}` : 'none',
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={createGroup}
                    disabled={createSaving}
                    style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: DARK, color: '#fff', fontSize: 12, fontWeight: 600, cursor: createSaving ? 'not-allowed' : 'pointer' }}
                  >
                    {createSaving ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    onClick={() => { setCreatingGroup(false); setNewGroupName(''); }}
                    style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'transparent', color: '#9ca3af', fontSize: 12, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Empty state ─── */}
            {groups.length === 0 && !creatingGroup && contacts.length === 0 && !grpLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16, paddingBottom: 40 }}>
                <div style={{ fontSize: 52, opacity: 0.3 }}>👥</div>
                <div style={{ fontSize: 17, fontWeight: 300, letterSpacing: '0.08em', color: '#9ca3af' }}>No contacts yet</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button onClick={() => setCreatingGroup(true)} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: DARK, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    Create a Group
                  </button>
                  <button onClick={() => setShowImport(true)} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer' }}>
                    Import Contacts
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bulk action bar — floats above bottom tab bar when contacts selected ── */}
      {selectMode && (
        <div style={{
          position: 'fixed', left: 0, right: 0,
          bottom: 'calc(56px + env(safe-area-inset-bottom))',
          zIndex: 150,
          background: DARK,
          boxShadow: '0 -4px 24px rgba(0,0,0,0.25)',
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }} className="md:bottom-0">
          {/* Count + select-all */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>
              {selectedIds.size} selected
            </span>
            <button
              onClick={() => {
                if (selectedIds.size === contacts.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(contacts.map(c => c.id)));
                }
              }}
              style={{ fontSize: 11, color: '#e5e7eb', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap', padding: '4px 10px', fontWeight: 600 }}
            >
              {selectedIds.size === contacts.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          {/* Move to group */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setBulkGroupOpen(o => !o)}
              disabled={selectedIds.size === 0}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: selectedIds.size === 0 ? 0.4 : 1 }}
            >
              Move to Group ▾
            </button>
            {bulkGroupOpen && (
              <div style={{ position: 'absolute', bottom: '110%', left: 0, background: '#fff', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.2)', overflow: 'hidden', minWidth: 180, zIndex: 200 }}>
                <button
                  onClick={() => bulkMoveToGroup('')}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 12, color: '#6b7280', background: 'none', border: 'none', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                >
                  Ungrouped
                </button>
                {groups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => bulkMoveToGroup(g.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 12, color: DARK, background: 'none', border: 'none', borderBottom: '1px solid #f9f9f9', cursor: 'pointer' }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                    {g.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Delete */}
          <button
            onClick={bulkDelete}
            disabled={selectedIds.size === 0}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 700, cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: selectedIds.size === 0 ? 0.4 : 1 }}
          >
            Delete
          </button>

          {/* Cancel */}
          <button
            onClick={exitSelectMode}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'none', color: '#9ca3af', fontSize: 12, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Contact detail side panel ──────────────────────────────── */}
      {selected && (
        <>
          <div
            onClick={() => setSelected(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 99 }}
            className="md:hidden"
          />
          <div className="bottom-[60px] md:bottom-0 w-full md:w-[320px]" style={{
            position: 'fixed', top: 49, right: 0,
            background: '#fff', borderLeft: '1px solid rgba(0,0,0,0.07)',
            boxShadow: '-6px 0 30px rgba(0,0,0,0.07)',
            display: 'flex', flexDirection: 'column', zIndex: 100,
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 18px',
              borderBottom: '1px solid rgba(0,0,0,0.06)',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0,
              borderTop: `3px solid ${selected.contactGroup ? (groupByName(selected.contactGroup)?.color || GOLD) : '#e5e7eb'}`,
            }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD, fontWeight: 700, marginBottom: 4 }}>
                  {selected.contactGroup || 'Ungrouped'}
                </div>
                <div style={{ fontSize: 19, fontWeight: 300, color: DARK, letterSpacing: '0.02em' }}>
                  {selected.firstName} {selected.lastName}
                </div>
                {selected.leadScore != null && (
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>
                    Lead score: <span style={{
                      fontWeight: 700,
                      color: selected.leadScore >= 70 ? '#22c55e' : selected.leadScore >= 40 ? GOLD : '#9ca3af',
                    }}>{selected.leadScore}</span>
                  </div>
                )}
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9ca3af', padding: '2px 4px', marginTop: -2 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: 22 }}>

              {/* Info rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Phone',   value: selected.phone,   mono: true },
                  selected.address ? { label: 'Address', value: [selected.address, selected.city, selected.state].filter(Boolean).join(', '), mono: false } : null,
                  selected.source  ? { label: 'Source',  value: selected.source,  mono: false } : null,
                ].filter(Boolean).map((row: any) => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', flexShrink: 0, marginTop: 2 }}>{row.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right', color: row.mono ? GOLD : DARK, fontFamily: row.mono ? 'monospace' : undefined }}>
                      {row.value}
                    </span>
                  </div>
                ))}
                {/* Editable email */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', flexShrink: 0 }}>Email</span>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    onBlur={async () => {
                      if (editEmail === (selected.email || '')) return;
                      await authFetch(`${API_BASE}/contacts/${selected.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ email: editEmail }),
                      });
                      setContacts(prev => prev.map(c => c.id === selected.id ? { ...c, email: editEmail } : c));
                      setSelected(prev => prev ? { ...prev, email: editEmail } : null);
                    }}
                    placeholder="Add email…"
                    style={{ flex: 1, textAlign: 'right', border: 'none', borderBottom: '1px dashed #e5e7eb', background: 'transparent', fontSize: 12, color: DARK, outline: 'none', padding: '2px 0', minWidth: 0 }}
                  />
                </div>
              </div>

              {/* Status pills */}
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Status</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(['new', 'contacted', 'callback', 'hot', 'appointment', 'dnc'] as const).map(s => (
                    <button
                      key={s}
                      onClick={async () => {
                        await authFetch(`${API_BASE}/contacts/${selected.id}`, {
                          method: 'PATCH',
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

              {/* Group selector */}
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 8 }}>Group</div>
                <select
                  value={selected.contactGroup || ''}
                  onChange={e => reassignGroup(selected.id, e.target.value || null)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, background: '#fafafa', outline: 'none' }}
                >
                  <option value="">Ungrouped</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.name}>{g.name}</option>
                  ))}
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

              {/* Danger zone */}
              <div style={{ paddingTop: 8, borderTop: '1px solid #f5f5f5', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={async () => {
                    if (!window.confirm('Mark this contact DNC? They will not be dialed.')) return;
                    await authFetch(`${API_BASE}/contacts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'dnc' }) });
                    setContacts(prev => prev.map(c => c.id === selected.id ? { ...c, status: 'dnc' } : c));
                    setSelected(null);
                    toast.success('Contact marked DNC');
                  }}
                  style={{ fontSize: 10, color: '#ef4444', background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', letterSpacing: '0.05em' }}
                >
                  Mark DNC
                </button>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete ${selected.firstName} ${selected.lastName}? This cannot be undone.`)) return;
                    await authFetch(`${API_BASE}/contacts/${selected.id}`, { method: 'DELETE' });
                    setContacts(prev => prev.filter(c => c.id !== selected.id));
                    setSelected(null);
                    loadGroups();
                    toast.success('Contact deleted');
                  }}
                  style={{ fontSize: 10, color: '#ef4444', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', letterSpacing: '0.05em' }}
                >
                  Delete Contact
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Add Contact modal ────────────────────────────────────────── */}
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
                  <input value={newContact.firstName} onChange={e => setNewContact(p => ({ ...p, firstName: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Last Name</label>
                  <input value={newContact.lastName} onChange={e => setNewContact(p => ({ ...p, lastName: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Phone *</label>
                <input value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+14155551234"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Email</label>
                <input value={newContact.email} onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 4 }}>Address</label>
                <input value={newContact.address} onChange={e => setNewContact(p => ({ ...p, address: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
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

      {/* ── Quick Add Modal ──────────────────────────────────────────────── */}
      {showQuickAdd && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
             onClick={e => { if (e.target === e.currentTarget) setShowQuickAdd(false); }}>
          <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, padding: '20px 24px calc(env(safe-area-inset-bottom) + 24px)', boxShadow: '0 -8px 40px rgba(0,0,0,0.15)', maxHeight: '90dvh', overflowY: 'auto' }}>
            {/* Handle */}
            <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e5e7eb', margin: '0 auto 20px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0a0a0a' }}>Add New Contact</div>
              <button onClick={() => setShowQuickAdd(false)} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid #e5e7eb', background: 'transparent', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>✕</button>
            </div>

            {/* Name */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9ca3af', marginBottom: 5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Name</label>
              <input type="text" value={quickName} onChange={e => setQuickName(e.target.value)} placeholder="First Last" autoFocus
                style={{ width: '100%', padding: '13px 15px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 16, color: '#111', outline: 'none', boxSizing: 'border-box', background: '#fafafa' }} />
            </div>

            {/* Phone */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9ca3af', marginBottom: 5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Phone <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input type="tel" value={quickPhone} onChange={e => setQuickPhone(e.target.value)} placeholder="(555) 000-0000"
                onKeyDown={e => { if (e.key === 'Enter' && quickPhone.trim()) handleQuickAdd(); }}
                style={{ width: '100%', padding: '13px 15px', borderRadius: 10, border: `1.5px solid ${quickPhone.trim() ? GOLD : '#e5e7eb'}`, fontSize: 16, color: '#111', outline: 'none', boxSizing: 'border-box', background: '#fafafa' }} />
            </div>

            {/* Email */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9ca3af', marginBottom: 5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Email</label>
              <input type="email" value={quickEmail} onChange={e => setQuickEmail(e.target.value)} placeholder="name@example.com"
                style={{ width: '100%', padding: '13px 15px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 16, color: '#111', outline: 'none', boxSizing: 'border-box', background: '#fafafa' }} />
            </div>

            {/* Address */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9ca3af', marginBottom: 5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Address</label>
              <input type="text" value={quickAddress} onChange={e => setQuickAddress(e.target.value)} placeholder="123 Main St, City, State"
                style={{ width: '100%', padding: '13px 15px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 16, color: '#111', outline: 'none', boxSizing: 'border-box', background: '#fafafa' }} />
            </div>

            <button onClick={handleQuickAdd} disabled={quickSaving || !quickPhone.trim()}
              style={{
                width: '100%', padding: '16px', borderRadius: 14, border: 'none',
                background: quickPhone.trim() ? DARK : '#e5e7eb',
                color: quickPhone.trim() ? '#fff' : '#9ca3af',
                fontSize: 16, fontWeight: 700, cursor: quickPhone.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              {quickSaving ? 'Saving…' : 'Add Contact'}
            </button>
          </div>
        </div>
      )}

      {showImport && (
        <CsvImportModal onClose={() => setShowImport(false)} onImported={() => { loadContacts(); loadGroups(); setIcloudConnected(true); }} preloadedVcfText={sharedVcfText} />
      )}

      {/* ── Gmail Import Modal ─────────────────────────────────────────────── */}
      {showGmailImport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowGmailImport(false); }}>
          <div style={{ background: '#fff', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: 560, maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: '20px 20px 32px', overflow: 'hidden' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: DARK }}>Import Gmail Contacts</div>
                {!gmailLoading && !gmailError && !gmailNeedsReauth && gmailContacts.length > 0 && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{gmailContacts.length} contacts found · {gmailSelectedIds.size} selected</div>
                )}
              </div>
              <button onClick={() => setShowGmailImport(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af', padding: '4px 8px' }}>✕</button>
            </div>

            {/* Loading */}
            {gmailLoading && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 0' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', border: `3px solid #ea4335`, borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                <div style={{ fontSize: 13, color: '#6b7280' }}>Fetching your Google contacts…</div>
              </div>
            )}

            {/* People API not enabled */}
            {!gmailLoading && gmailNeedsPeopleApi && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '32px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 32 }}>⚙️</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: DARK }}>Enable the Google People API</div>
                <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6 }}>
                  Your Google Cloud project needs the People API enabled to read contacts. It takes 30 seconds:
                </div>
                <div style={{ textAlign: 'left', background: '#f9fafb', borderRadius: 10, padding: '14px 18px', fontSize: 13, color: '#374151', lineHeight: 1.8, width: '100%' }}>
                  1. Go to <a href="https://console.cloud.google.com/apis/library/people.googleapis.com" target="_blank" rel="noreferrer" style={{ color: '#ea4335' }}>console.cloud.google.com → People API</a><br />
                  2. Click <strong>Enable</strong><br />
                  3. Come back and tap "Try Again" below
                </div>
                <button onClick={openGmailImport} style={{ padding: '12px 28px', borderRadius: 10, border: 'none', background: DARK, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  Try Again
                </button>
              </div>
            )}

            {/* Needs reauth */}
            {!gmailLoading && gmailNeedsReauth && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '32px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 32 }}>🔐</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: DARK }}>Contacts permission needed</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>Your Gmail is connected for sending, but we need one more permission to read your contacts. Click below to re-authorize.</div>
                <button
                  onClick={() => { window.location.href = `${API_BASE}/gmail/auth?token=${localStorage.getItem('propel_token') || ''}`; }}
                  style={{ padding: '12px 28px', borderRadius: 10, border: 'none', background: '#ea4335', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  Re-authorize Gmail
                </button>
              </div>
            )}

            {/* Error */}
            {!gmailLoading && gmailError && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '32px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 32 }}>⚠️</div>
                <div style={{ fontSize: 14, color: '#dc2626' }}>{gmailError}</div>
                <button onClick={openGmailImport} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: DARK, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Try again</button>
              </div>
            )}

            {/* Contacts list */}
            {!gmailLoading && !gmailError && !gmailNeedsReauth && !gmailNeedsPeopleApi && gmailContacts.length > 0 && (
              <>
                {/* Group name + select all */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
                  <input
                    value={gmailGroupName}
                    onChange={e => setGmailGroupName(e.target.value)}
                    placeholder="Group name"
                    style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none' }}
                  />
                  <button
                    onClick={() => {
                      if (gmailSelectedIds.size === gmailContacts.length) setGmailSelectedIds(new Set());
                      else setGmailSelectedIds(new Set(gmailContacts.map((_, i) => i)));
                    }}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, fontWeight: 600, background: '#f9fafb', color: DARK, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {gmailSelectedIds.size === gmailContacts.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                {/* Scrollable list */}
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #f3f4f6', borderRadius: 10 }}>
                  {gmailContacts.map((c, i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid #f9fafb', cursor: 'pointer', background: gmailSelectedIds.has(i) ? '#fef8f0' : '#fff' }}>
                      <input
                        type="checkbox"
                        checked={gmailSelectedIds.has(i)}
                        onChange={() => {
                          setGmailSelectedIds(prev => {
                            const next = new Set(prev);
                            next.has(i) ? next.delete(i) : next.add(i);
                            return next;
                          });
                        }}
                        style={{ accentColor: GOLD, width: 15, height: 15, flexShrink: 0 }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: DARK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[c.firstName, c.lastName].filter(Boolean).join(' ') || '(No name)'}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact info'}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                {/* Import button */}
                <button
                  onClick={handleGmailImport}
                  disabled={gmailImporting || gmailSelectedIds.size === 0}
                  style={{
                    marginTop: 14, width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                    background: gmailSelectedIds.size === 0 ? '#f3f4f6' : '#ea4335',
                    color: gmailSelectedIds.size === 0 ? '#9ca3af' : '#fff',
                    fontSize: 15, fontWeight: 700, cursor: gmailSelectedIds.size === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {gmailImporting ? 'Importing…' : `Import ${gmailSelectedIds.size} Contact${gmailSelectedIds.size !== 1 ? 's' : ''} → "${gmailGroupName || 'Gmail Contacts'}"`}
                </button>
              </>
            )}

            {/* Empty state */}
            {!gmailLoading && !gmailError && !gmailNeedsReauth && !gmailNeedsPeopleApi && gmailContacts.length === 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '40px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 32 }}>📭</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: DARK }}>No contacts found in this Google account</div>
                <div style={{ fontSize: 13, color: '#6b7280', maxWidth: 300, lineHeight: 1.5 }}>
                  Your Google account doesn't have any saved contacts with an email or phone number.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, width: '100%', maxWidth: 260 }}>
                  <a
                    href="https://contacts.google.com"
                    target="_blank"
                    rel="noreferrer"
                    style={{ padding: '10px 0', borderRadius: 8, border: '1.5px solid #3b82f6', background: '#eff6ff', color: '#1d4ed8', fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'block', textAlign: 'center' }}
                  >
                    Open Google Contacts →
                  </a>
                  <button
                    onClick={openGmailImport}
                    style={{ padding: '10px 0', borderRadius: 8, border: '1.5px solid #d1d5db', background: '#f9fafb', color: '#374151', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
