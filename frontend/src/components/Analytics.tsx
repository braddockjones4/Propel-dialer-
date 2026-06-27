import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../config';


interface AnalyticsData {
  calls: { total: number; today: number; week: number; month: number };
  contacts: { total: number; hot: number; dnc: number };
  messages: { total: number; outbound: number };
  rates: { answerRate: number; hotRate: number };
  dispositions: Array<{ label: string; count: number }>;
  callsByDay: Array<{ day: string; count: number }>;
  contactsByStatus: Array<{ label: string; count: number }>;
  contactsBySource: Array<{ label: string; count: number }>;
  recentCalls: Array<{
    id: string; duration: number; disposition: string | null; calledAt: string;
    contact: { firstName: string; lastName: string; phone: string };
  }>;
}

function StatCard({ label, value, sub, gold }: { label: string; value: string | number; sub?: string; gold?: boolean }) {
  return (
    <div className="card p-5">
      <div className="text-[10px] tracking-widest uppercase text-gray-400 mb-1">{label}</div>
      <div className="text-3xl font-light" style={{ color: gold ? '#9A7A2E' : '#0A0A0A' }}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function MiniBar({ data, maxVal }: { data: Array<{ day: string; count: number }>; maxVal: number }) {
  return (
    <div className="flex items-end gap-1 h-20 mt-2">
      {data.map((d, i) => {
        const pct = maxVal > 0 ? (d.count / maxVal) * 100 : 0;
        const isToday = i === data.length - 1;
        return (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.day}: ${d.count} calls`}>
            <div className="w-full rounded-t transition-all"
                 style={{
                   height: `${Math.max(pct, 2)}%`,
                   background: isToday ? '#C9A84C' : 'rgba(201,168,76,0.25)',
                   minHeight: '2px',
                 }} />
          </div>
        );
      })}
    </div>
  );
}

function DonutSlice({ slices }: { slices: Array<{ label: string; count: number; color: string }> }) {
  const total = slices.reduce((s, d) => s + d.count, 0);
  if (total === 0) return <div className="text-gray-300 text-sm text-center py-4">No data yet</div>;

  let offset = 0;
  const r = 40;
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="flex items-center gap-4">
      <svg width="120" height="120" viewBox="0 0 120 120">
        {slices.map((s, i) => {
          const pct = s.count / total;
          const dashArray = circumference * pct;
          const dashOffset = circumference * (1 - offset);
          offset += pct;
          return (
            <circle
              key={i}
              r={r} cx={cx} cy={cy}
              fill="none"
              stroke={s.color}
              strokeWidth="20"
              strokeDasharray={`${dashArray} ${circumference}`}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 60 60)"
            />
          );
        })}
        <circle r={28} cx={cx} cy={cy} fill="white" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fill="#0A0A0A" fontWeight="300">{total}</text>
      </svg>
      <div className="space-y-1.5">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-xs text-gray-600 capitalize">{s.label}</span>
            <span className="text-xs text-gray-400 ml-auto pl-2">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  new: '#A0A0A0', contacted: '#C9A84C', callback: '#60A5FA',
  hot: '#22C55E', dnc: '#EF4444', default: '#D0D0D0',
};
const SOURCE_COLORS = ['#C9A84C', '#9A7A2E', '#E8D5A3', '#7A6030', '#60A5FA', '#A78BFA'];

function formatDuration(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const DISP_LABEL: Record<string, string> = {
  'hot-lead': 'Hot Lead', 'callback-scheduled': 'Callback', 'no-answer': 'No Answer',
  'not-interested': 'Not Interested', voicemail: 'Voicemail', dnc: 'DNC',
};

export default function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    authFetch(`${API_BASE}/analytics`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError('Failed to load analytics'); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm tracking-widest uppercase">Loading analytics…</div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-red-400 text-sm">{error}</div>
    </div>
  );

  if (!data) return null;

  const maxDay = Math.max(...data.callsByDay.map(d => d.count), 1);

  const statusSlices = data.contactsByStatus.map(d => ({
    label: d.label, count: d.count,
    color: STATUS_COLORS[d.label] || STATUS_COLORS.default,
  }));

  const sourceSlices = data.contactsBySource.map((d, i) => ({
    label: d.label, count: d.count,
    color: SOURCE_COLORS[i % SOURCE_COLORS.length],
  }));

  return (
    <div className="min-h-screen bg-gray-50 p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif font-light text-2xl text-black tracking-wide">Analytics</h1>
          <div className="gold-line mt-2 w-16" />
        </div>
        <button onClick={load} className="btn-gold-outline px-4 py-2 text-xs">Refresh</button>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 gap-3 mb-3 lg:grid-cols-4">
        <StatCard label="Total Calls" value={data.calls.total} sub={`${data.calls.today} today · ${data.calls.week} this week`} />
        <StatCard label="Answer Rate" value={`${data.rates.answerRate}%`} sub="of all calls answered" />
        <StatCard label="Hot Leads" value={data.contacts.hot} sub={`${data.rates.hotRate}% conversion`} gold />
        <StatCard label="Contacts" value={data.contacts.total} sub={`${data.contacts.dnc} DNC`} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-4">
        <StatCard label="Calls This Month" value={data.calls.month} />
        <StatCard label="Texts Sent" value={data.messages.outbound} sub={`${data.messages.total} total (incl. replies)`} />
        <StatCard label="Inbound Replies" value={data.messages.total - data.messages.outbound} />
        <StatCard label="DNC List" value={data.contacts.dnc} />
      </div>

      <div className="grid grid-cols-1 gap-4 mb-4 lg:grid-cols-3">

        {/* Calls by day */}
        <div className="card p-5 lg:col-span-2">
          <div className="field-label mb-1">Calls — Last 14 Days</div>
          <MiniBar data={data.callsByDay} maxVal={maxDay} />
          <div className="flex justify-between mt-1">
            <span className="text-[9px] text-gray-300">{data.callsByDay[0]?.day}</span>
            <span className="text-[9px] text-gray-300">Today</span>
          </div>
        </div>

        {/* Disposition breakdown */}
        <div className="card p-5">
          <div className="field-label mb-3">Call Outcomes</div>
          {data.dispositions.length === 0 ? (
            <div className="text-gray-300 text-sm">No calls logged yet.</div>
          ) : (
            <div className="space-y-2">
              {data.dispositions.slice(0, 7).map(d => {
                const total = data.dispositions.reduce((s, x) => s + x.count, 0);
                const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
                return (
                  <div key={d.label}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-gray-600 capitalize">{DISP_LABEL[d.label] || d.label}</span>
                      <span className="text-gray-400">{d.count} ({pct}%)</span>
                    </div>
                    <div className="h-1 rounded-full bg-gray-100">
                      <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: '#C9A84C' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 mb-4 lg:grid-cols-2">
        {/* Contact by status */}
        <div className="card p-5">
          <div className="field-label mb-3">Contacts by Status</div>
          <DonutSlice slices={statusSlices} />
        </div>

        {/* Contact by source */}
        <div className="card p-5">
          <div className="field-label mb-3">Contacts by Source</div>
          <DonutSlice slices={sourceSlices} />
        </div>
      </div>

      {/* Recent calls log */}
      <div className="card p-5">
        <div className="field-label mb-3">Recent Calls</div>
        {data.recentCalls.length === 0 ? (
          <div className="text-gray-300 text-sm">No calls recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: 'rgba(201,168,76,0.15)' }}>
                  {['Contact', 'Phone', 'Duration', 'Outcome', 'Time'].map(h => (
                    <th key={h} className="text-left py-2 pr-4 field-label font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recentCalls.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-2 pr-4 font-medium text-black">
                      {c.contact?.firstName} {c.contact?.lastName}
                    </td>
                    <td className="py-2 pr-4 font-mono" style={{ color: '#C9A84C' }}>
                      {c.contact?.phone}
                    </td>
                    <td className="py-2 pr-4 text-gray-500">{formatDuration(c.duration)}</td>
                    <td className="py-2 pr-4">
                      <span className="text-gray-600 capitalize">
                        {DISP_LABEL[c.disposition || ''] || c.disposition || '—'}
                      </span>
                    </td>
                    <td className="py-2 text-gray-400">{formatDate(c.calledAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
