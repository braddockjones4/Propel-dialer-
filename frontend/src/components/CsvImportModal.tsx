// ── Import Contacts Modal ─────────────────────────────────────────────────────
// Supports two import paths:
//   1. CSV (BatchLeads, PropStream, Google Contacts, any spreadsheet export)
//   2. vCard / .vcf (iPhone: Contacts → Share Contact → Save to Files)
//
// vCard parsing is done entirely client-side — no new backend needed.
// Uses the existing POST /api/contacts/import endpoint.
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { API_BASE, authFetch } from '../config';

const GOLD = '#C9A84C';

interface ParsedRow { [key: string]: string }
interface Props { onClose: () => void; onImported: (count: number) => void; }

// ── Field options for CSV column mapping ─────────────────────────────────────
const FIELD_OPTIONS = [
  { value: '',          label: '— skip —' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName',  label: 'Last Name' },
  { value: 'phone',     label: 'Phone *' },
  { value: 'address',   label: 'Address' },
  { value: 'city',      label: 'City' },
  { value: 'state',     label: 'State' },
  { value: 'zip',       label: 'Zip' },
  { value: 'email',     label: 'Email' },
  { value: 'source',    label: 'Source' },
  { value: 'status',    label: 'Status' },
];

const SOURCE_OPTIONS = ['manual', 'expired', 'fsbo', 'circle', 'past-client'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function guessMapping(header: string): string {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  if (h.includes('first'))   return 'firstName';
  if (h.includes('last'))    return 'lastName';
  if (h.includes('phone') || h.includes('mobile') || h.includes('cell')) return 'phone';
  if (h.includes('addr'))    return 'address';
  if (h.includes('city'))    return 'city';
  if (h.includes('state'))   return 'state';
  if (h.includes('zip') || h.includes('postal')) return 'zip';
  if (h.includes('email'))   return 'email';
  if (h.includes('source'))  return 'source';
  if (h.includes('status'))  return 'status';
  return '';
}

function parseCsv(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        fields.push(cur.trim()); cur = '';
      } else { cur += ch; }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = parseRow(l);
    const obj: ParsedRow = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
  return { headers, rows };
}

/** Parse a .vcf file string into contact objects. Handles vCard 2.1, 3.0, 4.0. */
function parseVCard(text: string): ParsedRow[] {
  const contacts: ParsedRow[] = [];
  const cards = text.split(/BEGIN:VCARD/i).slice(1);

  for (const card of cards) {
    const contact: ParsedRow = {};
    const lines = card.replace(/\r\n[ \t]/g, '').replace(/\r/g, '').split('\n');

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.toUpperCase().startsWith('END:VCARD')) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) continue;
      const prop = line.slice(0, colonIdx).toUpperCase();
      const value = line.slice(colonIdx + 1).trim();

      if (prop === 'FN' && value) {
        contact._fn = value;
      }

      if (prop === 'N' && value) {
        const parts = value.split(';');
        if (parts[0]) contact.lastName  = parts[0].trim();
        if (parts[1]) contact.firstName = parts[1].trim();
      }

      if ((prop.startsWith('TEL') || prop === 'PHONE') && value && !contact.phone) {
        let digits = value.replace(/[^\d+]/g, '');
        if (/^\d{10}$/.test(digits)) digits = `+1${digits}`;
        else if (/^\d{11}$/.test(digits) && digits[0] === '1') digits = `+${digits}`;
        if (digits.length >= 10) contact.phone = digits;
      }

      if ((prop.startsWith('EMAIL') || prop === 'EMAIL') && value && !contact.email) {
        contact.email = value;
      }

      if (prop.startsWith('ADR') && value && !contact.address) {
        const parts = value.split(';');
        if (parts[2]) contact.address = parts[2].trim();
        if (parts[3]) contact.city    = parts[3].trim();
        if (parts[4]) contact.state   = parts[4].trim();
        if (parts[5]) contact.zip     = parts[5].trim();
      }
    }

    if (!contact.firstName && !contact.lastName && contact._fn) {
      const parts = contact._fn.split(' ');
      contact.firstName = parts[0] || '';
      contact.lastName  = parts.slice(1).join(' ') || '';
    }
    delete contact._fn;

    if (contact.phone) contacts.push(contact);
  }

  return contacts;
}

