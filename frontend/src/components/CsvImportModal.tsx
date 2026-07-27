// ── Import Contacts Modal ─────────────────────────────────────────────────────
// Single import path — file upload (the industry standard, per PhoneBurner/Mojo):
//   1. Upload a CSV or vCard (.vcf) — auto-detected from one button
//   2. CSV columns are auto-mapped (adjustable), then preview → import
//   3. Duplicates are skipped automatically server-side
// Fully client-side parsing: no OAuth, no third-party APIs, nothing to break.
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { API_BASE, authFetch } from '../config';

const GOLD = '#C9A84C';
const DARK = '#0A0A0A';

interface ParsedRow { [key: string]: string }
interface Props {
  onClose: () => void;
  onImported: (count: number) => void;
  preloadedVcfText?: string;
}

// ── Field options for CSV column mapping ─────────────────────────────────────
const FIELD_OPTIONS = [
  { value: '',          label: 'Skip this column' },
  { value: 'fullName',  label: 'Full Name (auto-split)' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName',  label: 'Last Name' },
  { value: 'phone',     label: 'Phone (required)' },
  { value: 'address',   label: 'Address' },
  { value: 'city',      label: 'City' },
  { value: 'state',     label: 'State' },
  { value: 'zip',       label: 'Zip' },
  { value: 'email',     label: 'Email' },
  { value: 'source',    label: 'Source' },
  { value: 'status',    label: 'Status' },
];

const SOURCE_OPTIONS = ['manual', 'expired', 'fsbo', 'circle', 'past-client'];

// ── Helpers (exported for reuse in OnboardingWizard) ─────────────────────────
export function guessMapping(header: string): string {
  const h = header.toLowerCase().replace(/[^a-z]/g, '');
  if (h === 'name' || h === 'fullname' || h === 'contactname' || h === 'ownername') return 'fullName';
  if (h.includes('first'))   return 'firstName';
  if (h.includes('last'))    return 'lastName';
  if (h.includes('phone') || h.includes('mobile') || h.includes('cell')) return 'phone';
  if (h.includes('addr') || h === 'street') return 'address';
  if (h.includes('city'))    return 'city';
  if (h.includes('state'))   return 'state';
  if (h.includes('zip') || h.includes('postal')) return 'zip';
  if (h.includes('email'))   return 'email';
  if (h.includes('source'))  return 'source';
  if (h.includes('status'))  return 'status';
  return '';
}

export function parseCsv(text: string): { headers: string[]; rows: ParsedRow[] } {
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
export function parseVCard(text: string): ParsedRow[] {
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

      if (prop === 'FN' && value) contact._fn = value;

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
export async function postImport(contacts: ParsedRow[], source: string): Promise<{ imported: number; skipped: number }> {
  const data = contacts.map(c => ({ ...c, source: c.source || source }));
  const res = await authFetch(`${API_BASE}/contacts/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contacts: data }),
  });
  const json = await res.json();
  return { imported: json.count ?? json.imported ?? data.length, skipped: json.skipped ?? 0 };
}

// ── Stages ────────────────────────────────────────────────────────────────────
type Stage = 'choose' | 'map' | 'preview' | 'done';

export default function CsvImportModal({ onClose, onImported, preloadedVcfText }: Props) {
  const [stage, setStage]       = useState<Stage>('choose');
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState('');

  // CSV state
  const [headers, setHeaders]   = useState<string[]>([]);
  const [rows, setRows]         = useState<ParsedRow[]>([]);
  const [mapping, setMapping]   = useState<Record<string, string>>({});
  const [defaultSource, setDefaultSource] = useState('manual');
  const [fileName, setFileName] = useState('');

  // VCF state (parsed contacts skip mapping — go straight to preview)
  const [vcfContacts, setVcfContacts] = useState<ParsedRow[]>([]);
  const isVcf = vcfContacts.length > 0;

  // Shared
  const [importing, setImporting] = useState(false);
  const [result, setResult]       = useState<{ imported: number; skipped: number } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // PWA share target: if a .vcf was shared to the app, parse it immediately
  useEffect(() => {
    if (preloadedVcfText) {
      const parsed = parseVCard(preloadedVcfText);
      setVcfContacts(parsed);
      setStage(parsed.length > 0 ? 'preview' : 'choose');
    }
  }, [preloadedVcfText]);

  // ── Unified file loading — auto-detects CSV vs vCard ──────────────────────
  const loadFile = (file: File) => {
    setFileError('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const lower = file.name.toLowerCase();
      const looksVcf = lower.endsWith('.vcf') || lower.endsWith('.vcard') || /BEGIN:VCARD/i.test(text.slice(0, 500));

      if (looksVcf) {
        const parsed = parseVCard(text);
        if (!parsed.length) { setFileError('No contacts with phone numbers found in this file.'); return; }
        setVcfContacts(parsed);
        setRows([]);
        setStage('preview');
      } else {
        const { headers: h, rows: r } = parseCsv(text);
        if (!h.length || !r.length) { setFileError('Could not read this file. Make sure it is a CSV with a header row.'); return; }
        setHeaders(h); setRows(r); setVcfContacts([]);
        const auto: Record<string, string> = {};
        h.forEach(hdr => { auto[hdr] = guessMapping(hdr); });
        setMapping(auto);
        setStage('map');
      }
    };
    reader.readAsText(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, []);

  // ── Build contacts from CSV mapping (handles fullName split) ──────────────
  const buildCsvContacts = (): ParsedRow[] => {
    return rows.map(row => {
      const c: ParsedRow = { source: defaultSource };
      Object.entries(mapping).forEach(([col, field]) => {
        if (!field) return;
        const val = row[col] || '';
        if (field === 'fullName') {
          if (val && !c.firstName) {
            const parts = val.trim().split(/\s+/);
            c.firstName = parts[0] || '';
            c.lastName  = parts.slice(1).join(' ') || c.lastName || '';
          }
        } else {
          c[field] = val;
        }
      });
      return c;
    }).filter(c => c.phone);
  };

  const csvImportable = (() => {
    const phoneCol = Object.entries(mapping).find(([, v]) => v === 'phone')?.[0];
    if (!phoneCol) return 0;
    return rows.filter(r => !!r[phoneCol]).length;
  })();

  // ── Import handlers ────────────────────────────────────────────────────────
  const handleFileImport = async () => {
    setImporting(true);
    try {
      const contacts = isVcf ? vcfContacts : buildCsvContacts();
      if (!contacts.length) { setFileError('No rows with a phone number found.'); setImporting(false); return; }
      const r = await postImport(contacts, defaultSource);
      setResult(r); setStage('done');
    } catch { setFileError('Import failed. Please try again.'); }
    finally { setImporting(false); }
  };

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  const previewContacts = isVcf ? vcfContacts : buildCsvContacts();

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
            <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
              {stage === 'choose' && 'Upload a CSV or contacts file'}
              {stage === 'map' && `${fileName} — review column matches`}
              {stage === 'preview' && 'Review before importing'}
              {stage === 'done' && 'Import complete'}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#d1d5db' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }} className="sm:px-6">

          {/* ═══ STAGE: CHOOSE METHOD ═══════════════════════════════════ */}
          {stage === 'choose' && (
            <div>
              {/* Upload file — hero card doubles as drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                style={{
                  borderRadius: 14, padding: '26px 20px', marginBottom: 14, cursor: 'pointer',
                  background: dragging ? 'rgba(201,168,76,0.06)' : `linear-gradient(135deg, ${DARK} 0%, #1c1c1c 100%)`,
                  border: dragging ? `2px dashed ${GOLD}` : '1px solid rgba(201,168,76,0.35)',
                  display: 'flex', alignItems: 'center', gap: 16, transition: 'all 0.15s',
                }}
              >
                <span style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 12, background: 'rgba(201,168,76,0.12)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="22" height="22" fill="none" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5l5 5M4 20h16" stroke={GOLD} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: dragging ? '#111' : '#fff' }}>Upload a File</span>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: DARK, background: GOLD, borderRadius: 4, padding: '2px 7px' }}>Recommended</span>
                  </div>
                  <div style={{ fontSize: 12, color: dragging ? '#6b7280' : 'rgba(255,255,255,0.55)', marginTop: 3, lineHeight: 1.5 }}>
                    CSV or vCard (.vcf) — columns match automatically.<br/>
                    Works with BatchLeads, PropStream, Vulcan7, RedX, iPhone exports.
                  </div>
                </div>
                <span style={{ fontSize: 18, color: 'rgba(201,168,76,0.6)' }}>›</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard,text/directory"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.currentTarget.value = ''; }}
              />

              {fileError && (
                <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
                  {fileError}
                </div>
              )}

              {/* Where to get your file */}
              <div style={{ background: '#fafaf8', border: '1px solid #f0eeea', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD, marginBottom: 10 }}>
                  Where to get your file
                </div>
                {[
                  { title: 'Lead lists', text: 'Export a CSV from BatchLeads, PropStream, Vulcan7, RedX, or any spreadsheet.' },
                  { title: 'iPhone contacts', text: 'Go to iCloud.com → Contacts → select all → Export vCard, then upload the .vcf here.' },
                  { title: 'Google contacts', text: 'Go to contacts.google.com → Export → CSV, then upload it here.' },
                ].map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: i < 2 ? 9 : 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', minWidth: 104, flexShrink: 0 }}>{s.title}</span>
                    <span style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.55 }}>{s.text}</span>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 11, color: '#c4c4c4', textAlign: 'center', marginTop: 14 }}>
                Duplicates are detected and skipped automatically
              </div>
            </div>
          )}

          {/* ═══ STAGE: MAP (CSV only) ══════════════════════════════════ */}
          {stage === 'map' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{rows.length} rows found</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 11, color: '#9ca3af' }}>Lead source</label>
                  <select value={defaultSource} onChange={e => setDefaultSource(e.target.value)}
                    style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 5, color: '#374151' }}>
                    {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: '#9ca3af', marginBottom: 14 }}>
                We matched your columns automatically — adjust anything that looks off.
              </div>
              <div>
                {headers.map(col => {
                  const sample = rows.find(r => r[col])?.[col] || '';
                  return (
                    <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 9 }}>
                      <div style={{ width: 160, overflow: 'hidden' }}>
                        <div style={{ fontSize: 12, color: '#111', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col}</div>
                        {sample && <div style={{ fontSize: 10, color: '#c4c4c4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>e.g. {sample}</div>}
                      </div>
                      <span style={{ color: '#d1d5db', fontSize: 11 }}>→</span>
                      <select value={mapping[col] || ''} onChange={e => setMapping(m => ({ ...m, [col]: e.target.value }))}
                        style={{ flex: 1, fontSize: 12, padding: '6px 8px', border: `1px solid ${mapping[col] ? 'rgba(201,168,76,0.4)' : '#e5e7eb'}`, borderRadius: 6, color: mapping[col] ? '#111' : '#9ca3af', background: mapping[col] ? '#fdfbf5' : '#fff' }}>
                        {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
              {!Object.values(mapping).includes('phone') && (
                <div style={{ fontSize: 11.5, color: '#dc2626', marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px' }}>
                  Select which column contains the phone number to continue.
                </div>
              )}
            </div>
          )}

          {/* ═══ STAGE: PREVIEW (CSV + VCF) ═════════════════════════════ */}
          {stage === 'preview' && (
            <div>
              <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                  {previewContacts.length} contacts ready to import
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>Duplicates skipped automatically</div>
              </div>
              <div style={{ overflowX: 'auto', border: '1px solid #f3f4f6', borderRadius: 10 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafaf8' }}>
                      {['Name', 'Phone', 'Email', 'City'].map(col => (
                        <th key={col} style={{ textAlign: 'left', padding: '9px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#9ca3af' }}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewContacts.slice(0, 8).map((c, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #f7f7f5' }}>
                        <td style={{ padding: '8px 12px', color: '#111', fontWeight: 500 }}>{[c.firstName, c.lastName].filter(Boolean).join(' ') || '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#374151', fontFamily: 'monospace', fontSize: 11 }}>{c.phone || '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{c.email || '—'}</td>
                        <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{c.city || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewContacts.length > 8 && (
                <div style={{ padding: '10px 2px 0', fontSize: 11, color: '#bbb' }}>
                  + {previewContacts.length - 8} more contacts…
                </div>
              )}
              {fileError && (
                <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', marginTop: 12 }}>
                  {fileError}
                </div>
              )}
            </div>
          )}

          {/* ═══ STAGE: DONE ════════════════════════════════════════════ */}
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

          {stage === 'choose' && (
            <button onClick={onClose} style={{ padding: '9px 22px', borderRadius: 7, border: '1px solid #e5e7eb', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
              Cancel
            </button>
          )}

          {stage === 'map' && (
            <>
              <button onClick={() => { setStage('choose'); setRows([]); setFileError(''); }} style={{ padding: '9px 18px', borderRadius: 7, border: '1px solid #e5e7eb', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
                ← Back
              </button>
              <button
                onClick={() => setStage('preview')}
                disabled={!csvImportable}
                style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: GOLD, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !csvImportable ? 0.5 : 1 }}>
                Preview {csvImportable > 0 ? `${csvImportable} contacts ` : ''}→
              </button>
            </>
          )}

          {stage === 'preview' && (
            <>
              <button onClick={() => { if (isVcf) { setStage('choose'); setVcfContacts([]); } else setStage('map'); }} style={{ padding: '9px 18px', borderRadius: 7, border: '1px solid #e5e7eb', background: 'transparent', fontSize: 12, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}>
                ← Back
              </button>
              <button onClick={handleFileImport} disabled={importing || !previewContacts.length} style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: GOLD, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: importing ? 0.7 : 1 }}>
                {importing ? 'Importing…' : `Import ${previewContacts.length} Contacts`}
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
