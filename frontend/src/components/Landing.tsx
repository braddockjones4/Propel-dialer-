import React, { useState } from 'react';

interface Props { onSignIn: () => void }

const GOLD     = '#C9A84C';
const GOLDDARK = '#9A7A2E';
const BLACK    = '#0A0A0A';

export default function Landing({ onSignIn }: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: BLACK, minHeight: '100vh', display: 'flex', flexDirection: 'column', WebkitFontSmoothing: 'antialiased' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Inter:wght@300;400;500;600&display=swap');
        .serif { font-family: 'Cormorant Garamond', serif !important; }
      `}</style>

      {/* Background image */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
        <img
          src="https://images.unsplash.com/photo-1762979790868-3bf9153b84cc?auto=format&fit=crop&w=1600&q=80"
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', opacity: 0.22 }}
        />
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px' }}>

        {/* Logo */}
        <div style={{ marginBottom: 48, textAlign: 'center' }}>
          <div className="serif" style={{ fontSize: 13, fontWeight: 300, letterSpacing: '0.6em', color: GOLD, textTransform: 'uppercase', marginBottom: 10 }}>
            Real Estate AI
          </div>
          <div style={{ width: 40, height: 1, background: 'rgba(201,168,76,0.3)', margin: '0 auto' }} />
        </div>

        {/* Headline */}
        <h1 className="serif" style={{ fontSize: 'clamp(38px, 6vw, 72px)', fontWeight: 300, color: '#fff', lineHeight: 1.05, letterSpacing: '0.01em', textAlign: 'center', margin: '0 0 24px', maxWidth: 600 }}>
          Your pipeline.<br />
          <em style={{ fontStyle: 'italic', color: GOLD }}>Always working.</em>
        </h1>

        <p style={{ fontSize: 15, fontWeight: 300, color: 'rgba(255,255,255,0.4)', textAlign: 'center', maxWidth: 360, lineHeight: 1.85, margin: '0 0 52px' }}>
          Power dialing, AI-generated scripts, automatic voicemail drop, and a full contact management system — built for real estate.
        </p>

        {/* Login button */}
        <button
          onClick={onSignIn}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            padding: '16px 48px',
            background: hovered ? GOLDDARK : GOLD,
            color: '#fff',
            border: 'none',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
        >
          Sign In
        </button>
      </div>

      {/* Footer */}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '20px 24px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', letterSpacing: '0.08em', marginBottom: 8 }}>
          Built by Compass Solutions &nbsp;·&nbsp; © 2026
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20 }}>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: 'rgba(201,168,76,0.4)', letterSpacing: '0.08em', textDecoration: 'none' }}>
            Terms of Service
          </a>
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: 'rgba(201,168,76,0.4)', letterSpacing: '0.08em', textDecoration: 'none' }}>
            Privacy Policy
          </a>
          <a href="/tcpa.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: 'rgba(201,168,76,0.4)', letterSpacing: '0.08em', textDecoration: 'none' }}>
            TCPA Policy
          </a>
        </div>
      </div>
    </div>
  );
}
