import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '../config';

interface Notification {
  id: string;
  contactName: string;
  body: string;
  sentAt: string;
  contactId?: string;
  read: boolean;
}

interface Props {
  onNavigate?: (page: string) => void;
}

export default function NotificationBell({ onNavigate }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen]                   = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const panelRef  = useRef<HTMLDivElement>(null);

  const unread = notifications.filter(n => !n.read).length;

  useEffect(() => {
    // Connect to socket
    socketRef.current = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

    socketRef.current.on('new-sms', (data: any) => {
      const notif: Notification = {
        id:          data.id,
        contactName: data.contactName,
        body:        data.body,
        sentAt:      data.sentAt,
        contactId:   data.contactId,
        read:        false,
      };
      setNotifications(prev => [notif, ...prev].slice(0, 50));

      // Browser notification (if permission granted)
      if (Notification.permission === 'granted') {
        new Notification(`📱 ${data.contactName}`, {
          body: data.body,
          icon: '/icon-192.png',
          tag:  data.id,
        });
      }
    });

    // Request browser notification permission
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => { socketRef.current?.disconnect(); };
  }, []);

  // Close panel when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  const handleClick = (n: Notification) => {
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    setOpen(false);
    if (n.contactId && onNavigate) onNavigate('inbox');
  };

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => { setOpen(o => !o); if (!open && unread > 0) markAllRead(); }}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: '4px 6px', borderRadius: 6,
          color: unread > 0 ? '#C9A84C' : '#9ca3af',
          transition: 'color 0.2s',
        }}
        title="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 700,
            width: 16, height: 16, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #fff',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0,
          width: 320, background: '#fff',
          border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          zIndex: 9999, overflow: 'hidden',
          marginTop: 6,
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #f3f4f6' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#374151' }}>
              Notifications
            </span>
            {notifications.length > 0 && (
              <button onClick={markAllRead} style={{ fontSize: 10, color: '#C9A84C', background: 'none', border: 'none', cursor: 'pointer' }}>
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>🔔</div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>No notifications yet</div>
                <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 4 }}>Inbound texts will appear here in real time</div>
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    display: 'flex', gap: 10, padding: '10px 16px',
                    borderBottom: '1px solid #f9fafb',
                    background: n.read ? 'transparent' : 'rgba(201,168,76,0.05)',
                    cursor: 'pointer', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                  onMouseLeave={e => (e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(201,168,76,0.05)')}
                >
                  {/* Unread dot */}
                  <div style={{ paddingTop: 4, flexShrink: 0 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: n.read ? 'transparent' : '#C9A84C' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 2 }}>
                      💬 {n.contactName}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {n.body}
                    </div>
                    <div style={{ fontSize: 10, color: '#d1d5db', marginTop: 3 }}>
                      {new Date(n.sentAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
