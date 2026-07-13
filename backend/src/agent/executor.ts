// ─── Action Executor ─────────────────────────────────────────────────────────
// Performs the real side-effects of an agent action. Used both by the engine
// (autonomous/auto mode) and by the approval route (human approves a queued one).
import twilio from 'twilio';
import prisma from '../db';
import { io } from '../socket';
import { computeLeadScore } from '../leadScore';

export type ActionType = 'sms' | 'followup' | 'appointment' | 'status' | 'note' | 'dnc' | 'escalate' | 'group';

export interface ActionSpec {
  type: ActionType;
  reasoning?: string;
  payload: {
    message?: string;
    title?: string;
    scheduledAt?: string;   // ISO — appointment time
    durationMin?: number;
    location?: string;
    status?: string;        // for status updates
    note?: string;
    scheduledFor?: string;  // ISO — deferred follow-up send time
    groupName?: string;     // for group assignment
    groupColor?: string;    // optional color for new group
  };
}

function twilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

/** Send an SMS now. Falls back to "simulated" send when Twilio isn't configured. */
export async function sendSmsNow(contact: { id: string; phone: string | null }, body: string) {
  if (!contact.phone) throw new Error('Contact has no phone number — cannot send SMS');
  const from = process.env.TWILIO_CALLER_ID || process.env.AGENT_PHONE || '';
  const client = twilioClient();
  let twilioSid: string | undefined;
  let status = 'sent';

  if (client && from) {
    try {
      const msg = await client.messages.create({ to: contact.phone, from, body });
      twilioSid = msg.sid;
    } catch (e: any) {
      status = 'failed';
      throw new Error(`Twilio send failed: ${e.message}`);
    }
  } else {
    // Demo mode — no Twilio creds. Record the message so the UX is fully testable.
    status = 'simulated';
    console.log(`[Agent SMS · SIMULATED] → ${contact.phone}: ${body}`);
  }

  const saved = await prisma.message.create({
    data: {
      contactId: contact.id, direction: 'outbound', body,
      fromNumber: from || 'agent', toNumber: contact.phone,
      twilioSid, status,
    },
  });

  try {
    io.emit('agent-sms', { contactId: contact.id, body, at: saved.sentAt, status });
  } catch { /* socket optional */ }

  return saved;
}

/**
 * Execute a fully-specified action against a contact. Returns a human-readable
 * result string. Throws on hard failures so callers can mark the action failed.
 */
export async function executeActionSpec(spec: ActionSpec, contactId: string): Promise<string> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw new Error('Contact not found');

  switch (spec.type) {
    case 'sms':
    case 'followup': {
      const message = spec.payload.message?.trim();
      if (!message) throw new Error('message required');
      await sendSmsNow(contact, message);
      return `Sent SMS: "${message.slice(0, 60)}${message.length > 60 ? '…' : ''}"`;
    }

    case 'appointment': {
      const when = spec.payload.scheduledAt ? new Date(spec.payload.scheduledAt) : null;
      if (!when || isNaN(when.getTime())) throw new Error('valid scheduledAt required');
      const appt = await prisma.appointment.create({
        data: {
          contactId,
          title: spec.payload.title || 'Listing Appointment',
          scheduledAt: when,
          duration: spec.payload.durationMin || 60,
          location: spec.payload.location || null,
          notes: spec.reasoning || null,
          status: 'confirmed',
        },
      });
      await prisma.contact.update({ where: { id: contactId }, data: { status: 'appointment' } });
      // Confirmation text (best-effort)
      const confirm = spec.payload.message
        || `You're all set for ${when.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}. Looking forward to it! Reply here if anything changes.`;
      try { await sendSmsNow(contact, confirm); } catch { /* non-fatal */ }
      try { io.emit('agent-appointment', { contactId, apptId: appt.id, scheduledAt: when }); } catch {}
      return `Booked appointment for ${when.toLocaleString()}`;
    }

    case 'status': {
      const status = spec.payload.status;
      if (!status) throw new Error('status required');
      await prisma.contact.update({ where: { id: contactId }, data: { status } });
      return `Updated status → ${status}`;
    }

    case 'note': {
      const note = spec.payload.note?.trim();
      if (!note) throw new Error('note required');
      const prev = contact.notes ? contact.notes + '\n' : '';
      const stamp = new Date().toLocaleString();
      await prisma.contact.update({
        where: { id: contactId },
        data: { notes: `${prev}[AI ${stamp}] ${note}` },
      });
      return `Added note`;
    }

    case 'dnc': {
      await prisma.contact.update({ where: { id: contactId }, data: { status: 'dnc' } });
      return `Marked contact DNC`;
    }

    case 'escalate': {
      // No outbound side-effect — just flag for the human via socket + note.
      try { io.emit('agent-escalation', { contactId, note: spec.payload.note || spec.reasoning }); } catch {}
      return `Escalated to human: ${spec.payload.note || spec.reasoning || 'needs attention'}`;
    }

    case 'group': {
      const groupName = spec.payload.groupName?.trim();
      if (!groupName) throw new Error('groupName required');

      // Find or create the group — avoids race condition when assigning multiple contacts at once
      let group = await (prisma as any).contactGroup.findFirst({ where: { name: groupName } });
      if (!group) {
        try {
          const existingLast = await (prisma as any).contactGroup.findFirst({ orderBy: { position: 'desc' } });
          const nextPos = (existingLast?.position ?? -1) + 1;
          group = await (prisma as any).contactGroup.create({
            data: {
              name: groupName,
              color: spec.payload.groupColor || '#9ca3af',
              position: nextPos,
            },
          });
        } catch {
          // Another concurrent request created it — fetch it now
          group = await (prisma as any).contactGroup.findFirst({ where: { name: groupName } });
        }
      }

      // Assign the contact to this group
      await prisma.contact.update({
        where: { id: contactId },
        data: { contactGroup: groupName },
      });

      // Notify front-end so the kanban board updates in real time
      try {
        io.emit('agent-group', {
          contactId,
          groupId: group.id,
          groupName,
          action: 'assign',
        });
      } catch { /* socket optional */ }

      return `Assigned to group "${groupName}"`;
    }

    default:
      throw new Error(`Unknown action type: ${spec.type}`);
  }

}

/** Recompute + persist a contact's lead score (used after agent activity). */
export async function refreshLeadScore(contactId: string) {
  try {
    const score = await computeLeadScore(contactId);
    await prisma.contact.update({ where: { id: contactId }, data: { leadScore: score } });
  } catch { /* scoring is best-effort */ }
}
