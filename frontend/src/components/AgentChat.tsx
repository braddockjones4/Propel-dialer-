// ─── AI Agent Chat ────────────────────────────────────────────────────────────
// Operational agent: takes real actions (create groups, assign contacts, send
// SMS, book appointments, etc.) plus a Claude-style conversation sidebar.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE, authFetch } from '../config';

const GOLD = '#C9A84C';
const DARK = '#0A0A0A';
const SIDEBAR_W = 260;

// ── Types ─────────────────────────────────────────────────────────────────────
interface ActionBadge { icon: string; label: string; color: string }
interface AgentAction { tool: string; success: boolean; summary: string; badge?: ActionBadge }
type Role = 'user' | 'assistant';

interface Message {
  id: string;
  role: Role;
  content: string;
  actions?: AgentAction[];
  ts: number;
  thinking?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// ── localStorage helpers ──────────────────────────────────────────────────────
const STORAGE_KEY = 'propel_agent_conversations';

function loadConversations(): Conversation[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function persistConversations(convs: Conversation[]): void {
  const trimmed = [...convs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

// ── Suggestions ───────────────────────────────────────────────────────────────
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
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function dateLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AgentChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId,    setCurrentId]      = useState<string | null>(null);
  const [messages,     setMessages]        = useState<Message[]>([]);
  const [input,        setInput]           = useState('');
  const [loading,      setLoading]         = useState(false);
  const [sidebarOpen,  setSidebarOpen]     = useState(false);
  const [hoverConvId,  setHoverConvId]     = useState<string | null>(null);
  // Reactive isMobile — updates on resize / orientation change
  const [isMobile,     setIsMobile]        = useState(() => window.innerWidth < 768);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Track viewport width reactively
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Load conversations from localStorage on mount
  useEffect(() => {
    const convs = loadConversations();
    setConversations(convs);
  }, []);

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // ── Conversation management ───────────────────────────────────────────────
  const selectConversation = (conv: Conversation) => {
    setCurrentId(conv.id);
    setMessages(conv.messages);
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const newConversation = () => {
    setCurrentId(null);
    setMessages([]);
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const deleteConversation = (e: React.MouseEvent, convId: string) => {
    e.stopPropagation();
    const updated = conversations.filter(c => c.id !== convId);
    setConversations(updated);
    persistConversations(updated);
    if (currentId === convId) { setCurrentId(null); setMessages([]); }
  };

  // Save messages to a conversation in localStorage
  const saveMessages = useCallback((msgs: Message[], convId: string | null, firstUserText: string): string => {
    const id = convId || uid();
    const title = firstUserText.length > 44 ? firstUserText.slice(0, 41) + '…' : firstUserText;
    setConversations(prev => {
      const existing = prev.find(c => c.id === id);
      let updated: Conversation[];
      if (existing) {
        updated = prev.map(c => c.id === id ? { ...c, messages: msgs, updatedAt: Date.now() } : c);
      } else {
        updated = [{ id, title, messages: msgs, createdAt: Date.now(), updatedAt: Date.now() }, ...prev];
      }
      persistConversations(updated);
      return updated;
    });
    return id;
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput('');

    const userMsg: Message    = { id: uid(), role: 'user',      content, ts: Date.now() };
    const thinkingMsg: Message = { id: uid(), role: 'assistant', content: '', ts: Date.now(), thinking: true };

    const nextMsgs = [...messages, userMsg, thinkingMsg];
    setMessages(nextMsgs);
    setLoading(true);

    const history = [...messages.filter(m => !m.thinking), userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }));

    const firstUser = messages.find(m => m.role === 'user')?.content || content;

    try {
      const r = await authFetch(`${API_BASE}/agent/chat`, {
        method: 'POST',
        body: JSON.stringify({ messages: history }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: 'Network error' }));
        setMessages(prev => prev.map(m => m.thinking
          ? { ...m, thinking: false, content: `⚠️ ${err.error || 'Something went wrong. Try again.'}` } : m));
        return;
      }

      const data = await r.json() as { reply: string; actions: AgentAction[]; usedLlm: boolean };

      const finalMsgs = nextMsgs.map(m => m.thinking
        ? { ...m, thinking: false, content: data.reply, actions: data.actions?.length ? data.actions : undefined }
        : m
      );
      setMessages(finalMsgs);

      const savedId = saveMessages(finalMsgs.filter(m => !m.thinking), currentId, firstUser);
      if (!currentId) setCurrentId(savedId);

    } catch {
      setMessages(prev => prev.map(m => m.thinking
        ? { ...m, thinking: false, content: '⚠️ Network error. Please try again.' } : m));
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, loading, messages, currentId, saveMessages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const isEmpty = messages.filter(m => !m.thinking).length === 0;

  const groupedConversations = React.useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const conv of conversations) {
      const label = dateLabel(conv.updatedAt);
      if (!groups[label]) groups[label] = [];
      groups[label].push(conv);
    }
    return groups;
  }, [conversations]);

  // Bottom nav height on mobile
  const BOTTOM_NAV = 60;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        height: isMobile ? 'calc(100dvh - 109px)' : 'calc(100vh - 49px)',
        display: 'flex', overflow: 'hidden', background: '#f7f7f7',
      }}
    >

      {/* ── Sidebar backdrop (mobile only) ─────────────────────────────── */}
      {sidebarOpen && isMobile && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            top: 49, left: 0, right: 0,
            // Stop above the bottom nav bar so it doesn't cover it
            bottom: BOTTOM_NAV,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 40,
          }}
        />
      )}

      {/* ── Conversation sidebar ───────────────────────────────────────── */}
      <div
        style={{
          width: SIDEBAR_W,
          background: '#fff',
          borderRight: '1px solid rgba(0,0,0,0.07)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          // Mobile: fixed overlay that clears both nav bars
          // Desktop: always-visible in-flow column
          position: isMobile ? 'fixed' : 'relative',
          top: isMobile ? 49 : 0,
          left: 0,
          // On mobile stop above the bottom tab bar (60px); on desktop fill to bottom
          bottom: isMobile ? BOTTOM_NAV : 0,
          zIndex: 45,
          transform: isMobile && !sidebarOpen ? `translateX(-${SIDEBAR_W}px)` : 'translateX(0)',
          transition: 'transform 0.22s ease',
          boxShadow: isMobile && sidebarOpen ? '4px 0 20px rgba(0,0,0,0.12)' : 'none',
        }}
      >
        {/* Sidebar header */}
        <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 7,
              background: 'linear-gradient(135deg, #1a1a1a, #2d2d2d)',
              border: '1px solid rgba(201,168,76,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="9" height="13" viewBox="0 0 52 72" fill="none">
                <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="#C9A84C"/>
              </svg>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: DARK, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Propel AI
            </span>
          </div>
          <button
            onClick={newConversation}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 8,
              border: '1px solid rgba(201,168,76,0.35)',
              background: 'rgba(201,168,76,0.06)',
              color: '#9A7A2E', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
              letterSpacing: '0.03em',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New conversation
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {conversations.length === 0 ? (
            <div style={{ padding: '20px 14px', textAlign: 'center', color: '#9ca3af', fontSize: 11, lineHeight: 1.6 }}>
              Your conversations will appear here
            </div>
          ) : (
            Object.entries(groupedConversations).map(([label, convs]) => (
              <div key={label}>
                <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {label}
                </div>
                {convs.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => selectConversation(conv)}
                    onMouseEnter={() => setHoverConvId(conv.id)}
                    onMouseLeave={() => setHoverConvId(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '7px 12px 7px 14px',
                      cursor: 'pointer',
                      background: currentId === conv.id
                        ? 'rgba(201,168,76,0.1)'
                        : hoverConvId === conv.id
                        ? 'rgba(0,0,0,0.03)'
                        : 'transparent',
                      borderLeft: currentId === conv.id ? `3px solid ${GOLD}` : '3px solid transparent',
                      transition: 'all 0.1s',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: currentId === conv.id ? 600 : 400,
                        color: currentId === conv.id ? '#1a1a1a' : '#374151',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        lineHeight: 1.4,
                      }}>
                        {conv.title}
                      </div>
                      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>
                        {timeLabel(conv.updatedAt)}
                      </div>
                    </div>
                    {(hoverConvId === conv.id || currentId === conv.id) && (
                      <button
                        onClick={(e) => deleteConversation(e, conv.id)}
                        style={{
                          width: 22, height: 22, borderRadius: 5, border: 'none',
                          background: 'rgba(0,0,0,0.06)', color: '#9ca3af',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, transition: 'all 0.1s',
                        }}
                        title="Delete conversation"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Header */}
        <div style={{
          background: '#fff',
          borderBottom: '1px solid rgba(0,0,0,0.07)',
          padding: isMobile ? '10px 12px' : '12px 20px',
          display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, flexShrink: 0,
        }}>
          {/* Mobile sidebar toggle */}
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(o => !o)}
              style={{
                width: 34, height: 34, borderRadius: 8,
                border: '1px solid #e5e7eb',
                background: sidebarOpen ? 'rgba(201,168,76,0.08)' : 'transparent',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
          )}

          {/* AI badge */}
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
            border: '1px solid rgba(201,168,76,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.2)', flexShrink: 0,
          }}>
            <svg width="14" height="19" viewBox="0 0 52 72" fill="none">
              <defs>
                <linearGradient id="bolt-agent-hdr" x1="26" y1="4" x2="26" y2="68" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#E8C96A"/>
                  <stop offset="100%" stopColor="#8A6020"/>
                </linearGradient>
              </defs>
              <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="url(#bolt-agent-hdr)"/>
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 13 : 13.5, fontWeight: 700, color: DARK, letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentId
                ? (conversations.find(c => c.id === currentId)?.title || 'Propel AI')
                : 'Propel AI'}
            </div>
            <div style={{ fontSize: 9.5, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Operational Agent
            </div>
          </div>

          {/* Live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#22c55e', boxShadow: '0 0 6px #22c55e',
              animation: 'pulse-dot 2s infinite',
            }} />
            {!isMobile && (
              <span style={{ fontSize: 9.5, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
                Live
              </span>
            )}
          </div>

          {messages.length > 0 && (
            <>
              <div style={{ width: 1, height: 14, background: '#e5e7eb', flexShrink: 0 }} />
              <button
                onClick={newConversation}
                style={{ fontSize: 9.5, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}
              >
                New
              </button>
            </>
          )}
        </div>

        {/* Message list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 0' : '20px 0' }}>

          {/* Empty state */}
          {isEmpty && (
            <div style={{ maxWidth: 580, margin: '0 auto', padding: isMobile ? '0 14px' : '0 20px' }}>
              <div style={{ textAlign: 'center', marginBottom: isMobile ? 16 : 28, paddingTop: isMobile ? 8 : 16 }}>
                <div style={{
                  width: 54, height: 54, borderRadius: 14, margin: '0 auto 12px',
                  background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
                  border: '1px solid rgba(201,168,76,0.22)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 6px 28px rgba(0,0,0,0.12)',
                }}>
                  <svg width="22" height="30" viewBox="0 0 52 72" fill="none">
                    <defs>
                      <linearGradient id="bolt-welcome2" x1="26" y1="4" x2="26" y2="68" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#E8C96A"/>
                        <stop offset="100%" stopColor="#8A6020"/>
                      </linearGradient>
                    </defs>
                    <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="url(#bolt-welcome2)"/>
                  </svg>
                </div>
                <div style={{ fontSize: isMobile ? 18 : 21, fontWeight: 300, color: DARK, letterSpacing: '0.04em', fontFamily: '"Cormorant Garamond", serif', marginBottom: 5 }}>
                  Propel AI
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.65, maxWidth: 320, margin: '0 auto' }}>
                  I'm your operational agent — I don't just answer questions, I take real action in your contact database.
                </div>
              </div>
              {/* 1-column on mobile, auto-fit grid on desktop */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: isMobile ? 6 : 7,
              }}>
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s.text)}
                    style={{
                      textAlign: 'left', padding: isMobile ? '11px 14px' : '10px 13px', borderRadius: 9,
                      border: '1px solid rgba(0,0,0,0.08)', background: '#fff',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(201,168,76,0.4)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,0,0,0.08)'; }}
                  >
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{s.icon}</span>
                    <span style={{ fontSize: isMobile ? 13 : 11.5, color: '#374151', lineHeight: 1.4 }}>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map(msg => (
            <div
              key={msg.id}
              style={{
                maxWidth: 680, margin: `0 auto ${isMobile ? '10px' : '14px'}`,
                padding: isMobile ? '0 12px' : '0 20px',
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-end', gap: 8,
              }}
            >
              {/* Avatar */}
              {msg.role === 'assistant' && (
                <div style={{
                  width: 27, height: 27, borderRadius: 7, flexShrink: 0,
                  background: 'linear-gradient(135deg, #1a1a1a, #2d2d2d)',
                  border: '1px solid rgba(201,168,76,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="9" height="13" viewBox="0 0 52 72" fill="none">
                    <path d="M36 4 L14 38 L24 38 L16 68 L40 30 L28 30 Z" fill="#C9A84C"/>
                  </svg>
                </div>
              )}

              <div style={{ maxWidth: isMobile ? '85%' : '78%', display: 'flex', flexDirection: 'column', gap: 5, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {/* Bubble */}
                <div style={{
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '15px 15px 3px 15px' : '3px 15px 15px 15px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #1a1a1a 0%, #111 100%)'
                    : '#fff',
                  border: msg.role === 'user' ? 'none' : '1px solid rgba(0,0,0,0.07)',
                  boxShadow: msg.role === 'user' ? '0 2px 10px rgba(0,0,0,0.18)' : '0 1px 5px rgba(0,0,0,0.05)',
                  color: msg.role === 'user' ? '#fff' : DARK,
                  fontSize: isMobile ? 14 : 13, lineHeight: 1.65,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.thinking ? <ThinkingDots /> : msg.content}
                </div>

                {/* Action cards */}
                {msg.actions && msg.actions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                    {msg.actions.map((action, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '6px 11px', borderRadius: 7,
                        background: `${action.badge?.color || '#9ca3af'}12`,
                        border: `1px solid ${action.badge?.color || '#9ca3af'}28`,
                      }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>{action.badge?.icon || '⚡'}</span>
                        <span style={{ fontSize: 11, color: '#374151', fontWeight: 500, flex: 1 }}>
                          {action.badge?.label || action.summary}
                        </span>
                        <span style={{
                          fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: action.success ? '#22c55e' : '#ef4444',
                          background: action.success ? '#dcfce7' : '#fee2e2',
                          borderRadius: 5, padding: '2px 6px',
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

        {/* Input area */}
        <div style={{
          background: '#fff',
          borderTop: '1px solid rgba(0,0,0,0.07)',
          padding: isMobile ? '10px 12px' : '12px 20px',
          flexShrink: 0,
        }}>
          {/* Quick chips */}
          {!isEmpty && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }} className="hide-scrollbar">
              {['Pipeline stats', 'List groups', 'Hot leads', 'Create group'].map(chip => (
                <button
                  key={chip}
                  onClick={() => sendMessage(chip)}
                  disabled={loading}
                  style={{
                    padding: '5px 11px', borderRadius: 20,
                    border: '1px solid rgba(0,0,0,0.09)',
                    background: 'transparent', fontSize: 12,
                    color: '#6b7280', cursor: loading ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap', transition: 'all 0.1s', flexShrink: 0,
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything or give me a task…"
              rows={1}
              disabled={loading}
              style={{
                flex: 1, padding: '10px 13px', borderRadius: 11,
                border: '1.5px solid rgba(0,0,0,0.1)',
                fontSize: isMobile ? 15 : 13, outline: 'none', resize: 'none',
                background: '#fafafa', color: DARK,
                lineHeight: 1.5, maxHeight: 120,
                transition: 'border-color 0.12s',
                fontFamily: 'inherit', boxSizing: 'border-box',
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
                background: loading || !input.trim() ? '#e5e7eb' : 'linear-gradient(135deg, #1a1a1a 0%, #000 100%)',
                color: loading || !input.trim() ? '#9ca3af' : '#fff',
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.12s',
                boxShadow: loading || !input.trim() ? 'none' : '0 2px 9px rgba(0,0,0,0.22)',
              }}
            >
              {loading ? (
                <span style={{ width: 15, height: 15, border: '2px solid #9ca3af', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              )}
            </button>
          </div>
          {!isMobile && (
            <div style={{ fontSize: 9.5, color: '#d1d5db', marginTop: 6, textAlign: 'center', letterSpacing: '0.04em' }}>
              Enter to send · Shift+Enter for new line · Actions execute immediately
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.15; } 40% { opacity: 1; } }
        .hide-scrollbar { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

// ── Thinking dots ─────────────────────────────────────────────────────────────
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
