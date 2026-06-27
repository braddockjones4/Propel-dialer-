// Central config — swap API_BASE for production via VITE_API_URL env var
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

// Authenticated fetch — automatically attaches the JWT token
export function authFetch(path: string, opts?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('propel_token');
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers || {}),
    },
  });
}