// ── Shared import function ────────────────────────────────────────────────────
async function postImport(contacts: ParsedRow[], source: string): Promise<{ imported: number; skipped: number }> {
  const data = contacts.map(c => ({ ...c, source: c.source || source }));
  const res = await authFetch(`${API_BASE}/contacts/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contacts: data }),
  });
  const json = await res.json();
  return { imported: json.count ?? json.imported ?? data.length, skipped: json.skipped ?? 0 };
}

// ── Main component ─────────────────────────────────────────────────────────────
type Mode  = 'csv' | 'vcf';
type Stage = 'upload' | 'map' | 'preview' | 'done';

export default function CsvImportModal({ onClose, onImported }: Props) {
  const [mode, setMode]         = useState<Mode>('vcf');
  const [stage, setStage]       = useState<Stage>('upload');
  const [dragging, setDragging] = useState(false);

  // CSV state
  const [headers, setHeaders]           = useState<string[]>([]);
  const [rows, setRows]                 = useState<ParsedRow[]>([]);
  const [mapping, setMapping]           = useState<Record<string, string>>({});
  const [defaultSource, setDefaultSource] = useState('manual');

  // VCF state
  const [vcfContacts, setVcfContacts] = useState<ParsedRow[]>([]);

  // Shared
  const [importing, setImporting] = useState(false);
  const [result, setResult]       = useState<{ imported: number; skipped: number } | null>(null);

  const csvRef = useRef<HTMLInputElement>(null);
  const vcfRef = useRef<HTMLInputElement>(null);

  const switchMode = (m: Mode) => {
    setMode(m); setStage('upload'); setRows([]); setVcfContacts([]); setResult(null);
  };

  // ── CSV loading ───────────────────────────────────────────────────────────
  const loadCsvFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const { headers: h, rows: r } = parseCsv(text);
      setHeaders(h); setRows(r);
      const auto: Record<string, string> = {};
      h.forEach(hdr => { auto[hdr] = guessMapping(hdr); });
      setMapping(auto);
      setStage('map');
    };
    reader.readAsText(file);
  };

  const onCsvDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.csv')) loadCsvFile(file);
  }, []);

  // ── VCF loading ───────────────────────────────────────────────────────────
  const loadVcfFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const parsed = parseVCard(text);
      setVcfContacts(parsed);
      setStage('preview');
    };
    reader.readAsText(file);
  };

  const onVcfDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.vcf') || file?.name.endsWith('.vcard')) loadVcfFile(file);
  }, []);

  // ── Import ────────────────────────────────────────────────────────────────
  const handleCsvImport = async () => {
    setImporting(true);
    const contacts = rows.map(row => {
      const c: ParsedRow = { source: defaultSource };
      Object.entries(mapping).forEach(([col, field]) => { if (field) c[field] = row[col] || ''; });
      return c;
    }).filter(c => c.phone);

    if (!contacts.length) { setImporting(false); alert('No rows with a phone number found.'); return; }
    try {
      const r = await postImport(contacts, defaultSource);
      setResult(r); setStage('done');
    } catch { alert('Import failed. Please try again.'); }
    finally { setImporting(false); }
  };

  const handleVcfImport = async () => {
    setImporting(true);
    try {
      const r = await postImport(vcfContacts, 'manual');
      setResult(r); setStage('done');
    } catch { alert('Import failed. Please try again.'); }
    finally { setImporting(false); }
  };

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4"
         style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-2xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col"
           style={{ border: '1px solid rgba(201,168,76,0.2)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b"
             style={{ borderColor: 'rgba(201,168,76,0.15)' }}>
          <div>
            <h2 style={{ fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, fontSize: 22, margin: 0 }}>
              Import Contacts
            </h2>
            <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>iPhone, Android, or CSV spreadsheet</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#d1d5db' }}>✕</button>
        </div>

        {/* Mode tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', padding: '0 16px', overflowX: 'auto' }}
             className="hide-scrollbar">
          {([
            { id: 'vcf' as Mode, label: '📱 From Phone', sub: 'iPhone or Android contacts' },
            { id: 'csv' as Mode, label: '📄 From CSV',   sub: 'Spreadsheet or list export'  },
          ] as { id: Mode; label: string; sub: string }[]).map(tab => (
            <button key={tab.id} onClick={() => switchMode(tab.id)} style={{
              padding: '12px 16px 10px', flexShrink: 0,
              background: 'none', border: 'none',
              borderBottom: `2px solid ${mode === tab.id ? GOLD : 'transparent'}`,
              cursor: 'pointer', textAlign: 'left', marginBottom: -1,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: mode === tab.id ? '#111' : '#9ca3af' }}>{tab.label}</div>
              <div style={{ fontSize: 10, color: '#bbb', marginTop: 1 }}>{tab.sub}</div>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }} className="sm:px-6">

          {/* ═══ VCF MODE — UPLOAD ══════════════════════════════════════ */}
          {mode === 'vcf' && stage === 'upload' && (
            <div>

              {/* PRIMARY CTA: file picker */}
              <button
                onClick={() => vcfRef.current?.click()}
                style={{
                  width: '100%', padding: '20px 18px', borderRadius: 14,
                  background: 'linear-gradient(135deg, #0A0A0A 0%, #1a1a1a 100%)',
                  border: '1px solid rgba(201,168,76,0.35)',
                  color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 14,
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 30 }}>📂</span>
                <div style={{ textAlign: 'left', flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.02em' }}>
                    Select .vcf File
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(201,168,76,0.85)', marginTop: 3 }}>
                    Choose a contacts file from your iPhone
                  </div>
                </div>
                <span style={{ fontSize: 20, color: 'rgba(201,168,76,0.6)' }}>›</span>
              </button>
              <input
                ref={vcfRef}
                type="file"
                accept=".vcf,.vcard,text/vcard,text/x-vcard,text/directory"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) loadVcfFile(f); }}
              />

              {/* iCloud all-contacts export */}
              <a
                href="https://www.icloud.com/contacts"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '13px 14px', borderRadius: 12, marginBottom: 16,
                  background: '#f0f9ff', border: '1px solid #bae6fd',
                  textDecoration: 'none', color: '#0369a1', boxSizing: 'border-box',
                }}
              >
                <span style={{ fontSize: 20 }}>☁️</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Export ALL contacts at once — iCloud.com</div>
                  <div style={{ fontSize: 11, color: '#0ea5e9', marginTop: 2, lineHeight: 1.5 }}>
                    Contacts → ⚙️ → Select All → Export vCard → tap "Select .vcf File" above
                  </div>
                </div>
                <span style={{ fontSize: 16, color: '#7dd3fc', flexShrink: 0 }}>↗</span>
              </a>

              {/* How-to steps */}
              <div style={{ background: '#fafaf8', border: '1px solid #f0eeea', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD, marginBottom: 10 }}>
                  How to export a contact from iPhone
                </div>
                {[
                  { icon: '📲', text: 'Open the Contacts app' },
                  { icon: '👤', text: 'Tap a contact → scroll down → tap "Share Contact"' },
                  { icon: '🗂️', text: 'Tap "Save to Files" — this saves a .vcf file' },
                  { icon: '📂', text: 'Tap "Select .vcf File" above and choose it' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: i < 3 ? 10 : 0 }}>
                    <span style={{ fontSize: 16, minWidth: 24, textAlign: 'center', marginTop: 1 }}>{s.icon}</span>
                    <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{s.text}</span>
                  </div>
                ))}
              </div>

              {/* Desktop drag zone */}
              <div
                className="hidden sm:block"
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onVcfDrop}
                onClick={() => vcfRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? GOLD : '#e5e7eb'}`,
                  background: dragging ? 'rgba(201,168,76,0.04)' : 'transparent',
                  borderRadius: 10, padding: '16px', textAlign: 'center', cursor: 'pointer',
                  transition: 'all 0.2s', marginTop: 14,
                }}
              >
                <div style={{ fontSize: 12, color: '#9ca3af' }}>Or drag & drop a .vcf file here</div>
              </div>
            </div>
          )}

          {/* ═══ VCF MODE — PREVIEW ═════════════════════════════════════ */}
          {mode === 'vcf' && stage === 'preview' && (
            <div>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                  {vcfContacts.length} contacts with phone numbers found
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>Duplicates skipped automatically</div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                      {['Name', 'Phone', 'Email', 'City'].map(col => (
                        <th key={col} style={{ textAlign: 'left', padding: '8px 12px 8px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vcfContacts.slice(0, 8).map((c, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #fafafa' }}>
                        <td style={{ padding: '7px 12px 7px 0', color: '#111', fontWeight: 500 }}>{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td>
                        <td style={{ padding: '7px 12px 7px 0', color: '#374151', fontFamily: 'monospace', fontSize: 11 }}>{c.phone || '—'}</td>
                        <td style={{ padding: '7px 12px 7px 0', color: '#9ca3af' }}>{c.email || '—'}</td>
                        <td style={{ padding: '7px 0', color: '#9ca3af' }}>{c.city || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {vcfContacts.length > 8 && (
                  <div style={{ padding: '10px 0 0', fontSize: 11, color: '#bbb' }}>
                    + {vcfContacts.length - 8} more contacts…
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══ CSV MODE — UPLOAD ══════════════════════════════════════ */}
          {mode === 'csv' && stage === 'upload' && (
            <div>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onCsvDrop}
                onClick={() => csvRef.current?.click()}
                style={{
                  border: `2px dashed ${dragging ? GOLD : '#e0e0e0'}`,
                  background: dragging ? 'rgba(201,168,76,0.04)' : 'transparent',
                  borderRadius: 12, padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 10, color: 'rgba(201,168,76,0.4)' }}>⬆</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Drop your CSV here</div>
                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>or tap to browse</div>
                <div style={{ fontSize: 10.5, color: '#d1d5db', marginTop: 10 }}>
                  Supports BatchLeads, PropStream, Vulcan7, Google Contacts, and any standard CSV
                </div>
              </div>
              <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }}
                     onChange={e => { const f = e.target.files?.[0]; if (f) loadCsvFile(f); }} />
            </div>
          )}

          {/* ═══ CSV MODE — MAP ═════════════════════════════════════════ */}
          {mode === 'csv' && stage === 'map' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{rows.length} rows — map your columns</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 11, color: '#9ca3af' }}>Default source</label>
                  <select value={defaultSource} onChange={e => setDefaultSource(e.target.value)}
                    style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 5, color: '#374151' }}>
                    {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                {headers.map(col => (
                  <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 9 }}>
                    <div style={{ width: 140, fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{col}</div>
                    <span style={{ color: '#d1d5db', fontSize: 11 }}>→</span>
                    <select value={mapping[col] || ''} onChange={e => setMapping(m => ({ ...m, [col]: e.target.value }))}
                      style={{ flex: 1, fontSize: 11, padding: '5px 8px', border: '1px solid #e5e7eb', borderRadius: 5, color: '#374151' }}>
                      {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {mapping[col] && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />}
                  </div>
                ))}
              </div>
              {!Object.values(mapping).includes('phone') && (
                <div style={{ fontSize: 11, color: '#ef4444', marginTop: 10, display: 'flex', gap: 6 }}>
                  <span>⚠</span> Map a column to Phone before continuing
                </div>
              )}
            </div>
          )}

          {/* ═══ CSV MODE — PREVIEW ═════════════════════════════════════ */}
          {mode === 'csv' && stage === 'preview' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Preview — first 5 rows</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                      {Object.entries(mapping).filter(([,v]) => v).map(([col, field]) => (
                        <th key={col} style={{ textAlign: 'left', padding: '6px 10px 6px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af' }}>{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #fafafa' }}>
                        {Object.entries(mapping).filter(([,v]) => v).map(([col]) => (
                          <td key={col} style={{ padding: '6px 10px 6px 0', color: '#374151' }}>{row[col] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 12 }}>
                <strong style={{ color: '#111' }}>{rows.filter(r => {
                  const phoneCol = Object.entries(mapping).find(([,v]) => v === 'phone')?.[0];
                  return phoneCol ? !!r[phoneCol] : false;
                }).length}</strong> contacts with phone numbers will be imported. Duplicates skipped automatically.
              </div>
            </div>
          )}

          {/* ═══ DONE (shared) ═════════════════════════════════════════ */}
          {stage === 'done' && result && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16, color: GOLD }}>✓</div>
              <div style={{ fontSize: 22, fontWeight: 300, color: '#111', marginBottom: 8, fontFamily: "'Cormorant Garamond', serif" }}>
                {result.imported} contacts imported
              </div>
              {result.skipped > 0 && (
                <div style={{ fontSize: 13, color: '#9ca3af' }}>{result.skipped} duplicates skipped</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '12px 16px', borderTop: '1px solid rgba(201,168,76,0.12)' }}
             className="sm:px-6">

          {stage === 'upload' && (
            <button onClick={onClose} style={{ padding: '9px 22px', borderRadius: 7, border: '1px solid #e5e7eb', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
              Cancel
            </button>
          )}

          {mode === 'csv' && stage === 'map' && (
            <>
              <button onClick={() => setStage('upload')} style={{ padding: '9px 18px', borderRadius: 7, border: '1px solid #e5e7eb', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
                ← Back
              </button>
              <button
                onClick={() => setStage('preview')}
                disabled={!Object.values(mapping).includes('phone')}
                style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: GOLD, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !Object.values(mapping).includes('phone') ? 0.5 : 1 }}>
                Preview →
              </button>
            </>
          )}

          {mode === 'csv' && stage === 'preview' && (
            <>
              <button onClick={() => setStage('map')} style={{ padding: '9px 18px', borderRadius: 7, border: '1px solid #e5e7eb', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
                ← Back
              </button>
              <button onClick={handleCsvImport} disabled={importing} style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: GOLD, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: importing ? 0.7 : 1 }}>
                {importing ? 'Importing…' : `Import ${rows.length} contacts`}
              </button>
            </>
          )}

          {mode === 'vcf' && stage === 'preview' && (
            <>
              <button onClick={() => setStage('upload')} style={{ padding: '9px 18px', borderRadius: 7, border: '1px solid #e5e7eb', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
                ← Back
              </button>
              <button onClick={handleVcfImport} disabled={importing} style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: GOLD, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: importing ? 0.7 : 1 }}>
                {importing ? 'Importing…' : `Import ${vcfContacts.length} contacts`}
              </button>
            </>
          )}

          {stage === 'done' && (
            <button onClick={() => { onImported(result?.imported || 0); onClose(); }}
              style={{ padding: '9px 28px', borderRadius: 7, border: 'none', background: GOLD, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
