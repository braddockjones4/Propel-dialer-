import React, { useEffect, useState } from 'react';
import { API_BASE } from '../config';


interface NextAction {
  action: string;
  label: string;
  message?: string;
  scheduleIn?: number;
  reasoning: string;
  urgency: 'high' | 'medium' | 'low';
}

interface Props {
  contactId: string;
  onBook?: () => void;
}

const URGENCY_COLOR: Record<string, string> = {
  high:   '#ef4444',
  medium: '#C9A84C',
  low:    '#9ca3af',
};

const ACTION_ICON: Record<string, string> = {
  'call-back':         '📞',
  'send-sms':          '💬',
  'send-email':        '✉️',
  'book-appointment':  '📅',
  'drop-voicemail':    '📣',
  'mark-dnc':          '🚫',
  'wait':              '⏳',
};

export default function NextActionPanel({ contactId, onBook }: Props) {
  const [action,   setAction]   = useState<NextAction | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [executed, setExecuted] = useState(false);
  const [execMsg,  setExecMsg]  = useState('');

  useEffect(() => {
    setLoading(true); setAction(null); setExecuted(false); setExecMsg('');
    fetch(`${API_BASE}/next-action/${contactId}`)
      .then(r => r.json())
      .then(data => { setAction(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [contactId]);

  const execute = async () => {
    if (!action) return;

    if (action.action === 'book-appointment') {
      onBook?.();
      return;
    }

    const r = await fetch(`${API_BASE}/next-action/${contactId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action.action, message: action.message }),
    });
    const data = await r.json();
    if (data.executed) {
      setExecuted(true);
      setExecMsg(action.action === 'send-sms' ? 'Text sent ✓' : action.action === 'mark-dnc' ? 'Marked DNC ✓' : 'Done ✓');
    } else if (data.requiresFrontend) {
      setExecMsg('Open the relevant tab to complete this action.');
    }
  };

  if (loading) return (
    <div>
      <div className="text-[10px] tracking-widest uppercase text-gray-300 mb-2">AI Next Action</div>
      <div className="h-20 rounded animate-pulse" style={{ background: 'rgba(201,168,76,0.06)' }} />
    </div>
  );

  if (!action) return null;

  return (
    <div>
      <div className="text-[10px] tracking-widest uppercase text-gray-400 mb-2">AI Next Action</div>
      <div className="rounded p-3 border" style={{ borderColor: 'rgba(201,168,76,0.25)', background: 'rgba(201,168,76,0.03)' }}>
        {/* Urgency dot + label */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: URGENCY_COLOR[action.urgency] }} />
          <span className="text-xs font-medium text-black">
            {ACTION_ICON[action.action]} {action.label}
          </span>
        </div>

        {/* Reasoning */}
        <p className="text-[11px] text-gray-500 leading-relaxed mb-3">{action.reasoning}</p>

        {/* Pre-filled message preview */}
        {action.message && (
          <div className="text-[11px] text-gray-600 bg-gray-50 rounded p-2 mb-3 leading-relaxed italic border border-gray-100">
            "{action.message.slice(0, 100)}{action.message.length > 100 ? '…' : ''}"
          </div>
        )}

        {/* Schedule hint */}
        {action.scheduleIn != null && action.scheduleIn > 0 && (
          <p className="text-[10px] text-gray-400 mb-2">
            ⏱ {action.scheduleIn < 60 ? `in ${action.scheduleIn} min` : action.scheduleIn < 1440 ? `in ${Math.round(action.scheduleIn / 60)}h` : 'tomorrow'}
          </p>
        )}

        {execMsg ? (
          <p className="text-xs" style={{ color: execMsg.includes('✓') ? '#22c55e' : '#9ca3af' }}>{execMsg}</p>
        ) : action.action !== 'wait' && (
          <button
            onClick={execute}
            className="w-full text-[10px] tracking-widest uppercase py-1.5 rounded border font-medium transition-colors"
            style={{ borderColor: '#C9A84C', color: '#9A7A2E' }}
          >
            Execute →
          </button>
        )}
      </div>
    </div>
  );
}
