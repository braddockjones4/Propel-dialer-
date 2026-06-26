import React from 'react';
import type { Disposition, DispositionType } from '../types';

const DISPOSITIONS: (Disposition & { emoji: string; bg: string; border: string; textColor: string; hint: string })[] = [
  {
    type: 'not-home',
    label: 'No Answer',
    emoji: '📵',
    color: '',
    description: 'No answer / hung up',
    hint: 'Ring, no pickup',
    bg: 'rgba(107,114,128,0.06)',
    border: 'rgba(107,114,128,0.2)',
    textColor: '#6b7280',
  },
  {
    type: 'left-voicemail',
    label: 'Left Voicemail',
    emoji: '📬',
    color: '',
    description: 'Left a voicemail',
    hint: 'Message left',
    bg: 'rgba(59,130,246,0.06)',
    border: 'rgba(59,130,246,0.25)',
    textColor: '#3b82f6',
  },
  {
    type: 'callback-scheduled',
    label: 'Callback',
    emoji: '📅',
    color: '',
    description: 'Set a callback time',
    hint: 'Call back later',
    bg: 'rgba(139,92,246,0.06)',
    border: 'rgba(139,92,246,0.25)',
    textColor: '#7c3aed',
  },
  {
    type: 'not-interested',
    label: 'Not Interested',
    emoji: '👎',
    color: '',
    description: 'Prospect declined',
    hint: 'Politely declined',
    bg: 'rgba(107,114,128,0.06)',
    border: 'rgba(107,114,128,0.18)',
    textColor: '#9ca3af',
  },
  {
    type: 'wrong-number',
    label: 'Wrong Number',
    emoji: '🔢',
    color: '',
    description: 'Invalid contact',
    hint: 'Bad phone number',
    bg: 'rgba(107,114,128,0.06)',
    border: 'rgba(107,114,128,0.18)',
    textColor: '#9ca3af',
  },
  {
    type: 'dnc',
    label: 'Do Not Call',
    emoji: '🚫',
    color: '',
    description: 'Add to DNC list',
    hint: 'Remove permanently',
    bg: 'rgba(239,68,68,0.06)',
    border: 'rgba(239,68,68,0.25)',
    textColor: '#ef4444',
  },
  {
    type: 'hot-lead',
    label: 'Hot Lead',
    emoji: '🔥',
    color: 'gold',
    description: 'Interested — pipeline',
    hint: 'Ready to list / buy',
    bg: 'rgba(201,168,76,0.12)',
    border: 'rgba(201,168,76,0.5)',
    textColor: '#9A7A2E',
  },
];

interface DispositionPanelProps {
  onDisposition: (type: DispositionType) => void;
  disabled?: boolean;
}

export default function DispositionPanel({ onDisposition, disabled = false }: DispositionPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 5 }}>
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#9ca3af',
        marginBottom: 4,
      }}>
        How did it go?
      </div>

      {DISPOSITIONS.map(d => (
        <button
          key={d.type}
          onClick={() => onDisposition(d.type)}
          disabled={disabled}
          title={d.description}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            borderRadius: 7,
            border: `1px solid ${disabled ? 'rgba(0,0,0,0.07)' : d.border}`,
            background: disabled ? 'rgba(0,0,0,0.02)' : d.bg,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.3 : 1,
            transition: 'all 0.15s',
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }}>{d.emoji}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: disabled ? '#ccc' : d.textColor,
              lineHeight: 1.2,
            }}>
              {d.label}
            </div>
            <div style={{
              fontSize: 9,
              color: disabled ? '#ddd' : 'rgba(0,0,0,0.32)',
              marginTop: 1,
            }}>
              {d.hint}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export { DISPOSITIONS };
