// ─── AI Agent Chat ────────────────────────────────────────────────────────────
// Not a Q&A bot — a real operations agent. Every message can trigger actual
// actions: create groups, assign contacts, send SMS, book appointments, etc.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE, authFetch } from '../config';

const GOLD = '#C9A84C';
const DARK = '#0A0A0A';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ActionBadge {
  icon: string;
  label: string;
  color: string;
}

interface AgentAction {
  tool: string;
  success: boolean;
  summary: string;
  badge?: ActionBadge;
}

type Role = 'user' | 'assistant' | 'system';

interface Message {
  id: string;
  role: Role;
  content: string;
  actions?: AgentAction[];
  ts: number;
  thinking?: boolean;  // placeholder while waiting
}

// ── Suggested prompts ─────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: '📊', text: 'What does my pipeline look like right now?' },
  { icon: '🗂️', text: 'Show me all my contact groups' },
  { icon: '🔥', text: 'Find all my hot leads' },
  { icon: '➕', text: 'Create a group called "Top Prospects"' },
  { icon: '📌', text: 'Assign all hot leads to "Hot Leads" group' },
  { icon: '💬', text: 'Send a follow-up text to [contact name]' },
  { icon: '📅', text: 'Book an appointment with [contact name] for tomorrow at 2pm' },
  { icon: '📝', text: 'Add a note to [contact name]' },
];

function uid() { return Math.random().toString(36).slice(2, 10); }

