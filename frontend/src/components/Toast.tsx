import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error:   '✕',
  info:    'i',
  warning: '!',
};

const COLORS: Record<ToastType, { bar: string; icon: string; bg: string }> = {
  success: { bar: '#22c55e', icon: '#22c55e', bg: '#f0fdf4' },
  error:   { bar: '#ef4444', icon: '#ef4444', bg: '#fef2f2' },
  info:    { bar: '#C9A84C', icon: '#C9A84C', bg: '#fffbeb' },
  warning: { bar: '#f59e0b', icon: '#f59e0b', bg: '#fffbeb' },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const c = COLORS[toast.type];

  useEffect(() => {
    // mount → fade in
    requestAnimationFrame(() => setVisible(true));
    // auto-dismiss after 3.5s
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onRemove(toast.id), 300);
    }, 3500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.08)',
        borderLeft: `3px solid ${c.bar}`,
        borderRadius: 6,
        padding: '10px 14px',
        minWidth: 260,
        maxWidth: 380,
        boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
        transform: visible ? 'translateX(0)' : 'translateX(110%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.28s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease',
        cursor: 'pointer',
      }}
      onClick={() => { setVisible(false); setTimeout(() => onRemove(toast.id), 300); }}
    >
      {/* Icon circle */}
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: c.bg, color: c.icon,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700,
      }}>
        {ICONS[toast.type]}
      </div>
      <span style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.4, flex: 1 }}>
        {toast.message}
      </span>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const add = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const value: ToastContextValue = {
    toast:   add,
    success: (m) => add(m, 'success'),
    error:   (m) => add(m, 'error'),
    info:    (m) => add(m, 'info'),
    warn:    (m) => add(m, 'warning'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24,
        display: 'flex', flexDirection: 'column', gap: 10,
        zIndex: 9999, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onRemove={remove} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
