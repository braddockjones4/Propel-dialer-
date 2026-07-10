import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';

interface Props {
  onBack?: () => void;
}

export default function Login({ onBack }: Props) {
  const { login, register } = useAuth();
  const [mode,     setMode]     = useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [resetToken, setResetToken] = useState('');

  // Check for reset token in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if (token) { setResetToken(token); setMode('reset'); }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);

    if (mode === 'forgot') {
      try {
        await fetch(`${API_BASE}/auth/forgot-password`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        setSuccess('Check your email for a password reset link.');
      } catch { setError('Something went wrong. Try again.'); }
      setLoading(false); return;
    }

    if (mode === 'reset') {
      try {
        const r = await fetch(`${API_BASE}/auth/reset-password`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken, password }),
        }).then(r => r.json());
        if (r.error) { setError(r.error); setLoading(false); return; }
        setSuccess('Password reset! Signing you in…');
        setTimeout(() => { window.location.href = window.location.pathname; }, 1500);
      } catch { setError('Something went wrong. Try again.'); }
      setLoading(false); return;
    }

    const err = mode === 'login'
      ? await login(email, password)
      : await register(email, password, name);
    setLoading(false);
    if (err) setError(err);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      background: '#fafafa', overflowY: 'auto', padding: '24px 16px',
    }}>
      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 400,
        background: '#fff', borderRadius: 12,
        boxShadow: '0 8px 40px rgba(0,0,0,0.08)',
        border: '1px solid rgba(201,168,76,0.15)',
        overflow: 'hidden',
      }}>
        {/* Gold top bar */}
        <div style={{ height: 3, background: 'linear-gradient(90deg, #C9A84C, #e8c96e, #C9A84C)' }} />

        <div style={{ padding: '40px 36px' }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 24, fontWeight: 300, letterSpacing: '0.2em', color: '#1a1a1a' }}>
              Propel Dialer
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', letterSpacing: '0.15em', marginTop: 4, textTransform: 'uppercase' }}>
              Real Estate AI
            </div>
          </div>

          {/* Mode toggle — hide on forgot/reset */}
          {(mode === 'login' || mode === 'register') && (
            <div style={{ display: 'flex', borderRadius: 8, border: '1px solid #e5e7eb', overflow: 'hidden', marginBottom: 24 }}>
              {(['login', 'register'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(''); setSuccess(''); }}
                  style={{
                    flex: 1, padding: '8px 0',
                    fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                    background: mode === m ? '#1a1a1a' : 'transparent',
                    color:      mode === m ? '#fff'    : '#9ca3af',
                    border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                  }}
                >
                  {m === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>
          )}

          {/* Forgot / Reset headings */}
          {mode === 'forgot' && <p style={{ fontWeight: 600, marginBottom: 16, color: '#1a1a1a' }}>Reset your password</p>}
          {mode === 'reset'  && <p style={{ fontWeight: 600, marginBottom: 16, color: '#1a1a1a' }}>Choose a new password</p>}

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'register' && (
              <div>
                <label style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b7280', display: 'block', marginBottom: 4 }}>Full Name</label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Braddock Jones"
                  required={mode === 'register'}
                  style={inputStyle}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b7280', display: 'block', marginBottom: 4 }}>Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={inputStyle}
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6b7280' }}>Password</label>
                  {mode === 'login' && (
                    <button type="button" onClick={() => { setMode('forgot'); setError(''); setSuccess(''); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#C9A84C' }}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={inputStyle}
                />
              </div>
            )}

            {success && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#16a34a' }}>
                {success}
              </div>
            )}

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#dc2626' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              onTouchEnd={e => { e.preventDefault(); if (!loading) submit(e as any); }}
              style={{
                marginTop: 6,
                background: loading ? '#e5e7eb' : '#1a1a1a',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '12px 0',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 16px' }}>
            <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
            <span style={{ fontSize: 10, color: '#d1d5db', letterSpacing: '0.05em' }}>OR</span>
            <div style={{ flex: 1, height: 1, background: '#f0f0f0' }} />
          </div>

          {(mode === 'login' || mode === 'register') && (
            <p style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af' }}>
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setSuccess(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9A84C', fontWeight: 600, fontSize: 11 }}
              >
                {mode === 'login' ? 'Create one →' : 'Sign in →'}
              </button>
            </p>
          )}
          {(mode === 'forgot' || mode === 'reset') && (
            <p style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af' }}>
              <button onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9A84C', fontWeight: 600, fontSize: 11 }}>
                ← Back to sign in
              </button>
            </p>
          )}

          {onBack && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#d1d5db', letterSpacing: '0.05em' }}>
                ← Back to home
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  fontSize: 13,
  color: '#1a1a1a',
  outline: 'none',
  background: '#fafafa',
  transition: 'border-color 0.2s',
};
