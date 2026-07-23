/**
 * Per-user Twilio credential resolution.
 *
 * Every route that calls Twilio should use getTwilioClient(userId) instead of
 * reading process.env directly. This allows each realtor client to run under
 * their own Twilio account on the same deployment.
 *
 * Resolution order:
 *   1. User's own credentials in DialerSettings (twilioAccountSid, etc.)
 *   2. Fall back to env vars (Braddock's account / deployment default)
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

/** Resolve Twilio credentials for a given userId (or fall back to env vars). */
export async function getTwilioCreds(userId?: string | null): Promise<TwilioCreds> {
  if (userId) {
    const s = await prisma.dialerSettings.findUnique({ where: { userId } }).catch(() => null) as any;
    if (s?.twilioAccountSid && s?.twilioAuthToken) {
      return {
        accountSid:  s.twilioAccountSid,
        authToken:   s.twilioAuthToken,
        apiKey:      s.twilioApiKey      ?? process.env.TWILIO_API_KEY      ?? '',
        apiSecret:   s.twilioApiSecret   ?? process.env.TWILIO_API_SECRET   ?? '',
        twimlAppSid: s.twilioTwimlAppSid ?? process.env.TWILIO_TWIML_APP_SID ?? '',
        callerId:    s.twilioCallerId    ?? process.env.TWILIO_CALLER_ID    ?? '',
        agentName:   s.agentName         ?? process.env.AGENT_NAME          ?? 'Agent',
        agentPhone:  s.twilioCallerId    ?? s.personalPhone ?? process.env.AGENT_PHONE ?? '',
      };
    }
  }

  // Default: deployment-level env vars
  return {
    accountSid:  process.env.TWILIO_ACCOUNT_SID   ?? '',
    authToken:   process.env.TWILIO_AUTH_TOKEN     ?? '',
    apiKey:      process.env.TWILIO_API_KEY        ?? '',
    apiSecret:   process.env.TWILIO_API_SECRET     ?? '',
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID ?? '',
    callerId:    process.env.TWILIO_CALLER_ID      ?? '',
    agentName:   process.env.AGENT_NAME            ?? 'Agent',
    agentPhone:  process.env.AGENT_PHONE ?? process.env.TWILIO_CALLER_ID ?? '',
  };
}

/** Get a Twilio REST client + resolved credentials for a user. */
export async function getTwilioClient(userId?: string | null) {
  const creds = await getTwilioCreds(userId);
  if (!creds.accountSid || !creds.authToken) {
    throw new Error('Twilio credentials not configured. Please add them in Settings → Twilio Setup.');
  }
  return { client: twilio(creds.accountSid, creds.authToken), creds };
}

/** Check whether a user has their own Twilio credentials configured. */
export async function hasTwilioCreds(userId: string): Promise<boolean> {
  const s = await prisma.dialerSettings.findUnique({ where: { userId } }).catch(() => null);
  return !!((s as any)?.twilioAccountSid && (s as any)?.twilioAuthToken);
}
