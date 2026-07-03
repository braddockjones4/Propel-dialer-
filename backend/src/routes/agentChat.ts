// ─── AI Agent Chat ────────────────────────────────────────────────────────────
// A fully agentic chat endpoint. The user types natural language commands and
// the agent interprets them, calls tools, executes real actions, and returns
// a rich response showing exactly what was done.
//
// Tool execution uses a MULTI-TURN AGENTIC LOOP:
//   while (LLM returns tool_use blocks, up to 5 passes):
//     execute all tools in parallel → append results → call LLM again
//   final LLM response (no tool calls) → send to client
//
import { Router, Request, Response } from 'express';
import prisma from '../db';
import { llmChat, llmConfigured, activeProvider, LlmMessage } from '../agent/llm';
import { sendSmsNow } from '../agent/executor';
import { io } from '../socket';

const router = Router();

// ── Tool schemas ──────────────────────────────────────────────────────────────
const CHAT_TOOLS = [
  {
    name: 'get_stats',
    description: 'Get a live summary of the contacts database: counts by status, by group, total contacts, recent calls, upcoming appointments.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_contacts',
    description: 'Search and filter contacts. Returns a list of matching contacts with their details.',
    parameters: {
      type: 'object',
      properties: {
        query:   { type: 'string',  description: 'Free-text search across name, phone, address.' },
        status:  { type: 'string',  description: 'Filter by status: new, contacted, callback, hot, appointment, closed, dnc' },
        group:   { type: 'string',  description: 'Filter by contact group name, e.g. "AYC Group"' },
        source:  { type: 'string',  description: 'Filter by source: expired, fsbo, circle, past-client, manual' },
        limit:   { type: 'number',  description: 'Max results to return (default 20, max 100)' },
      },
      required: [],
    },
  },
  {
    name: 'get_contact',
    description: 'Get full details for a single contact by name or phone number. Use this ONLY when you need to inspect a contact\'s details, history, or look up their ID before doing something else.',
    parameters: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'First name, last name, or full name.' },
        phone: { type: 'string', description: 'Phone number (partial is fine).' },
        id:    { type: 'string', description: 'Contact ID if known.' },
      },
      required: [],
    },
  },
  {
    name: 'list_groups',
    description: 'List all contact groups with their contact counts and colors.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_group',
    description: 'Create a new contact group. Use when the user asks to make a new group or list.',
    parameters: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'Name of the group, e.g. "Hot Leads" or "AYC Group".' },
        color: { type: 'string', description: 'Hex color, e.g. "#ef4444". Optional.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'assign_to_group',
    description: 'Assign one or more contacts to a group. Creates the group if it does not exist. PREFERRED: use filter_query with the contact name rather than looking up the ID first.',
    parameters: {
      type: 'object',
      properties: {
        group_name:    { type: 'string', description: 'Name of the target group.' },
        contact_ids:   { type: 'array',  items: { type: 'string' }, description: 'Specific contact IDs to assign. Leave empty to use filter_query instead.' },
        filter_status: { type: 'string', description: 'Assign all contacts matching this status.' },
        filter_source: { type: 'string', description: 'Assign all contacts matching this source.' },
        filter_query:  { type: 'string', description: 'Name or phone search — assign all matching contacts to the group. Use this instead of looking up the contact first.' },
      },
      required: ['group_name'],
    },
  },
  {
    name: 'update_status',
    description: 'Update the pipeline status of one or more contacts.',
    parameters: {
      type: 'object',
      properties: {
        contact_ids: { type: 'array', items: { type: 'string' }, description: 'Contact IDs to update.' },
        status: { type: 'string', enum: ['new', 'contacted', 'callback', 'hot', 'appointment', 'closed', 'dnc'], description: 'New status.' },
      },
      required: ['contact_ids', 'status'],
    },
  },
  {
    name: 'send_sms',
    description: 'Send an SMS message to one or more contacts. Use when the user explicitly asks to send a text or message.',
    parameters: {
      type: 'object',
      properties: {
        contact_ids: { type: 'array', items: { type: 'string' }, description: 'Contact IDs to message.' },
        message:     { type: 'string', description: 'The SMS text to send.' },
      },
      required: ['contact_ids', 'message'],
    },
  },
  {
    name: 'add_note',
    description: 'Add an internal note to a contact record.',
    parameters: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Contact ID.' },
        note:       { type: 'string', description: 'The note text.' },
      },
      required: ['contact_id', 'note'],
    },
  },
  {
    name: 'delete_group',
    description: 'Delete a contact group. Contacts in the group become ungrouped.',
    parameters: {
      type: 'object',
      properties: {
        group_name: { type: 'string', description: 'Name of the group to delete.' },
      },
      required: ['group_name'],
    },
  },
  {
    name: 'rename_group',
    description: 'Rename an existing contact group.',
    parameters: {
      type: 'object',
      properties: {
        old_name: { type: 'string', description: 'Current group name.' },
        new_name: { type: 'string', description: 'New group name.' },
      },
      required: ['old_name', 'new_name'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book a listing appointment for a contact.',
    parameters: {
      type: 'object',
      properties: {
        contact_id:   { type: 'string', description: 'Contact ID.' },
        iso_datetime: { type: 'string', description: 'Appointment start in ISO 8601, e.g. 2026-07-10T14:00:00' },
        title:        { type: 'string', description: 'Appointment title. Defaults to "Listing Appointment".' },
        location:     { type: 'string', description: 'Location or address.' },
        send_confirmation: { type: 'boolean', description: 'Send SMS confirmation to the contact. Default true.' },
      },
      required: ['contact_id', 'iso_datetime'],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────
interface ToolResult {
  tool: string;
  success: boolean;
  summary: string;
  data?: any;
  badge?: { icon: string; label: string; color: string };
}

async function runTool(name: string, args: any): Promise<ToolResult> {
  switch (name) {

    case 'get_stats': {
      const [total, byStatus, byGroup, recentCalls, upcomingAppts] = await Promise.all([
        prisma.contact.count(),
        prisma.contact.groupBy({ by: ['status'], _count: { id: true } }),
        prisma.contact.groupBy({ by: ['contactGroup'], _count: { id: true }, where: { contactGroup: { not: null } } }),
        prisma.call.count({ where: { calledAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
        prisma.appointment.count({ where: { scheduledAt: { gte: new Date() }, status: 'confirmed' } }),
      ]);
      const statusMap: Record<string, number> = {};
      for (const r of byStatus) statusMap[r.status] = (r as any)._count.id;
      const groupMap: Record<string, number> = {};
      for (const r of byGroup as any[]) if (r.contactGroup) groupMap[r.contactGroup] = r._count.id;
      const data = { total, byStatus: statusMap, byGroup: groupMap, callsLast7Days: recentCalls, upcomingAppointments: upcomingAppts };
      return {
        tool: name, success: true,
        summary: `${total} total contacts, ${statusMap.hot || 0} hot, ${upcomingAppts} upcoming appointments`,
        data,
        badge: { icon: '📊', label: 'Stats retrieved', color: '#3b82f6' },
      };
    }

    case 'search_contacts': {
      const { query, status, group, source, limit = 20 } = args as { query?: string; status?: string; group?: string; source?: string; limit?: number };
      const where: any = {};
      if (status) where.status = status;
      if (group)  where.contactGroup = group;
      if (source) where.source = source;
      if (query) {
        where.OR = [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName:  { contains: query, mode: 'insensitive' } },
          { phone:     { contains: query } },
          { address:   { contains: query, mode: 'insensitive' } },
        ];
      }
      const contacts = await prisma.contact.findMany({
        where, take: Math.min(limit, 100),
        select: { id: true, firstName: true, lastName: true, phone: true, status: true, contactGroup: true, source: true, leadScore: true },
        orderBy: [{ leadScore: 'desc' }, { updatedAt: 'desc' }],
      });
      return {
        tool: name, success: true,
        summary: `Found ${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`,
        data: contacts,
        badge: { icon: '🔍', label: `${contacts.length} contacts found`, color: '#8b5cf6' },
      };
    }

    case 'get_contact': {
      const { name: qname, phone, id } = args as { name?: string; phone?: string; id?: string };
      let contact: any = null;
      if (id) {
        contact = await prisma.contact.findUnique({ where: { id }, include: { calls: { take: 5, orderBy: { calledAt: 'desc' } }, messages: { take: 5, orderBy: { sentAt: 'desc' } } } });
      } else {
        const parts = (qname || '').trim().split(/\s+/);
        const where: any = phone
          ? { phone: { contains: phone } }
          : parts.length > 1
            ? { firstName: { contains: parts[0], mode: 'insensitive' }, lastName: { contains: parts[parts.length - 1], mode: 'insensitive' } }
            : { OR: [{ firstName: { contains: qname, mode: 'insensitive' } }, { lastName: { contains: qname, mode: 'insensitive' } }] };
        contact = await prisma.contact.findFirst({ where, include: { calls: { take: 5, orderBy: { calledAt: 'desc' } }, messages: { take: 5, orderBy: { sentAt: 'desc' } } } });
      }
      if (!contact) return { tool: name, success: false, summary: 'Contact not found', badge: { icon: '❌', label: 'Not found', color: '#ef4444' } };
      return {
        tool: name, success: true,
        summary: `Found ${contact.firstName} ${contact.lastName} — status: ${contact.status}, id: ${contact.id}`,
        data: contact,
        badge: { icon: '👤', label: `${contact.firstName} ${contact.lastName}`, color: '#C9A84C' },
      };
    }

    case 'list_groups': {
      const groups = await (prisma as any).contactGroup.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
      const counts = await prisma.contact.groupBy({ by: ['contactGroup'], _count: { id: true }, where: { contactGroup: { not: null } } });
      const countMap: Record<string, number> = {};
      for (const r of counts as any[]) if (r.contactGroup) countMap[r.contactGroup] = r._count.id;
      const data = (groups as any[]).map((g: any) => ({ ...g, contactCount: countMap[g.name] || 0 }));
      return {
        tool: name, success: true,
        summary: `${groups.length} group${groups.length !== 1 ? 's' : ''}: ${(groups as any[]).map((g: any) => g.name).join(', ') || 'none'}`,
        data,
        badge: { icon: '🗂️', label: `${groups.length} groups`, color: '#14b8a6' },
      };
    }

    case 'create_group': {
      const { name: gname, color } = args as { name: string; color?: string };
      const existing = await (prisma as any).contactGroup.findFirst({ where: { name: gname.trim() } });
      if (existing) return { tool: name, success: false, summary: `Group "${gname}" already exists`, badge: { icon: '⚠️', label: 'Already exists', color: '#f97316' } };
      const last = await (prisma as any).contactGroup.findFirst({ orderBy: { position: 'desc' } });
      const group = await (prisma as any).contactGroup.create({ data: { name: gname.trim(), color: color || '#9ca3af', position: (last?.position ?? -1) + 1 } });
      try { io.emit('groups-updated', { action: 'create', group }); } catch {}
      return {
        tool: name, success: true,
        summary: `Created group "${gname}"`,
        data: group,
        badge: { icon: '✅', label: `Created "${gname}"`, color: '#22c55e' },
      };
    }

    case 'assign_to_group': {
      const { group_name, contact_ids, filter_status, filter_source, filter_query } = args as {
        group_name: string; contact_ids?: string[]; filter_status?: string; filter_source?: string; filter_query?: string;
      };
      // Ensure group exists
      const last = await (prisma as any).contactGroup.findFirst({ orderBy: { position: 'desc' } });
      await (prisma as any).contactGroup.upsert({
        where: { name: group_name.trim() },
        create: { name: group_name.trim(), color: '#9ca3af', position: (last?.position ?? -1) + 1 },
        update: {},
      });

      let ids: string[] = contact_ids && contact_ids.length > 0 ? contact_ids : [];
      if (ids.length === 0) {
        const where: any = {};
        if (filter_status) where.status = filter_status;
        if (filter_source) where.source = filter_source;
        if (filter_query) {
          const parts = filter_query.trim().split(/\s+/);
          where.OR = parts.length > 1
            ? [
                { firstName: { contains: parts[0], mode: 'insensitive' }, lastName: { contains: parts[parts.length - 1], mode: 'insensitive' } },
                { firstName: { contains: filter_query, mode: 'insensitive' } },
                { lastName:  { contains: filter_query, mode: 'insensitive' } },
                { phone:     { contains: filter_query } },
              ]
            : [
                { firstName: { contains: filter_query, mode: 'insensitive' } },
                { lastName:  { contains: filter_query, mode: 'insensitive' } },
                { phone:     { contains: filter_query } },
              ];
        }
        const matches = await prisma.contact.findMany({ where, select: { id: true, firstName: true, lastName: true } });
        ids = matches.map((c) => c.id);
        if (ids.length === 0) return { tool: name, success: false, summary: `No contacts matched "${filter_query || filter_status || filter_source}"`, badge: { icon: '⚠️', label: 'No matches', color: '#f97316' } };
      }

      const { count } = await prisma.contact.updateMany({ where: { id: { in: ids } }, data: { contactGroup: group_name.trim() } });
      try { io.emit('agent-group', { action: 'assign', groupName: group_name, count }); } catch {}
      return {
        tool: name, success: true,
        summary: `Assigned ${count} contact${count !== 1 ? 's' : ''} to "${group_name}"`,
        data: { count, groupName: group_name, contactIds: ids },
        badge: { icon: '📌', label: `${count} → "${group_name}"`, color: '#22c55e' },
      };
    }

    case 'update_status': {
      const { contact_ids, status } = args as { contact_ids: string[]; status: string };
      const { count } = await prisma.contact.updateMany({ where: { id: { in: contact_ids } }, data: { status } });
      return {
        tool: name, success: true,
        summary: `Updated ${count} contact${count !== 1 ? 's' : ''} → ${status}`,
        data: { count, status },
        badge: { icon: '🔄', label: `${count} → ${status}`, color: '#3b82f6' },
      };
    }

    case 'send_sms': {
      const { contact_ids, message } = args as { contact_ids: string[]; message: string };
      const contacts = await prisma.contact.findMany({ where: { id: { in: contact_ids } }, select: { id: true, phone: true, firstName: true } });
      let sent = 0; let failed = 0;
      for (const c of contacts) {
        try { await sendSmsNow(c, message); sent++; } catch { failed++; }
      }
      const summary = failed > 0 ? `Sent ${sent}, failed ${failed}` : `Sent SMS to ${sent} contact${sent !== 1 ? 's' : ''}`;
      return {
        tool: name, success: sent > 0,
        summary,
        data: { sent, failed, message },
        badge: { icon: '💬', label: summary, color: sent > 0 ? '#22c55e' : '#ef4444' },
      };
    }

    case 'add_note': {
      const { contact_id, note } = args as { contact_id: string; note: string };
      const contact = await prisma.contact.findUnique({ where: { id: contact_id } });
      if (!contact) return { tool: name, success: false, summary: 'Contact not found', badge: { icon: '❌', label: 'Not found', color: '#ef4444' } };
      const prev = contact.notes ? contact.notes + '\n' : '';
      const stamp = new Date().toLocaleString();
      await prisma.contact.update({ where: { id: contact_id }, data: { notes: `${prev}[Agent ${stamp}] ${note}` } });
      return {
        tool: name, success: true,
        summary: `Note added to ${contact.firstName} ${contact.lastName}`,
        badge: { icon: '📝', label: 'Note added', color: '#8b5cf6' },
      };
    }

    case 'delete_group': {
      const { group_name } = args as { group_name: string };
      const g = await (prisma as any).contactGroup.findFirst({ where: { name: group_name } });
      if (!g) return { tool: name, success: false, summary: `Group "${group_name}" not found`, badge: { icon: '❌', label: 'Not found', color: '#ef4444' } };
      await prisma.contact.updateMany({ where: { contactGroup: group_name }, data: { contactGroup: null } });
      await (prisma as any).contactGroup.delete({ where: { id: g.id } });
      try { io.emit('groups-updated', { action: 'delete', groupName: group_name }); } catch {}
      return {
        tool: name, success: true,
        summary: `Deleted group "${group_name}"`,
        badge: { icon: '🗑️', label: `Deleted "${group_name}"`, color: '#ef4444' },
      };
    }

    case 'rename_group': {
      const { old_name, new_name } = args as { old_name: string; new_name: string };
      const g = await (prisma as any).contactGroup.findFirst({ where: { name: old_name } });
      if (!g) return { tool: name, success: false, summary: `Group "${old_name}" not found`, badge: { icon: '❌', label: 'Not found', color: '#ef4444' } };
      await prisma.contact.updateMany({ where: { contactGroup: old_name }, data: { contactGroup: new_name } });
      await (prisma as any).contactGroup.update({ where: { id: g.id }, data: { name: new_name } });
      try { io.emit('groups-updated', { action: 'rename', oldName: old_name, newName: new_name }); } catch {}
      return {
        tool: name, success: true,
        summary: `Renamed "${old_name}" → "${new_name}"`,
        badge: { icon: '✏️', label: `"${old_name}" → "${new_name}"`, color: '#C9A84C' },
      };
    }

    case 'book_appointment': {
      const { contact_id, iso_datetime, title, location, send_confirmation = true } = args as {
        contact_id: string; iso_datetime: string; title?: string; location?: string; send_confirmation?: boolean;
      };
      const contact = await prisma.contact.findUnique({ where: { id: contact_id } });
      if (!contact) return { tool: name, success: false, summary: 'Contact not found', badge: { icon: '❌', label: 'Not found', color: '#ef4444' } };
      const when = new Date(iso_datetime);
      if (isNaN(when.getTime())) return { tool: name, success: false, summary: 'Invalid datetime', badge: { icon: '❌', label: 'Bad date', color: '#ef4444' } };
      const appt = await prisma.appointment.create({
        data: { contactId: contact_id, title: title || 'Listing Appointment', scheduledAt: when, duration: 60, location: location || null, status: 'confirmed' },
      });
      await prisma.contact.update({ where: { id: contact_id }, data: { status: 'appointment' } });
      if (send_confirmation) {
        const msg = `You're confirmed for ${when.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. Looking forward to it! — Propel`;
        try { await sendSmsNow(contact, msg); } catch {}
      }
      try { io.emit('agent-appointment', { contactId: contact_id, apptId: appt.id, scheduledAt: when }); } catch {}
      return {
        tool: name, success: true,
        summary: `Booked appointment with ${contact.firstName} ${contact.lastName} for ${when.toLocaleDateString()}`,
        data: { appt, contact: { id: contact.id, firstName: contact.firstName, lastName: contact.lastName } },
        badge: { icon: '📅', label: `Appt: ${contact.firstName} ${contact.lastName}`, color: '#22c55e' },
      };
    }

    default:
      return { tool: name, success: false, summary: `Unknown tool: ${name}`, badge: { icon: '❓', label: 'Unknown', color: '#9ca3af' } };
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────
async function buildSystemPrompt(): Promise<string> {
  const now = new Date();
  let groupList = 'none yet';
  try {
    const groups = await (prisma as any).contactGroup.findMany({ select: { name: true }, orderBy: { position: 'asc' } });
    if (groups.length > 0) groupList = (groups as any[]).map((g: any) => `"${g.name}"`).join(', ');
  } catch {}
  const totalContacts = await prisma.contact.count().catch(() => 0);

  return `You are Propel AI, an elite real estate dialing assistant with direct access to the agent's contact database. You don't just answer questions — you take real action.

Current date/time: ${now.toISOString()} (${now.toLocaleString('en-US')})
Total contacts in database: ${totalContacts}
Existing contact groups: ${groupList}

CAPABILITIES — you can:
• Search and retrieve contacts from the database
• Create, rename, and delete contact groups
• Assign contacts to groups (by ID list, or by filter: status/source/name search)
• Update contact pipeline statuses
• Send SMS messages to contacts
• Add internal notes to contact records
• Book listing appointments and send SMS confirmations
• Retrieve pipeline stats and analytics

TOOL STRATEGY — follow these rules exactly:
• "Add/move/assign [person name] to [group]" → call assign_to_group with filter_query="[person's name]" and group_name="[group]". Do NOT call get_contact first — assign_to_group searches by name directly.
• "Assign all [status/source] contacts to [group]" → call assign_to_group with filter_status or filter_source.
• When a task needs multiple steps, call ALL required tools in a single response — don't split across replies.
• NEVER say "I will now do X" or "Next I'll do Y" without calling the tool to actually do it in the same response. If you say you're going to do something, do it with a tool call right now.
• After tool results return, give a crisp 1-2 sentence confirmation of what was done. Don't re-explain the plan.

BEHAVIOR:
• Be direct and action-oriented.
• Never fabricate contact data. Only report what the tools return.
• If a destructive action (mass SMS, delete group) seems risky, briefly confirm scope in your text — but still call the tool.`;
}

// ── Multi-turn agentic loop ───────────────────────────────────────────────────
async function runAgentLoop(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
): Promise<{ reply: string; actions: ToolResult[] }> {
  const allActions: ToolResult[] = [];
  let reply = '';
  const MAX_PASSES = 5;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const agentModel   = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  if (anthropicKey) {
    // ── Anthropic: native multi-turn loop ──────────────────────────────────
    const anthropicTools = CHAT_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    let apiMessages: any[] = messages.map(m => ({ role: m.role, content: m.content }));

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: agentModel,
          max_tokens: 1200,
          temperature: 0.3,
          system: systemPrompt,
          tools: anthropicTools,
          messages: apiMessages,
        }),
      });

      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`LLM ${r.status}: ${txt.slice(0, 200)}`);
      }

      const data = await r.json() as any;
      const toolUseBlocks = (data.content || []).filter((b: any) => b.type === 'tool_use');
      const textContent   = (data.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
        .trim();

      if (textContent) reply = textContent;

      // No more tool calls — done
      if (toolUseBlocks.length === 0 || data.stop_reason === 'end_turn') break;

      // Execute all tool calls in parallel
      const toolResultEntries = await Promise.all(
        toolUseBlocks.map(async (tb: any) => {
          const result = await runTool(tb.name, tb.input || {});
          allActions.push(result);
          return {
            type: 'tool_result' as const,
            tool_use_id: tb.id,
            content: JSON.stringify(
              result.data !== undefined ? result.data : { summary: result.summary, success: result.success }
            ),
          };
        })
      );

      // Append assistant turn + tool results for next pass
      apiMessages.push({ role: 'assistant', content: data.content });
      apiMessages.push({ role: 'user', content: toolResultEntries });
    }

  } else {
    // ── OpenAI fallback: 2-pass (OpenAI doesn't need multi-turn here) ──────
    const llmMessages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    const pass1 = await llmChat({ messages: llmMessages, tools: CHAT_TOOLS as any, temperature: 0.3, maxTokens: 1200 });

    const toolResults: Array<{ id: string; result: ToolResult }> = [];
    for (const tc of pass1.toolCalls) {
      const result = await runTool(tc.name, tc.arguments);
      toolResults.push({ id: tc.id, result });
      allActions.push(result);
    }
    reply = pass1.content;

    if (toolResults.length > 0) {
      const pass2Msgs: LlmMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'assistant', content: pass1.content || '', tool_calls: pass1.toolCalls },
        ...toolResults.map(({ id, result }) => ({
          role: 'tool' as const,
          content: JSON.stringify(result.data || { summary: result.summary }),
          tool_call_id: id,
        })),
      ];
      const pass2 = await llmChat({ messages: pass2Msgs, temperature: 0.35, maxTokens: 600 });
      if (pass2.content) reply = pass2.content;
    }
  }

  if (!reply && allActions.length > 0) {
    reply = allActions.map(a => a.summary).filter(Boolean).join(' — ');
  }
  if (!reply) reply = "I wasn't sure what to do with that. Could you be more specific?";

  return { reply, actions: allActions };
}

// ── Chat endpoint ─────────────────────────────────────────────────────────────
// POST /api/agent/chat
// Body: { messages: Array<{ role: 'user'|'assistant', content: string }> }
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> };
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    if (!llmConfigured()) {
      return res.json({
        reply: "I'm ready to help, but no AI model is configured yet. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to your backend environment variables.",
        actions: [],
        usedLlm: false,
      });
    }

    const systemPrompt = await buildSystemPrompt();
    const { reply, actions } = await runAgentLoop(messages, systemPrompt);

    res.json({ reply, actions, usedLlm: true });
  } catch (e: any) {
    console.error('[AgentChat] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