function timeLabel(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AgentChat() {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput('');

    const userMsg: Message = { id: uid(), role: 'user', content, ts: Date.now() };
    const thinkingMsg: Message = { id: uid(), role: 'assistant', content: '', ts: Date.now(), thinking: true };

    setMessages(prev => [...prev, userMsg, thinkingMsg]);
    setLoading(true);

    // Build history for API (exclude thinking bubbles)
    const history = [...messages.filter(m => !m.thinking), userMsg].map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })).filter(m => m.role === 'user' || m.role === 'assistant');

    try {
      const r = await authFetch(`${API_BASE}/agent/chat`, {
        method: 'POST',
        body: JSON.stringify({ messages: history }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: 'Network error' }));
        setMessages(prev => prev.map(m => m.thinking
          ? { ...m, thinking: false, content: `⚠️ ${err.error || 'Something went wrong. Try again.'}` }
          : m
        ));
        return;
      }

      const data = await r.json() as { reply: string; actions: AgentAction[]; usedLlm: boolean };

      setMessages(prev => prev.map(m => m.thinking
        ? { ...m, thinking: false, content: data.reply, actions: data.actions?.length ? data.actions : undefined }
        : m
      ));
    } catch {
      setMessages(prev => prev.map(m => m.thinking
        ? { ...m, thinking: false, content: '⚠️ Network error. Please try again.' }
        : m
      ));
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const clearChat = () => setMessages([]);

  const isEmpty = messages.length === 0;

  return (
    <div style={{ height: 'calc(100vh - 49px)', display: 'flex', flexDirection: 'column', background: '#f7f7f7' }}>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        padding: '12px 20px',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        {/* AI badge */}
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
          border: '1px solid rgba(201,168,76,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
          flexShrink: 0,
        }}>
          <svg width="16" height="22" viewBox="0 0 52 72" fill="none">
            <defs>
              <linearGradient id="bolt-agent" x1="26" y1="4" x2="26" y2="68" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#E8C96A"/>
                <stop offset="100%" stopColor="#8A6020"/>
              </linearGradient>
            </defs>
            <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="url(#bolt-agent)"/>
          </svg>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: DARK, letterSpacing: '0.02em' }}>Propel AI</div>
          <div style={{ fontSize: 10, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Operational Agent
          </div>
        </div>

        {/* Live indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#22c55e',
            boxShadow: '0 0 6px #22c55e',
            animation: 'pulse 2s infinite',
          }} />
          <span style={{ fontSize: 10, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
            Live
          </span>
        </div>

        {messages.length > 0 && (
          <>
            <div style={{ width: 1, height: 16, background: '#e5e7eb' }} />
            <button
              onClick={clearChat}
              style={{ fontSize: 10, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              Clear
            </button>
          </>
        )}
      </div>

      {/* ── Message list ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 0' }}>

        {/* Empty state / welcome */}
        {isEmpty && (
          <div style={{ maxWidth: 600, margin: '0 auto', padding: '0 20px' }}>
            <div style={{ textAlign: 'center', marginBottom: 32, paddingTop: 20 }}>
              <div style={{
                width: 64, height: 64, borderRadius: 18, margin: '0 auto 16px',
                background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
                border: '1px solid rgba(201,168,76,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
              }}>
                <svg width="28" height="38" viewBox="0 0 52 72" fill="none">
                  <defs>
                    <linearGradient id="bolt-welcome" x1="26" y1="4" x2="26" y2="68" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#E8C96A"/>
                      <stop offset="100%" stopColor="#8A6020"/>
                    </linearGradient>
                  </defs>
                  <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="url(#bolt-welcome)"/>
                </svg>
              </div>
              <div style={{ fontSize: 22, fontWeight: 300, color: DARK, letterSpacing: '0.04em', fontFamily: '"Cormorant Garamond", serif', marginBottom: 6 }}>
                Propel AI
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, maxWidth: 400, margin: '0 auto' }}>
                I'm your operational agent — I don't just answer questions, I take real action in your contact database. Tell me what you need done.
              </div>
            </div>

            {/* Suggested prompts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s.text)}
                  style={{
                    textAlign: 'left', padding: '11px 14px', borderRadius: 10,
                    border: '1px solid rgba(0,0,0,0.08)',
                    background: '#fff', cursor: 'pointer',
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'flex-start', gap: 9,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(201,168,76,0.4)'; (e.currentTarget as HTMLElement).style.background = 'rgba(201,168,76,0.03)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.background = '#fff'; }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{s.icon}</span>
                  <span style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              maxWidth: 680,
              margin: '0 auto 16px',
              padding: '0 20px',
              display: 'flex',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              alignItems: 'flex-end',
              gap: 10,
            }}
          >
            {/* Avatar */}
            {msg.role === 'assistant' && (
              <div style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: 'linear-gradient(135deg, #1a1a1a, #2d2d2d)',
                border: '1px solid rgba(201,168,76,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="10" height="14" viewBox="0 0 52 72" fill="none">
                  <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="#C9A84C"/>
                </svg>
              </div>
            )}

            <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>

              {/* Bubble */}
              <div style={{
                padding: '11px 15px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, #1a1a1a 0%, #111 100%)'
                  : '#fff',
                border: msg.role === 'user'
                  ? 'none'
                  : '1px solid rgba(0,0,0,0.07)',
                boxShadow: msg.role === 'user'
                  ? '0 2px 12px rgba(0,0,0,0.2)'
                  : '0 1px 6px rgba(0,0,0,0.05)',
                color: msg.role === 'user' ? '#fff' : DARK,
                fontSize: 13.5,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.thinking ? (
                  <ThinkingDots />
                ) : (
                  msg.content
                )}
              </div>

              {/* Action cards */}
              {msg.actions && msg.actions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
                  {msg.actions.map((action, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '7px 12px', borderRadius: 8,
                        background: `${action.badge?.color || '#9ca3af'}10`,
                        border: `1px solid ${action.badge?.color || '#9ca3af'}30`,
                      }}
                    >
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{action.badge?.icon || '⚡'}</span>
                      <span style={{ fontSize: 11.5, color: '#374151', fontWeight: 500, flex: 1 }}>
                        {action.badge?.label || action.summary}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                        color: action.success ? '#22c55e' : '#ef4444',
                        background: action.success ? '#dcfce7' : '#fee2e2',
                        borderRadius: 6, padding: '2px 6px',
                      }}>
                        {action.success ? 'Done' : 'Failed'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Timestamp */}
              {!msg.thinking && (
                <div style={{ fontSize: 9, color: '#9ca3af', letterSpacing: '0.05em' }}>
                  {timeLabel(msg.ts)}
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* ── Input area ────────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderTop: '1px solid rgba(0,0,0,0.07)',
        padding: '12px 20px', flexShrink: 0,
      }}>
        {/* Quick action chips */}
        {!isEmpty && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }}>
            {['Get pipeline stats', 'List my groups', 'Find hot leads', 'Create a group'].map(chip => (
              <button
                key={chip}
                onClick={() => sendMessage(chip)}
                disabled={loading}
                style={{
                  padding: '4px 12px', borderRadius: 20, border: '1px solid rgba(0,0,0,0.1)',
                  background: 'transparent', fontSize: 11, color: '#6b7280', cursor: loading ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap', transition: 'all 0.12s',
                }}
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell me what to do — create groups, assign contacts, send texts, book appointments…"
            rows={1}
            disabled={loading}
            style={{
              flex: 1, padding: '11px 14px', borderRadius: 12,
              border: '1.5px solid rgba(0,0,0,0.1)',
              fontSize: 13.5, outline: 'none', resize: 'none',
              background: '#fafafa', color: DARK,
              lineHeight: 1.5, maxHeight: 120,
              transition: 'border-color 0.15s',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
            onFocus={e => { e.target.style.borderColor = 'rgba(201,168,76,0.5)'; }}
            onBlur={e => { e.target.style.borderColor = 'rgba(0,0,0,0.1)'; }}
            onInput={e => {
              const el = e.target as HTMLTextAreaElement;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            style={{
              width: 42, height: 42, borderRadius: 11, border: 'none', flexShrink: 0,
              background: loading || !input.trim()
                ? '#e5e7eb'
                : 'linear-gradient(135deg, #1a1a1a 0%, #000 100%)',
              color: loading || !input.trim() ? '#9ca3af' : '#fff',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
              boxShadow: loading || !input.trim() ? 'none' : '0 2px 10px rgba(0,0,0,0.25)',
            }}
          >
            {loading ? (
              <span style={{ width: 16, height: 16, border: '2px solid #9ca3af', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>

        <div style={{ fontSize: 10, color: '#d1d5db', marginTop: 7, textAlign: 'center', letterSpacing: '0.04em' }}>
          Enter to send · Shift+Enter for new line · Actions execute immediately
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.15; } 40% { opacity: 1; } }
      `}</style>
    </div>
  );
}

// ── Thinking dots animation ───────────────────────────────────────────────────
function ThinkingDots() {
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#9ca3af',
          animation: `blink 1.4s infinite ${i * 0.2}s`,
        }} />
      ))}
    </div>
  );
}
