import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { API_BASE, authFetch } from '../config';


interface Plan {
  id: string;
  name: string;
  price: number;
  priceId: string;
  features: string[];
  callsPerDay: number;
  badge?: string;
}

const PLAN_ORDER = ['starter', 'pro', 'elite'];

export default function Billing() {
  const { user, token } = useAuth();
  const toast = useToast();
  const [plans,    setPlans]    = useState<Plan[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [checking, setChecking] = useState<string | null>(null);

  useEffect(() => {
    authFetch(`${API_BASE}/billing/plans`)
      .then(r => r.json())
      .then(data => { setPlans(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const subscribe = async (planId: string) => {
    if (!token) { toast.error('Please sign in first'); return; }
    setChecking(planId);
    try {
      const r = await authFetch(`${API_BASE}/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId }),
      });
      const data = await r.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Could not start checkout');
      }
    } catch {
      toast.error('Cannot connect to server');
    }
    setChecking(null);
  };

  const openPortal = async () => {
    if (!token) return;
    try {
      const r = await authFetch(`${API_BASE}/billing/portal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.url) window.location.href = data.url;
      else toast.error(data.error || 'Could not open portal');
    } catch {
      toast.error('Cannot connect to server');
    }
  };

  const currentPlan = user?.plan || 'trial';

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: 32, fontWeight: 300, letterSpacing: '0.15em', color: '#1a1a1a', marginBottom: 8 }}>
          Choose Your Plan
        </div>
        <p style={{ fontSize: 14, color: '#6b7280' }}>
          {currentPlan !== 'trial'
            ? `You're on the ${currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} plan.`
            : 'Start your 7-day free trial. No credit card required.'}
        </p>
        {currentPlan !== 'trial' && user?.stripeCustomerId && (
          <button
            onClick={openPortal}
            style={{ marginTop: 10, background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 16px', fontSize: 12, color: '#6b7280', cursor: 'pointer' }}
          >
            Manage subscription →
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading plans…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
          {plans.sort((a, b) => PLAN_ORDER.indexOf(a.id) - PLAN_ORDER.indexOf(b.id)).map(plan => {
            const isCurrentPlan = currentPlan === plan.id;
            const isPro = plan.id === 'pro';

            return (
              <div
                key={plan.id}
                style={{
                  border: isPro ? '2px solid #C9A84C' : '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: '28px 24px',
                  background: '#fff',
                  position: 'relative',
                  boxShadow: isPro ? '0 4px 24px rgba(201,168,76,0.12)' : '0 1px 4px rgba(0,0,0,0.04)',
                }}
              >
                {plan.badge && (
                  <div style={{
                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                    background: '#C9A84C', color: '#fff',
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase',
                    padding: '3px 12px', borderRadius: 20,
                  }}>
                    {plan.badge}
                  </div>
                )}

                <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#374151' }}>
                  {plan.name}
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                  <span style={{ fontSize: 36, fontWeight: 300, color: '#1a1a1a' }}>${plan.price}</span>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>/month</span>
                </div>

                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 20 }}>
                  {plan.callsPerDay === -1 ? 'Unlimited calls/day' : `${plan.callsPerDay} calls/day`}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                  {plan.features.map(f => (
                    <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#374151' }}>
                      <span style={{ color: '#C9A84C', flexShrink: 0, marginTop: 1 }}>✓</span>
                      {f}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => !isCurrentPlan && subscribe(plan.id)}
                  disabled={isCurrentPlan || checking === plan.id}
                  style={{
                    width: '100%',
                    padding: '11px 0',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    cursor: isCurrentPlan ? 'default' : 'pointer',
                    border: isPro ? 'none' : '1px solid #e5e7eb',
                    background: isCurrentPlan
                      ? '#f3f4f6'
                      : isPro
                        ? '#1a1a1a'
                        : 'transparent',
                    color: isCurrentPlan ? '#9ca3af' : isPro ? '#fff' : '#374151',
                    transition: 'all 0.2s',
                  }}
                >
                  {checking === plan.id
                    ? 'Redirecting…'
                    : isCurrentPlan
                      ? 'Current Plan ✓'
                      : `Get ${plan.name} →`}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ textAlign: 'center', fontSize: 11, color: '#d1d5db', marginTop: 32 }}>
        All plans include a 7-day free trial · Cancel anytime · Powered by Stripe
      </p>
    </div>
  );
}
