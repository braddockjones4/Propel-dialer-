import React, { useState, useRef, useCallback, useEffect } from 'react';
import { API_BASE, authFetch } from '../config';


interface ParsedRow { [key: string]: string }

interface Props { onClose: () => void; onImported: (count: number) => void; }

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

// Auto-guess column mapping from header name
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

// Parse CSV — handles quoted fields
function parseCsv(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
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

type Stage = 'upload' | 'map' | 'preview' | 'done';

export default function CsvImportModal({ onClose, onImported }: Props) {
  const [stage, setStage]       = useState<Stage>('upload');
  const [dragging, setDragging] = useState(false);
  const [headers, setHeaders]   = useState<string[]>([]);
  const [rows, setRows]         = useState<ParsedRow[]>([]);
  const [mapping, setMapping]   = useState<Record<string, string>>({});
  const [defaultSource, setDefaultSource] = useState('manual');
  const [importing, setImporting] = useState(false);
  const [result, setResult]     = useState<{ imported: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const { headers: h, rows: r } = parseCsv(text);
      setHeaders(h);
      setRows(r);
      const auto: Record<string, string> = {};
      h.forEach(hdr => { auto[hdr] = guessMapping(hdr); });
      setMapping(auto);
      setStage('map');
    };
    reader.readAsText(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.csv')) loadFile(file);
  }, []);

  const handleImport = async () => {
    setImporting(true);

    // Build contact objects from rows + mapping
    const contacts = rows.map(row => {
      const c: Record<string, string> = { source: defaultSource };
      Object.entries(mapping).forEach(([col, field]) => {
        if (field) c[field] = row[col] || '';
      });
      return c;
    }).filter(c => c.phone); // require phone

    if (contacts.length === 0) {
      setImporting(false);
      alert('No rows with a phone number found.');
      return;
    }

    try {
      const res = await authFetch(`${API_BASE}/contacts/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts }),
      });
      const data = await res.json();
      setResult({ imported: data.count || contacts.length, skipped: data.skipped || 0 });
      setStage('done');
    } catch {
      alert('Import failed. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
           style={{ border: '1px solid rgba(201,168,76,0.2)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'rgba(201,168,76,0.15)' }}>
          <div>
            <h2 className="font-serif font-light text-xl text-black">Import Contacts</h2>
            <p className="text-xs text-gray-400 mt-0.5">CSV from BatchLeads, PropStream, or any source</p>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-black transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">

          {/* ── Stage: upload ─────────────────────────────── */}
          {stage === 'upload' && (
            <div>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all"
                style={{
                  borderColor: dragging ? '#C9A84C' : '#E0E0E0',
                  background: dragging ? 'rgba(201,168,76,0.04)' : 'transparent',
                }}
              >
                <div className="text-4xl mb-3" style={{ color: 'rgba(201,168,76,0.4)' }}>⬆</div>
                <div className="text-gray-600 font-medium">Drop your CSV here</div>
                <div className="text-gray-400 text-sm mt-1">or click to browse</div>
                <div className="text-[11px] text-gray-300 mt-3">
                  Supports exports from BatchLeads, PropStream, Vulcan7, and any standard CSV
                </div>
              </div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden"
                     onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
            </div>
          )}

          {/* ── Stage: map ────────────────────────────────── */}
          {stage === 'map' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="field-label">{rows.length} rows detected — map your columns</div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Default source</label>
                  <select
                    value={defaultSource}
                    onChange={e => setDefaultSource(e.target.value)}
                    className="field-input text-xs py-1 px-2 w-36"
                  >
                    {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                {headers.map(col => (
                  <div key={col} className="flex items-center gap-3">
                    <div className="w-40 text-xs text-gray-600 truncate font-medium">{col}</div>
                    <span className="text-gray-300 text-xs">→</span>
                    <select
                      value={mapping[col] || ''}
                      onChange={e => setMapping(m => ({ ...m, [col]: e.target.value }))}
                      className="field-input text-xs py-1 flex-1"
                    >
                      {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {mapping[col] && (
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#22C55E' }} />
                    )}
                  </div>
                ))}
              </div>

              {!Object.values(mapping).includes('phone') && (
                <div className="text-xs text-red-400 flex items-center gap-1.5">
                  <span>⚠</span> Map a column to Phone before continuing
                </div>
              )}
            </div>
          )}

          {/* ── Stage: preview ────────────────────────────── */}
          {stage === 'preview' && (
            <div className="space-y-4">
              <div className="field-label">Preview — first 5 rows</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'rgba(201,168,76,0.15)' }}>
                      {Object.entries(mapping).filter(([,v]) => v).map(([col, field]) => (
                        <th key={col} className="text-left py-2 pr-3 field-label font-normal capitalize">{field}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        {Object.entries(mapping).filter(([,v]) => v).map(([col]) => (
                          <td key={col} className="py-2 pr-3 text-gray-600">{row[col] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-gray-400">
                <strong className="text-black">{rows.filter(r => {
                  const phoneCol = Object.entries(mapping).find(([,v]) => v === 'phone')?.[0];
                  return phoneCol ? !!r[phoneCol] : false;
                }).length}</strong> contacts with phone numbers will be imported.
                Duplicates (same phone) will be skipped automatically.
              </div>
            </div>
          )}

          {/* ── Stage: done ───────────────────────────────── */}
          {stage === 'done' && result && (
            <div className="text-center py-8">
              <div className="text-5xl mb-4" style={{ color: '#C9A84C' }}>✓</div>
              <div className="text-xl font-light text-black mb-1">{result.imported} contacts imported</div>
              {result.skipped > 0 && (
                <div className="text-sm text-gray-400">{result.skipped} duplicates skipped</div>
              )}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t" style={{ borderColor: 'rgba(201,168,76,0.15)' }}>
          {stage === 'upload' && (
            <button onClick={onClose} className="btn-ghost px-5 py-2 text-xs">Cancel</button>
          )}
          {stage === 'map' && (
            <>
              <button onClick={() => setStage('upload')} className="btn-ghost px-5 py-2 text-xs">← Back</button>
              <button
                onClick={() => setStage('preview')}
                disabled={!Object.values(mapping).includes('phone')}
                className="btn-gold px-5 py-2"
              >
                Preview →
              </button>
            </>
          )}
          {stage === 'preview' && (
            <>
              <button onClick={() => setStage('map')} className="btn-ghost px-5 py-2 text-xs">← Back</button>
              <button onClick={handleImport} disabled={importing} className="btn-gold px-6 py-2">
                {importing ? 'Importing…' : `Import ${rows.length} contacts`}
              </button>
            </>
          )}
          {stage === 'done' && (
            <button onClick={() => {
              onImported(result?.imported || 0);
              onClose();
            }} className="btn-gold px-6 py-2">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
