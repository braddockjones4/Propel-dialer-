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
  trigger: SequenceTrigger,
  contact: ContactContext
): Promise<void> {
  const sequence = getSequenceByTrigger(trigger);
  if (!sequence) {
    console.log(`[Follow-up] No enabled sequence for trigger: ${trigger}`);
    return;
  }

  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  const vars = {
    firstName: contact.firstName,
    fullName: contact.fullName,
    address: contact.address,
    ...await getAgentContext(),
  };

  for (const step of sequence.steps) {
    const message = renderTemplate(step.message, vars);
    const delayMs = step.delayMinutes * 60 * 1000;

    const send = async () => {
      try {
        await client.messages.create({
          body: message,
          from: process.env.TWILIO_CALLER_ID!,
          to: contact.phone,
        });
        console.log(
          `[Follow-up] Sent SMS (${trigger}, +${step.delayMinutes}min) to ${contact.phone}`
        );
      } catch (err) {
        console.error(`[Follow-up] SMS failed:`, err);
      }
    };

    if (delayMs === 0) {
      await send();
    } else {
      setTimeout(send, delayMs);
      console.log(
        `[Follow-up] Scheduled SMS (${trigger}, +${step.delayMinutes}min) to ${contact.phone}`
      );
    }
  }
}
