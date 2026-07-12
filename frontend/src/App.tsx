import React, { useState, useEffect, Component } from 'react';

class ErrorBoundary extends Component<{children: React.ReactNode}, {error: string | null}> {
  constructor(props: any) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e: any) { return { error: e?.message || String(e) }; }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 13, background: '#fff', color: '#c00', minHeight: '100vh' }}>
        <strong>Error:</strong> {this.state.error}
        <br /><br />
        <button onClick={() => { localStorage.clear(); window.location.reload(); }}
          style={{ padding: '8px 16px', background: '#000', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          Clear &amp; Reload
        </button>
      </div>
    );
    return this.props.children;
  }
}
import { ToastProvider } from './components/Toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import Landing from './components/Landing';
import NotificationBell from './components/NotificationBell';
import Dialer from './components/Dialer';
import Contacts from './components/Contacts';
import Analytics from './components/Analytics';
import Settings from './components/Settings';
import Pipeline from './components/Pipeline';
import Appointments from './components/Appointments';
import Voicemails from './components/Voicemails';
import Dashboard from './components/Dashboard';
import AgentChat from './components/AgentChat';
import EmailBlast from './components/EmailBlast';
import Inbox from './components/Inbox';

type Page = 'dashboard' | 'dialer' | 'contacts' | 'pipeline' | 'voicemails' | 'appointments' | 'analytics' | 'agent' | 'email' | 'inbox' | 'settings';

const NAV: { id: Page; label: string }[] = [
  { id: 'dashboard',    label: 'Home'        },
  { id: 'dialer',       label: 'Dialer'      },
  { id: 'voicemails',   label: 'Voicemails'  },
  { id: 'email',        label: 'Email Blast' },
  { id: 'inbox',        label: 'Inbox'       },
  { id: 'contacts',     label: 'Contacts'    },
  { id: 'agent',        label: 'AI Agent'    },
  { id: 'pipeline',     label: 'Pipeline'    },
  { id: 'appointments', label: 'Calendar'    },
  { id: 'analytics',    label: 'Analytics'   },
  { id: 'settings',     label: 'Settings'    },
];

