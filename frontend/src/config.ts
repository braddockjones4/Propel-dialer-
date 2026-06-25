// Central config — swap API_BASE for production via VITE_API_URL env var
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';
