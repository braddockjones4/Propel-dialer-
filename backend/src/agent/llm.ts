// ─── Model-Agnostic LLM Layer ────────────────────────────────────────────────
// Provider-agnostic chat + tool-calling (Lesson: never marry one model).
// Auto-selects a provider from whatever API key is configured:
//   ANTHROPIC_API_KEY → Claude   |   OPENAI_API_KEY → GPT
// Swapping/adding a provider later means touching only this file.

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: LlmToolCall[];
}
export interface LlmToolCall { id: string; name: string; arguments: Record<string, any>; }
export interface LlmToolSchema { name: string; description: string; parameters: Record<string, any>; }
export interface LlmResult { content: string; toolCalls: LlmToolCall[]; raw?: any; }

type Provider = 'anthropic' | 'openai';

const DEFAULTS: Record<Provider, string> = {
  anthropic: 'claude-haiku-4-5-20251001', // fast + cheap, ideal for high-volume lead replies
  openai: 'gpt-4o-mini',
};

export function activeProvider(): Provider | null {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export function llmConfigured(): boolean {
  return activeProvider() !== null;
}

export function defaultModel(): string {
  const p = activeProvider();
  return p ? DEFAULTS[p] : DEFAULTS.openai;
}

/** Ensure the requested model matches the active provider; otherwise fall back. */
function resolveModel(provider: Provider, requested?: string): string {
  if (!requested) return DEFAULTS[provider];
  const isClaude = requested.startsWith('claude');
  if (provider === 'anthropic' && !isClaude) return DEFAULTS.anthropic;
  if (provider === 'openai' && isClaude) return DEFAULTS.openai;
  return requested;
}

export async function llmChat(opts: {
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  forceJson?: boolean;
}): Promise<LlmResult> {
  const provider = activeProvider();
  if (!provider) throw new Error('LLM_NOT_CONFIGURED');
  const model = resolveModel(provider, opts.model);
  return provider === 'anthropic'
    ? anthropicChat(model, opts)
    : openaiChat(model, opts);
}

// ── Anthropic (Claude) ────────────────────────────────────────────────────────
async function anthropicChat(model: string, opts: Parameters<typeof llmChat>[0]): Promise<LlmResult> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const system = opts.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const msgs = opts.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));

  const body: any = {
    model,
    max_tokens: opts.maxTokens ?? 500,
    temperature: opts.temperature ?? 0.4,
    messages: msgs.length ? msgs : [{ role: 'user', content: 'Continue.' }],
  };
  if (system) body.system = system;
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`LLM_HTTP_${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await resp.json()) as any;
  let content = '';
  const toolCalls: LlmToolCall[] = [];
  for (const block of data.content || []) {
    if (block.type === 'text') content += block.text;
    else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: block.input || {} });
  }
  return { content: content.trim(), toolCalls, raw: data };
}

// ── OpenAI (GPT) ──────────────────────────────────────────────────────────────
async function openaiChat(model: string, opts: Parameters<typeof llmChat>[0]): Promise<LlmResult> {
  const key = process.env.OPENAI_API_KEY!;
  const messages = opts.messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id };
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant', content: m.content || '',
        tool_calls: m.tool_calls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } })),
      };
    }
    return { role: m.role, content: m.content };
  });

  const body: any = { model, messages, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens ?? 500 };
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = 'auto';
  }
  if (opts.forceJson) body.response_format = { type: 'json_object' };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`LLM_HTTP_${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await resp.json()) as any;
  const choice = data.choices?.[0]?.message || {};
  const toolCalls: LlmToolCall[] = (choice.tool_calls || []).map((tc: any) => {
    let args: Record<string, any> = {};
    try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
    return { id: tc.id, name: tc.function?.name, arguments: args };
  });
  return { content: choice.content || '', toolCalls, raw: data };
}