// ── Inner app (has auth context) ─────────────────────────────────────────────
function AppInner() {
  const { user, loading, logout } = useAuth();
  const [page, setPage]             = useState<Page>('dashboard');

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showLogin, setShowLogin]   = useState(false);
  const [sharedVcfText, setSharedVcfText] = useState<string | undefined>(undefined);

  // PWA Web Share Target — detect when a .vcf was shared to the app
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Google Contacts import result
    const googleImported = params.get('googleContactsImported');
    const googleError    = params.get('googleContactsError');
    if (googleImported !== null || googleError !== null) {
      window.history.replaceState({}, '', window.location.pathname);
      if (googleImported !== null) {
        const skipped = params.get('googleContactsSkipped') || '0';
        alert(`✓ Google Contacts imported!\n\n${googleImported} contacts added.${parseInt(skipped) > 0 ? `\n${skipped} duplicates skipped.` : ''}`);
        setPage('contacts');
      } else {
        alert('Google Contacts import was cancelled or failed. Please try again.');
      }
    }

    if (params.get('vcf-shared') === '1') {
      // Remove the param from the URL without a page reload
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
      // Fetch the file the service worker stored
      fetch('/shared-vcf-file')
        .then(r => r.ok ? r.text() : Promise.reject('no file'))
        .then(text => {
          setSharedVcfText(text);
          setPage('contacts');
        })
        .catch(() => {
          // If fetch fails just navigate to contacts so user can import manually
          setPage('contacts');
        });
    }
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0A0A0A', gap: 20 }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: '#111', border: '1px solid rgba(201,168,76,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
          <svg width="28" height="38" viewBox="0 0 52 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="bolt-load" x1="26" y1="4" x2="26" y2="68" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#E8C96A"/>
                <stop offset="100%" stopColor="#8A6020"/>
              </linearGradient>
            </defs>
            <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="url(#bolt-load)"/>
          </svg>
        </div>
        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 18, fontWeight: 300, letterSpacing: '0.3em', color: '#C9A84C' }}>
          Real Estate AI
        </div>
      </div>
    );
  }

  if (!user) {
    if (showLogin) return <Login onBack={() => setShowLogin(false)} />;
    return <Landing onSignIn={() => setShowLogin(true)} />;
  }

  return (
    <>
      {/* ── Desktop nav ─────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b hidden md:flex items-center px-6"
           style={{ borderBottomColor: 'rgba(201,168,76,0.2)', height: 49 }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 28, cursor: 'pointer' }} onClick={() => setPage('dialer')}>
          <svg width="16" height="22" viewBox="0 0 52 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="bolt-nav-app" x1="26" y1="4" x2="26" y2="68" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#E8C96A"/>
                <stop offset="100%" stopColor="#9A7A2E"/>
              </linearGradient>
            </defs>
            <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="url(#bolt-nav-app)"/>
          </svg>
          <span className="font-serif font-light text-xl text-black" style={{ letterSpacing: '0.2em' }}>Propel Dialer</span>
        </div>

        <div className="w-px h-4 mr-6" style={{ background: 'rgba(201,168,76,0.3)' }} />

        <div className="flex items-center overflow-x-auto hide-scrollbar flex-1">
          {NAV.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className="relative whitespace-nowrap transition-all duration-200"
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                margin: '0 1px',
                background: page === id ? 'rgba(201,168,76,0.1)' : 'transparent',
                border: page === id ? '1px solid rgba(201,168,76,0.25)' : '1px solid transparent',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: page === id ? 700 : 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: page === id ? '#9A7A2E' : '#9ca3af',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Right side: plan badge + user */}
        <div className="flex items-center gap-3 pl-4 flex-shrink-0">


          <NotificationBell onNavigate={(p) => setPage(p as any)} />

          <div style={{ fontSize: 10, color: '#9ca3af', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.name || user.email}
          </div>

          <button
            onClick={logout}
            style={{ fontSize: 9, color: '#d1d5db', letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* ── Mobile nav ──────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b flex md:hidden items-center justify-between px-4"
           style={{ borderBottomColor: 'rgba(201,168,76,0.2)', height: 49 }}>
        <button onClick={() => setPage('dialer')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <svg width="13" height="18" viewBox="0 0 52 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="bolt-mob" x1="26" y1="4" x2="26" y2="68" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#E8C96A"/>
                <stop offset="100%" stopColor="#9A7A2E"/>
              </linearGradient>
            </defs>
            <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="url(#bolt-mob)"/>
          </svg>
          <span className="text-sm font-semibold text-gray-800" style={{ letterSpacing: '0.03em' }}>
            {NAV.find(n => n.id === page)?.label || 'Propel'}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <NotificationBell onNavigate={(p) => setPage(p as any)} />
          <button onClick={() => setMobileNavOpen(o => !o)}
            style={{ padding: '6px 8px', borderRadius: 7, border: '1px solid #e5e7eb', background: mobileNavOpen ? '#f9f9f9' : 'transparent', color: '#374151', fontSize: 15, lineHeight: 1, cursor: 'pointer' }}>
            {mobileNavOpen ? '✕' : '☰'}
          </button>
        </div>
      </nav>

      {/* Mobile slide-down menu */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden" style={{ top: 49 }}>
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute top-0 left-0 right-0 bg-white shadow-xl overflow-y-auto" style={{ maxHeight: '80vh' }}>
            {/* User row */}
            <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: '#f3f4f6', background: '#fafafa' }}>
              <div className="text-xs font-semibold text-gray-700 truncate" style={{ maxWidth: 200 }}>{user.name || user.email}</div>
              <button onClick={logout} style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.05em' }}>
                Sign out
              </button>
            </div>
            {NAV.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => { setPage(id); setMobileNavOpen(false); }}
                className="w-full flex items-center gap-3 px-5 border-b text-sm font-medium"
                style={{
                  height: 48,
                  borderBottomColor: '#f5f5f5',
                  background: page === id ? 'rgba(201,168,76,0.07)' : 'transparent',
                  color: page === id ? '#9A7A2E' : '#374151',
                }}
              >
                <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                {page === id && <span style={{ color: '#C9A84C', fontSize: 8 }}>●</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Mobile bottom tab bar — scrollable ──────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t hide-scrollbar"
           style={{ borderTopColor: 'rgba(201,168,76,0.15)', paddingBottom: 'env(safe-area-inset-bottom)', display: 'flex', overflowX: 'auto' }}>
        {NAV.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            style={{ height: 56, flexShrink: 0, minWidth: 64, padding: '0 10px', position: 'relative', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
          >
            {page === id && (
              <span style={{
                position: 'absolute', top: 0, left: '10%', right: '10%',
                height: 2, borderRadius: '0 0 3px 3px', background: 'linear-gradient(90deg, #C9A84C, #e8c96e)',
              }} />
            )}
            <span style={{
              fontSize: 9.5, fontWeight: page === id ? 700 : 500,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              color: page === id ? '#9A7A2E' : '#bbb',
              transition: 'color 0.15s', whiteSpace: 'nowrap',
            }}>{label}</span>
          </button>
        ))}
      </div>

      {/* ── Page content ─────────────────────────────────────────────── */}
      <div className="pt-[49px]" id="page-content">
        {page === 'dashboard'    && <Dashboard onNavigate={(p) => setPage(p as Page)} />}
        {page === 'dialer'       && <Dialer />}
        {page === 'contacts'     && <Contacts onNavigate={(p) => setPage(p as Page)} sharedVcfText={sharedVcfText} />}
        {page === 'voicemails'   && <Voicemails />}
        {page === 'pipeline'     && <Pipeline />}
        {page === 'appointments' && <Appointments />}
        {page === 'analytics'    && <Analytics />}
        {page === 'agent'        && <AgentChat />}
        {page === 'email'        && <EmailBlast />}
        {page === 'inbox'        && <Inbox />}
        {page === 'settings'     && <Settings />}
      </div>

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        /* Mobile: reserve space for bottom tab bar + safe area */
        @media (max-width: 767px) {
          #page-content { padding-bottom: calc(56px + env(safe-area-inset-bottom)); }
          /* Pages that want to fill exactly the visible viewport (no scroll) */
          .full-page-h { height: calc(100dvh - 49px - 56px - env(safe-area-inset-bottom)) !important; }
        }
        @media (min-width: 768px) {
          .full-page-h { height: calc(100vh - 49px) !important; }
        }
      `}</style>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
