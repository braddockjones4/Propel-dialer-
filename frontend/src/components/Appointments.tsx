import React, { useState, useEffect } from 'react';
import { API_BASE, authFetch } from '../config';


interface Appointment {
  id: string;
  title: string;
  scheduledAt: string;
  duration: number;
  location?: string;
  notes?: string;
  status: string;
  smsSent: boolean;
  contact: { id: string; firstName: string; lastName: string; phone: string; address?: string };
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  address?: string;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function Appointments() {
  const now = new Date();
  const [year,  setYear]   = useState(now.getFullYear());
  const [month, setMonth]  = useState(now.getMonth());
  const [appts, setAppts]  = useState<Appointment[]>([]);
  const [selected, setSelected] = useState<number | null>(null); // day number
  const [showBook, setShowBook] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);

  // Book form state
  const [bContactId,  setBContactId]  = useState('');
  const [bTitle,      setBTitle]      = useState('Listing Appointment');
  const [bDate,       setBDate]       = useState('');
  const [bTime,       setBTime]       = useState('10:00');
  const [bDuration,   setBDuration]   = useState(60);
  const [bLocation,   setBLocation]   = useState('');
  const [bNotes,      setBNotes]      = useState('');
  const [bSendSms,    setBSendSms]    = useState(true);
  const [booking,     setBooking]     = useState(false);
  const [bookMsg,     setBookMsg]     = useState('');

  const load = () => {
    authFetch(`${API_BASE}/appointments?month=${month + 1}&year=${year}`)
      .then(r => r.json()).then(setAppts).catch(() => {});
    authFetch(`${API_BASE}/appointments/upcoming`)
      .then(r => r.json()).then(setUpcoming).catch(() => {});
  };

  useEffect(() => { load(); }, [month, year]);
  useEffect(() => {
    authFetch(`${API_BASE}/contacts?limit=200`)
      .then(r => r.json()).then(setContacts).catch(() => {});
  }, []);

  const apptsByDay: Record<number, Appointment[]> = {};
  appts.forEach(a => {
    const d = new Date(a.scheduledAt).getDate();
    if (!apptsByDay[d]) apptsByDay[d] = [];
    apptsByDay[d].push(a);
  });

