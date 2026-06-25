import React from 'react';
import type { Disposition, DispositionType } from '../types';

const DISPOSITIONS: Disposition[] = [
  { type: 'not-home',          label: 'Not Home',       color: '', emoji: '', description: 'No answer / hung up' },
  { type: 'left-voicemail',    label: 'Voicemail',      color: '', emoji: '', description: 'Left a voicemail' },
  { type: 'callback-scheduled',label: 'Callback',       color: '', emoji: '', description: 'Set a callback time' },
  { type: 'not-interested',    label: 'Not Interested', color: '', emoji: '', description: 'Prospect declined' },
  { type: 'wrong-number',      label: 'Wrong Number',   color: '', emoji: '', description: 'Invalid contact' },
  { type: 'dnc',               label: 'Do Not Call',    color: '', emoji: '', description: 'Add to DNC list' },
  { type: 'hot-lead',          label: 'Hot Lead',       color: 'gold', emoji: '', description: 'Interested — pipeline' },
];

interface DispositionPanelProps {
  onDisposition: (type: DispositionType) => void;
  disabled?: boolean;
}

export default function DispositionPanel({ onDisposition, disabled = false }: DispositionPanelProps) {
  return (
    <div className="card h-full flex flex-col" style={{ border: '1px solid rgba(201,168,76,0.2)' }}>
      <h3 className="field-label mb-4">Log Outcome</h3>
      <div className="flex flex-col gap-2 flex-1">
        {DISPOSITIONS.map(d => (
          <button
            key={d.type}
            onClick={() => onDisposition(d.type)}
            disabled={disabled}
            title={d.description}
            className={`w-full text-left text-[10px] font-semibold tracking-widest uppercase px-3 py-2.5 rounded
              transition-all duration-150 disabled:opacity-25 disabled:cursor-not-allowed
              ${d.type === 'hot-lead'
                ? 'text-black border border-yellow-600/60 hover:border-yellow-600'
                : d.type === 'dnc'
                ? 'border border-red-200 text-red-500 hover:bg-red-50'
                : 'border border-gray-200 text-gray-600 hover:border-yellow-600/50 hover:text-black'
              }`}
            style={d.type === 'hot-lead' ? { background: 'rgba(201,168,76,0.12)' } : {}}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export { DISPOSITIONS };
