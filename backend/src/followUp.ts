// ─── Follow-Up Engine ─────────────────────────────────────────────────────────
// Sends automated SMS follow-ups based on call outcomes.

import twilio from 'twilio';
import { getSequenceByTrigger, SequenceTrigger } from './sequenceStore';
import { getAgentName } from './agent/settings';

// Stub — in production this comes from your CRM/contacts database
export interface ContactContext {
  firstName: string;
  fullName: string;
  address: string;
  phone: string; // prospect's phone
}

async function getAgentContext() {
  return {
    agentName: await getAgentName(),
    agentPhone: process.env.AGENT_PHONE || process.env.TWILIO_CALLER_ID || '',
  };
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/{{(\w+)}}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

export async function runFollowUpSequence(
  _trigger: SequenceTrigger,
  _contact: ContactContext
): Promise<void> {
  // SMS follow-ups disabled
}
