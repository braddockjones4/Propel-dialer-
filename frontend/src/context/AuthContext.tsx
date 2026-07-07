import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../config';


interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
  stripeCustomerId?: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login:    (email: string, password: string) => Promise<string | null>;
  register: (email: string, password: string, name: string) => Promise<string | null>;
  logout:   () => void;
  refresh:  () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [token,   setToken]   = useState<string | null>(() => localStorage.getItem('propel_token'));
  const [loading, setLoading] = useState(true);

  const apiFetch = useCallback(async (path: string, opts?: RequestInit) => {
    const t = localStorage.getItem('propel_token');
    return fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(opts?.headers || {}) },
    });
  }, []);

  const refresh = useCallback(async () => {
    const t = localStorage.getItem('propel_token');
    if (!t) { setLoading(false); return; }
    try {
      const r = await apiFetch('/auth/me');
      if (r.ok) {
        const u = await r.json();
        setUser(u);
      } else {
        localStorage.removeItem('propel_token');
        setToken(null);
        setUser(null);
      }
    } catch { /* backend offline — keep token, will retry */ }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('demo')) {
      // Auto-login as the shared demo account
      fetch(`${API_BASE}/auth/demo`)
        .then(r => r.json())
        .then(data => {
          if (data.token) {
            localStorage.setItem('propel_token', data.token);
            setToken(data.token);
            setUser(data.user);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      refresh();
    }
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const r = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json();
      if (!r.ok) return data.error || 'Login failed';
      localStorage.setItem('propel_token', data.token);
      setToken(data.token);
      setUser(data.user);
      return null;
    } catch {
      return 'Cannot connect to server';
    }
  }, []);

  const register = useCallback(async (email: string, password: string, name: string): Promise<string | null> => {
    try {
      const r = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await r.json();
      if (!r.ok) return data.error || 'Registration failed';
      localStorage.setItem('propel_token', data.token);
      setToken(data.token);
      setUser(data.user);
      return null;
    } catch {
      return 'Cannot connect to server';
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('propel_token');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
