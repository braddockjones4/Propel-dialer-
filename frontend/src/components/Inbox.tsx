import React, { useEffect, useState, useRef, useCallback } from 'react';
import { API_BASE } from '../config';


interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  fromNumber: string;
  toNumber: string;
  status: string;
  sentAt: string;
  contactId?: string;
}

interface Thread {
  contactId?: string;
  contact?: { firstName: string; lastName: string; phone: string };
  phone: string;
  lastMessage: Message;
  unread: number;
}

// ── Desktop notification helper ───────────────────────────────────────────────
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function fireNotification(title: string, body: string, onClick?: () => void) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'propel-inbox', // replace instead of stack
    requireInteraction: false,
    silent: false,
  });
  if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
  setTimeout(() => n.close(), 8000);
}

export default function Inbox() {
  const [threads, setThreads]           = useState<Thread[]>([]);
  const [selected, setSelected]         = useState<Thread | null>(null);
  const [messages, setMessages]         = useState<Message[]>([]);
  const [reply, setReply]               = useState('');
  const [sending, setSending]           = useState(false);
  const [loading, setLoading]           = useState(true);
  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [mobileView, setMobileView] = useState<'list' | 'thread'>('list');
  const bottomRef  = useRef<HTMLDivElement>(null);
  const prevMsgIds = useRef<Set<string>>(new Set());
  const selectedRef = useRef<Thread | null>(null);

  // Keep ref in sync with state so polling closure always sees current selected
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const loadThreads = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    const data: Thread[] = await fetch(`${API_BASE}/inbox`).then(r => r.json()).catch(() => []);

    // Detect new inbound messages since last poll
    if (isPolling) {
      for (const thread of data) {
        const msg = thread.lastMessage;
        if (msg.direction === 'inbound' && !prevMsgIds.current.has(msg.id)) {
          const name = thread.contact
            ? `${thread.contact.firstName} ${thread.contact.lastName}`
            : thread.phone;
          fireNotification(`New reply from ${name}`, msg.body, () => {
            // Will focus the window; actual thread open handled by user click
          });
        }
        prevMsgIds.current.add(msg.id);
      }
    } else {
      // Seed known IDs on first load so we don't alert on stale messages
      data.forEach(t => prevMsgIds.current.add(t.lastMessage.id));
    }

    setThreads(data);
    if (!isPolling) setLoading(false);

    // Refresh messages if a thread is open
    const sel = selectedRef.current;
    if (sel?.contactId) {
      const msgs: Message[] = await fetch(`${API_BASE}/inbox/${sel.contactId}`)
        .then(r => r.json()).catch(() => []);
      setMessages(msgs);
    }
  }, []);

  useEffect(() => {
    loadThreads(false);
    requestNotificationPermission();
  }, [loadThreads]);

  // Poll every 8s
  useEffect(() => {
    const id = setInterval(() => loadThreads(true), 8000);
    return () => clearInterval(id);
  }, [loadThreads]);

  const openThread = async (thread: Thread) => {
    setSelected(thread);
    setMobileView('thread');
    setReply('');
    if (thread.contactId) {
      const msgs = await fetch(`${API_BASE}/inbox/${thread.contactId}`).then(r => r.json());
      setMessages(msgs);
    } else {
      setMessages([thread.lastMessage]);
    }
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const sendReply = async () => {
    if (!reply.trim() || !selected?.contactId) return;
    setSending(true);
    const msg = await fetch(`${API_BASE}/inbox/${selected.contactId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: reply }),
    }).then(r => r.json());
    setMessages(prev => [...prev, msg]);
    setReply('');
    setSending(false);
    await loadThreads(true);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const enableNotifications = async () => {
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  };

  const displayName = (t: Thread) =>
    t.contact ? `${t.contact.firstName} ${t.contact.lastName}` : t.phone;

  return (
    <div className="flex h-[calc(100vh-49px)]">

      {/* ── Thread list ──────────────────────────────────── */}
      <div className={`${mobileView === 'thread' ? 'hidden md:flex' : 'flex'} w-full md:w-80 border-r border-gray-100 bg-white flex-col`}>
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] tracking-widest uppercase mb-1" style={{ color: 'rgba(154,122,46,0.7)' }}>SMS</div>
              <h2 className="text-lg font-serif font-light text-black tracking-wide">Inbox</h2>
            </div>
            {/* Notification bell */}
            {notifPermission === 'default' && (
              <button
                onClick={enableNotifications}
                title="Enable desktop notifications for new replies"
                className="text-[9px] tracking-widest uppercase px-2 py-1 rounded border transition-colors"
                style={{ borderColor: 'rgba(201,168,76,0.4)', color: '#9A7A2E' }}
              >
                🔔 Alerts
              </button>
            )}
            {notifPermission === 'granted' && (
              <span className="text-[9px] text-gray-300 tracking-widest uppercase flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                Alerts on
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-300 text-sm">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="p-8 text-center text-gray-300 text-sm">No messages yet</div>
          ) : threads.map((t, i) => (
            <div
              key={i}
              onClick={() => openThread(t)}
              className="px-5 py-4 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors"
              style={selected?.phone === t.phone ? { background: 'rgba(201,168,76,0.05)' } : {}}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-black text-sm">{displayName(t)}</span>
                {t.unread > 0 && (
                  <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5 text-white"
                        style={{ background: '#C9A84C' }}>
                    {t.unread}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-400 truncate">{t.lastMessage.body}</div>
              <div className="text-[9px] text-gray-300 mt-1">
                {new Date(t.lastMessage.sentAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Message thread ───────────────────────────────── */}
      <div className={`${mobileView === 'list' ? 'hidden md:flex' : 'flex'} flex-1 flex-col bg-gray-50`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl font-serif font-light text-gray-200 mb-2">Select a Conversation</div>
              <div className="text-gray-300 text-sm">Replies from your texts appear here</div>
              {notifPermission === 'default' && (
                <button onClick={enableNotifications} className="mt-6 btn-gold-outline px-5 py-2 text-xs">
                  🔔 Enable desktop alerts for new replies
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="px-4 md:px-6 py-4 bg-white border-b border-gray-100 flex items-center gap-3">
              <button
                onClick={() => setMobileView('list')}
                className="md:hidden text-gray-400 hover:text-black text-lg pr-1"
              >←</button>
              <div>
                <div className="font-medium text-black">{displayName(selected)}</div>
                <div className="text-xs font-mono mt-0.5" style={{ color: '#C9A84C' }}>{selected.phone}</div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-xs px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                      msg.direction === 'outbound'
                        ? 'text-white rounded-br-sm'
                        : 'bg-white border border-gray-100 text-black rounded-bl-sm'
                    }`}
                    style={msg.direction === 'outbound' ? { background: '#0A0A0A' } : {}}
                  >
                    {msg.body}
                    <div className={`text-[9px] mt-1.5 ${msg.direction === 'outbound' ? 'text-gray-400' : 'text-gray-300'}`}>
                      {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Reply box */}
            <div className="px-6 py-4 bg-white border-t border-gray-100">
              {!selected.contactId ? (
                <div className="text-xs text-gray-400 text-center py-2">
                  This contact isn't in your database — can't reply yet.
                </div>
              ) : (
                <div className="flex gap-3">
                  <textarea
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                    rows={2}
                    placeholder="Type a reply… (Enter to send, Shift+Enter for newline)"
                    className="field-input flex-1 resize-none"
                  />
                  <button
                    onClick={sendReply}
                    disabled={!reply.trim() || sending}
                    className="btn-gold px-5"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