  const daysInMonth  = getDaysInMonth(year, month);
  const firstDayOfMonth = getFirstDayOfMonth(year, month);
  const cells = Array(firstDayOfMonth).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const handleBook = async () => {
    if (!bContactId || !bDate || !bTime) { setBookMsg('Fill in all required fields.'); return; }
    setBooking(true); setBookMsg('');
    const scheduledAt = new Date(`${bDate}T${bTime}`).toISOString();
    const r = await authFetch(`${API_BASE}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: bContactId, title: bTitle, scheduledAt, duration: bDuration, location: bLocation, notes: bNotes, sendSms: bSendSms }),
    });
    const data = await r.json();
    setBooking(false);
    if (r.ok) {
      setBookMsg('Appointment booked' + (bSendSms ? ' & SMS sent ✓' : ' ✓'));
      setShowBook(false); load();
    } else { setBookMsg(data.error || 'Failed'); }
  };

  const cancelAppt = async (id: string) => {
    await authFetch(`${API_BASE}/appointments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) });
    load();
  };

  const selectedAppts = selected ? (apptsByDay[selected] || []) : [];
  const today = new Date();
  const isToday = (d: number) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">

      {/* ── Left: Calendar ─────────────────────────────── */}
      <div className="flex-1 p-3 md:p-6">
        {/* Header */}
        <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between md:mb-5">
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} className="btn-ghost px-2 py-1 text-lg">‹</button>
            <h2 className="text-xl font-light tracking-wide text-black">{MONTHS[month]} {year}</h2>
            <button onClick={nextMonth} className="btn-ghost px-2 py-1 text-lg">›</button>
          </div>
          <button onClick={() => { setShowBook(true); setBookMsg(''); }} className="btn-gold px-4 py-2 text-sm w-full md:w-auto">
            + Book Appointment
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map(d => (
            <div key={d} className="text-center text-[10px] tracking-widest uppercase text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden border border-gray-100">
          {cells.map((day, i) => (
            <div
              key={i}
              onClick={() => day && setSelected(day === selected ? null : day)}
              className={`min-h-[55px] md:min-h-[90px] p-1 md:p-2 cursor-pointer transition-colors ${day ? 'bg-white hover:bg-gray-50' : 'bg-gray-50'} ${selected === day ? 'ring-1 ring-inset' : ''}`}
              style={selected === day ? { outline: '1px solid #C9A84C', outlineOffset: '-1px' } : {}}
            >
              {day && (
                <>
                  <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday(day) ? 'text-white' : 'text-gray-700'}`}
                       style={isToday(day) ? { background: '#C9A84C' } : {}}>
                    {day}
                  </div>
                  {(apptsByDay[day] || []).slice(0, 3).map(a => (
                    <div key={a.id} className="text-[10px] px-1 py-0.5 rounded mb-0.5 truncate"
                         style={{
                           background: a.status === 'cancelled' ? '#f3f4f6' : 'rgba(201,168,76,0.12)',
                           color:      a.status === 'cancelled' ? '#9ca3af'  : '#9A7A2E',
                           textDecoration: a.status === 'cancelled' ? 'line-through' : 'none',
                         }}>
                      {new Date(a.scheduledAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} {a.contact.firstName}
                    </div>
                  ))}
                  {(apptsByDay[day] || []).length > 3 && (
                    <div className="text-[9px] text-gray-400">+{apptsByDay[day].length - 3} more</div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: Sidebar ─────────────────────────────── */}
      <div className="w-full md:w-72 bg-white border-t md:border-t md:border-l border-gray-100 p-4 md:p-5 flex flex-col gap-5">

        {/* Selected day detail */}
        {selected && (
          <div>
            <h3 className="field-label mb-3">{MONTHS[month]} {selected}</h3>
            {selectedAppts.length === 0 ? (
              <p className="text-sm text-gray-400">No appointments</p>
            ) : (
              <div className="space-y-2">
                {selectedAppts.map(a => (
                  <div key={a.id} className="card p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-black">{a.contact.firstName} {a.contact.lastName}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{a.title}</p>
                        <p className="text-xs font-mono mt-0.5" style={{ color: '#C9A84C' }}>
                          {new Date(a.scheduledAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} · {a.duration}min
                        </p>
                        {a.location && <p className="text-xs text-gray-400 mt-0.5">{a.location}</p>}
                        {a.smsSent && <p className="text-[10px] text-green-500 mt-1">SMS confirmed ✓</p>}
                      </div>
                      {a.status !== 'cancelled' && (
                        <button onClick={() => cancelAppt(a.id)} className="text-[10px] text-red-400 hover:text-red-600">Cancel</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upcoming */}
        <div>
          <h3 className="field-label mb-3">Upcoming</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-gray-400">No upcoming appointments</p>
          ) : (
            <div className="space-y-2">
              {upcoming.slice(0, 6).map(a => (
                <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-50">
                  <div className="text-center w-9 flex-shrink-0">
                    <div className="text-[10px] text-gray-400 uppercase">{new Date(a.scheduledAt).toLocaleDateString('en-US',{month:'short'})}</div>
                    <div className="text-lg font-light leading-none">{new Date(a.scheduledAt).getDate()}</div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{a.contact.firstName} {a.contact.lastName}</p>
                    <p className="text-[11px] text-gray-400">{new Date(a.scheduledAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})} · {a.title}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Book Appointment Modal ──────────────────────── */}
      {showBook && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-md p-6 shadow-xl">
            <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between md:mb-5">
              <h2 className="text-lg font-light tracking-wide">Book Appointment</h2>
              <button onClick={() => setShowBook(false)} className="text-gray-400 hover:text-black text-xl">×</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="field-label">Contact *</label>
                <select value={bContactId} onChange={e => setBContactId(e.target.value)} className="field-input">
                  <option value="">Select contact…</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName} — {c.phone}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Appointment Type</label>
                <select value={bTitle} onChange={e => setBTitle(e.target.value)} className="field-input">
                  <option>Listing Appointment</option>
                  <option>Buyer Consultation</option>
                  <option>Property Showing</option>
                  <option>Follow-Up Meeting</option>
                  <option>Market Analysis Presentation</option>
                  <option>Contract Review</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Date *</label>
                  <input type="date" value={bDate} onChange={e => setBDate(e.target.value)} className="field-input" min={new Date().toISOString().split('T')[0]} />
                </div>
                <div>
                  <label className="field-label">Time *</label>
                  <input type="time" value={bTime} onChange={e => setBTime(e.target.value)} className="field-input" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Duration</label>
                  <select value={bDuration} onChange={e => setBDuration(Number(e.target.value))} className="field-input">
                    <option value={30}>30 min</option>
                    <option value={60}>1 hour</option>
                    <option value={90}>90 min</option>
                    <option value={120}>2 hours</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">Location</label>
                  <input type="text" value={bLocation} onChange={e => setBLocation(e.target.value)} placeholder="Address or Zoom" className="field-input" />
                </div>
              </div>
              <div>
                <label className="field-label">Notes</label>
                <textarea value={bNotes} onChange={e => setBNotes(e.target.value)} rows={2} className="field-input resize-none" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={bSendSms} onChange={e => setBSendSms(e.target.checked)} style={{ accentColor: '#C9A84C' }} />
                <span className="text-sm text-gray-600">Send SMS confirmation to contact</span>
              </label>
            </div>

            {bookMsg && <p className="text-sm mt-3" style={{ color: bookMsg.includes('✓') ? '#22c55e' : '#ef4444' }}>{bookMsg}</p>}

            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowBook(false)} className="btn-ghost flex-1 py-2">Cancel</button>
              <button onClick={handleBook} disabled={booking} className="btn-gold flex-1 py-2">
                {booking ? 'Booking…' : 'Book Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
