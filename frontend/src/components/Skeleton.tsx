import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 4, className = '', style }: SkeletonProps) {
  return (
    <div
      className={className}
      style={{
        width, height, borderRadius, ...style,
        background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.4s ease infinite',
      }}
    />
  );
}

// Inject keyframes once
if (typeof document !== 'undefined' && !document.getElementById('skeleton-style')) {
  const style = document.createElement('style');
  style.id = 'skeleton-style';
  style.textContent = `
    @keyframes skeleton-shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `;
  document.head.appendChild(style);
}

// ── Pre-built skeleton layouts ─────────────────────────────────────────────────

export function ContactRowSkeleton() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #f3f3f3' }}>
      <Skeleton width={32} height={32} borderRadius="50%" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width="40%" height={12} />
        <Skeleton width="25%" height={10} />
      </div>
      <Skeleton width={52} height={20} borderRadius={10} />
    </div>
  );
}

export function ContactListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => <ContactRowSkeleton key={i} />)}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div style={{ padding: '16px 20px', border: '1px solid #f0f0f0', borderRadius: 8, background: '#fff' }}>
      <Skeleton width="50%" height={10} style={{ marginBottom: 10 }} />
      <Skeleton width="35%" height={28} />
    </div>
  );
}

export function CallLogSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
          <Skeleton width={60} height={10} />
          <Skeleton width="30%" height={12} />
          <Skeleton width={80} height={10} />
          <Skeleton width={70} height={22} borderRadius={4} />
        </div>
      ))}
    </div>
  );
}

export function CalendarSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
      {Array.from({ length: 35 }).map((_, i) => (
        <Skeleton key={i} height={80} borderRadius={6} />
      ))}
    </div>
  );
}

export function InboxSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ padding: '12px 16px', borderBottom: '1px solid #f3f3f3' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <Skeleton width="35%" height={12} />
            <Skeleton width={50} height={10} />
          </div>
          <Skeleton width="80%" height={10} />
        </div>
      ))}
    </div>
  );
}
