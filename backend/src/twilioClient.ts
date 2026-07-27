/**
 * Twilio credential resolution.
 *
 * All calls go through the app owner's Twilio account (env vars).
 * Per-user Twilio credentials have been removed — clients never set up Twilio.
 * Personal phone number (for bridge mode) is stored in DialerSettings.personalPhone.
 */

import twilio from 'twilio';
import prisma from './db';

export interface TwilioCreds {
  accountSid:  string;
  authToken:   string;
  apiKey:      string;
  apiSecret:   string;
  twimlAppSid: string;
  callerId:    string;
  agentName:   string;
  agentPhone:  string;
}

/** Resolve Twilio credentials — always env vars, never per-user DB fields. */
export async function getTwilioCreds(userId?: string | null): Promise<TwilioCreds> {
  // agentPhone: user's personal phone for bridge mode (from DialerSettings)
  let agentPhone = process.env.AGENT_PHONE ?? process.env.TWILIO_CALLER_ID ?? '';
  if (userId) {
    const s = await prisma.dialerSettings.findUnique({ where: { userId } }).catch(() => null) as any;
    if (s?.personalPhone) agentPhone = s.personalPhone;
  }

  // .trim() everything — a single invisible space or newline pasted into an
  // env var produces Twilio 401s that are miserable to diagnose.
  return {
    accountSid:  (process.env.TWILIO_ACCOUNT_SID   ?? '').trim(),
    authToken:   (process.env.TWILIO_AUTH_TOKEN     ?? '').trim(),
    apiKey:      (process.env.TWILIO_API_KEY        ?? '').trim(),
    apiSecret:   (process.env.TWILIO_API_SECRET     ?? '').trim(),
    twimlAppSid: (process.env.TWILIO_TWIML_APP_SID ?? '').trim(),
    callerId:    (process.env.TWILIO_CALLER_ID      ?? '').trim(),
    agentName:   (process.env.AGENT_NAME            ?? 'Agent').trim(),
    agentPhone:  agentPhone.trim(),
  };
}

/** Get a Twilio REST client + resolved credentials. */
export async function getTwilioClient(userId?: string | null) {
  const creds = await getTwilioCreds(userId);
  if (!creds.accountSid || !creds.authToken) {
    throw new Error('Twilio is not configured. Contact support.');
  }
  return { client: twilio(creds.accountSid, creds.authToken), creds };
}

/** Always true — Twilio is owned by the app, not the user. */
export async function hasTwilioCreds(_userId: string): Promise<boolean> {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}
