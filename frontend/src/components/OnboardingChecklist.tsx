import React, { useState, useEffect } from 'react';

interface Step {
  id: string;
  label: string;
  description: string;
  action?: string;
  actionPage?: string;
}

const STEPS: Step[] = [
  { id: 'contacts',  label: 'Import your contacts',     description: 'Upload a CSV of leads to start dialing.', action: 'Go to Contacts', actionPage: 'contacts' },
  { id: 'call',      label: 'Make your first call',     description: 'Open the dialer and call a lead.', action: 'Open Dialer', actionPage: 'dialer' },
  { id: 'sms',       label: 'Send an SMS blast',        description: 'Reach your list instantly with a text.', action: 'Go to SMS Blast', actionPage: 'blast' },
  { id: 'pipeline',  label: 'Review your pipeline',     description: 'See leads organized by stage.', action: 'Open Pipeline', actionPage: 'pipeline' },
  { id: 'billing',   label: 'Choose a plan',            description: 'Upgrade before your trial ends.', action: 'View Plans', actionPage: 'billing' },
];

interface Props {
  onNavigate: (page: string) => void;
}

export default function OnboardingChecklist({ onNavigate }: Props) {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('propel_onboarding') || '{}');
      setCompleted(saved.completed || {});
      setDismissed(saved.dismissed || false);
    } catch {}
  }, []);

  const save = (c: Record<string, boolean>, d: boolean) => {
    localStorage.setItem('propel_onboarding', JSON.stringify({ completed: c, dismissed: d }));
  };

  const toggle = (id: string) => {
    const next = { ...completed, [id]: !completed[id] };
    setCompleted(next);
    save(next, dismissed);
  };

  const dismiss = () => {
    setDismissed(true);
    save(completed, true);
  };

  const doneCount = Object.values(completed).filter(Boolean).length;
  const allDone = doneCount === STEPS.length;

  if (dismissed || allDone) return null;

  return (
    <div style={{
      background: '#fff',
      border: '1px solid rgba(201,168,76,0.25)',
      borderRadius: 12,
      padding: '20px 24px',
      margin: '16px 20px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1a1a1a', letterSpacing: '0.05em' }}>
            Getting Started — {doneCount}/{STEPS.length} complete
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Complete these steps to get the most out of Propel</div>
        </div>
        <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: '#f3f4f6', borderRadius: 4, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ height: '100%', background: 'linear-gradient(90deg, #C9A84C, #e8c96e)', borderRadius: 4, width: `${(doneCount / STEPS.length) * 100}%`, transition: 'width 0.4s' }} />
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STEPS.map(step => (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #f9fafb' }}>
            {/* Checkbox */}
            <button
              onClick={() => toggle(step.id)}
              style={{
                width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                border: completed[step.id] ? 'none' : '2px solid #d1d5db',
                background: completed[step.id] ? '#C9A84C' : 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {completed[step.id] && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>✓</span>}
            </button>

            {/* Text */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: completed[step.id] ? '#9ca3af' : '#1a1a1a', textDecoration: completed[step.id] ? 'line-through' : 'none' }}>
                {step.label}
              </div>
              {!completed[step.id] && (
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{step.description}</div>
              )}
            </div>

            {/* Action */}
            {!completed[step.id] && step.action && (
              <button
                onClick={() => { onNavigate(step.actionPage!); toggle(step.id); }}
                style={{
                  background: 'none', border: '1px solid #C9A84C', borderRadius: 6,
                  color: '#C9A84C', fontSize: 11, fontWeight: 600, padding: '4px 10px',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {step.action} →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
