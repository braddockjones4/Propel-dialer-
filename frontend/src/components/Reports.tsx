import React, { useState, useEffect, useRef } from 'react';
import { API_BASE, authFetch } from '../config';


interface DailyReport {
  date: string;
  agentName: string;
  summary: {
    totalCalls: number;
    totalDuration: number;
    avgDuration: number;
    hotLeads: number;
    callbacks: number;
    textsSent: number;
    newContacts: number;
    appointments: number;
    avgAiScore: number | null;
  };
  dispositions: Record<string, number>;
  calls: Array<{ time: string; name: string; phone: string; source: string; duration: number; disposition: string; aiScore?: number; notes: string }>;
  appointments: Array<{ time: string; name: string; phone: string; title: string; location: string }>;
}

function fmtDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Reports() {
  const [date, setDate]       = useState(new Date().toISOString().split('T')[0]);
  const [report, setReport]   = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const printRef              = useRef<HTMLDivElement>(null);

  const loadReport = () => {
    setLoading(true);
    authFetch(`${API_BASE}/reports/daily?date=${date}`)
      .then(r => r.json())
      .then(data => { setReport(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadReport(); }, [date]);

  const printReport = () => window.print();

  const downloadCSV = (type: 'contacts' | 'calls') => {
    window.open(`${API_BASE}/reports/${type}.csv`, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">

        {/* Header / controls */}
        <div className="flex items-center justify-between mb-6 print:hidden">
          <div>
            <h1 className="text-3xl font-light text-black tracking-tight">Reports</h1>
            <p className="text-sm text-gray-400 mt-0.5">Daily summaries &amp; data exports</p>
          </div>
          <div className="flex items-center gap-3">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="field-input w-40" />
            <button onClick={printReport} className="btn-ghost px-4 py-2 text-sm">🖨 Print / PDF</button>
            <button onClick={() => downloadCSV('contacts')} className="btn-ghost px-4 py-2 text-sm">⬇ Contacts CSV</button>
            <button onClick={() => downloadCSV('calls')} className="btn-gold px-4 py-2 text-sm">⬇ Calls CSV</button>
          </div>
        </div>

        {loading && <div className="text-center text-gray-400 py-20">Loading report…</div>}

        {report && (
          <div ref={printRef}>
            {/* Print header */}
            <div className="hidden print:flex items-center justify-between mb-8 pb-4 border-b-2" style={{ borderColor: '#C9A84C' }}>
              <div>
                <div className="text-2xl font-light tracking-widest" style={{ color: '#C9A84C' }}>Real Estate AI</div>
                <div className="text-sm text-gray-500">Daily Activity Report</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-light">{report.agentName}</div>
                <div className="text-sm text-gray-500">{report.date}</div>
              </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Total Calls',    value: report.summary.totalCalls,                  gold: false },
                { label: 'Hot Leads',      value: report.summary.hotLeads,                    gold: true  },
                { label: 'Talk Time',      value: fmtDuration(report.summary.totalDuration),  gold: false },
                { label: 'Appointments',   value: report.summary.appointments,                gold: true  },
                { label: 'Avg Duration',   value: `${report.summary.avgDuration}s`,           gold: false },
                { label: 'Callbacks',      value: report.summary.callbacks,                   gold: false },
                { label: 'Texts Sent',     value: report.summary.textsSent,                   gold: false },
                { label: 'AI Call Score',  value: report.summary.avgAiScore != null ? `${report.summary.avgAiScore}/100` : '—', gold: false },
              ].map(s => (
                <div key={s.label} className="card text-center py-3">
                  <div className="text-2xl font-light" style={{ color: s.gold ? '#9A7A2E' : '#000' }}>{s.value}</div>
                  <div className="text-[10px] text-gray-400 tracking-widest uppercase mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Disposition breakdown */}
            {Object.keys(report.dispositions).length > 0 && (
              <div className="card mb-5">
                <h3 className="field-label mb-3">Disposition Breakdown</h3>
                <div className="space-y-2">
                  {Object.entries(report.dispositions)
                    .sort(([, a], [, b]) => b - a)
                    .map(([disp, count]) => {
                      const pct = report.summary.totalCalls > 0 ? (count / report.summary.totalCalls) * 100 : 0;
                      return (
                        <div key={disp} className="flex items-center gap-3">
                          <span className="text-xs text-gray-600 w-40 capitalize">{disp.replace(/-/g, ' ')}</span>
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#C9A84C' }} />
                          </div>
                          <span className="text-xs text-gray-500 w-8 text-right">{count}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Appointments today */}
            {report.appointments.length > 0 && (
              <div className="card mb-5">
                <h3 className="field-label mb-3">Appointments</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Time','Contact','Phone','Type','Location'].map(h => (
                        <th key={h} className="text-left py-2 text-[10px] tracking-widest uppercase text-gray-400 font-normal">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.appointments.map((a, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-2 text-xs font-mono" style={{ color: '#C9A84C' }}>{a.time}</td>
                        <td className="py-2 text-xs font-medium">{a.name}</td>
                        <td className="py-2 text-xs text-gray-500">{a.phone}</td>
                        <td className="py-2 text-xs text-gray-600">{a.title}</td>
                        <td className="py-2 text-xs text-gray-400">{a.location || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Call log */}
            <div className="card">
              <h3 className="field-label mb-3">Call Log — {report.calls.length} calls</h3>
              {report.calls.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No calls on this date</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Time','Contact','Source','Duration','Disposition','AI Score','Notes'].map(h => (
                        <th key={h} className="text-left py-2 text-[10px] tracking-widest uppercase text-gray-400 font-normal pr-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.calls.map((c, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 text-xs font-mono pr-3" style={{ color: '#C9A84C' }}>{c.time}</td>
                        <td className="py-2 text-xs font-medium pr-3 max-w-[130px] truncate">{c.name}</td>
                        <td className="py-2 text-xs text-gray-400 pr-3 capitalize">{c.source}</td>
                        <td className="py-2 text-xs text-gray-600 pr-3">{c.duration}s</td>
                        <td className="py-2 text-xs pr-3">
                          <span className="capitalize" style={{ color: c.disposition === 'hot-lead' ? '#9A7A2E' : '#6b7280' }}>
                            {c.disposition.replace(/-/g, ' ')}
                          </span>
                        </td>
                        <td className="py-2 text-xs pr-3">{c.aiScore ?? '—'}</td>
                        <td className="py-2 text-xs text-gray-400 max-w-[150px] truncate">{c.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Print footer */}
            <div className="hidden print:block text-center text-xs text-gray-300 mt-8 pt-4 border-t border-gray-100">
              Generated by Propel Dialer · {new Date().toLocaleString()}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          .print\\:flex { display: flex !important; }
          .print\\:block { display: block !important; }
          body { background: white; }
        }
      `}</style>
    </div>
  );
}
