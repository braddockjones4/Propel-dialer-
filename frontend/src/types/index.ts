// ─── Call Status ─────────────────────────────────────────────────────────────
export type DeviceStatus = 'uninitialized' | 'loading' | 'ready' | 'error';

export type CallStatus =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'in-call'
  | 'completed'
  | 'failed';

// ─── Disposition ─────────────────────────────────────────────────────────────
export type DispositionType =
  | 'not-home'
  | 'left-voicemail'
  | 'callback-scheduled'
  | 'not-interested'
  | 'wrong-number'
  | 'dnc'
  | 'hot-lead';

export interface Disposition {
  type: DispositionType;
  label: string;
  color: string;
  emoji: string;
  description: string;
}

// ─── Contact / Prospect ──────────────────────────────────────────────────────
export interface Contact {
  id: string;
  // DB fields
  firstName?: string;
  lastName?: string;
  // Legacy / computed
  name: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  source: 'expired' | 'fsbo' | 'circle' | 'past-client' | 'manual';
  status?: string;
  notes?: string;
  lastCalledAt?: string;
  disposition?: DispositionType;
  leadScore?: number;
  email?: string;
}

// ─── Call Record ─────────────────────────────────────────────────────────────
export interface CallRecord {
  id: string;
  contactId: string;
  startedAt: string;
  duration?: number;
  status: CallStatus;
  disposition?: DispositionType;
  notes?: string;
  recordingUrl?: string;
}
