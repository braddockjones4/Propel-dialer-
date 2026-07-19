import { useState, useEffect, useRef, useCallback } from 'react';
import { Device, Call } from '@twilio/voice-sdk';
import type { DeviceStatus, CallStatus } from '../types';
import { API_BASE, authFetch } from '../config';

export interface IncomingCallState {
  call: Call;
  from: string;
}

interface UseTwilioDeviceReturn {
  deviceStatus: DeviceStatus;
  callStatus: CallStatus;
  activeCall: Call | null;
  callDuration: number;
  incomingCall: IncomingCallState | null;
  startCall: (phoneNumber: string, callerId?: string, sessionId?: string, confName?: string) => Promise<void>;
  acceptIncomingCall: () => void;
  rejectIncomingCall: () => void;
  endCall: () => void;
  muteCall: (muted: boolean) => void;
  resetCallStatus: () => void;
  isMuted: boolean;
  errorMessage: string | null;
}


export function useTwilioDevice(): UseTwilioDeviceReturn {
  const deviceRef = useRef<Device | null>(null);
  const activeCallRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('uninitialized');
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // L4: pending incoming call — UI decides whether to accept or reject
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);
  const incomingCallRef = useRef<Call | null>(null);

  // ─── Initialize Twilio Device on mount ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function initDevice() {
      setDeviceStatus('loading');
      setErrorMessage(null);

      try {
        const res = await authFetch(`${API_BASE}/twilio/token`, {
          method: 'POST',
          body: JSON.stringify({ identity: 'agent' }),
        });

        if (!res.ok) throw new Error('Failed to fetch Twilio token from backend.');

        const { token } = await res.json();
        if (cancelled) return;

        const device = new Device(token, {
          codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
          closeProtection: true,
        });

        device.on('registered', () => {
          if (!cancelled) setDeviceStatus('ready');
        });

        device.on('error', (err) => {
          // 31005 = "Error sent from gateway in HANGUP" — fires on normal call end, safe to ignore
          if (err?.code === 31005) return;
          console.error('Twilio Device error:', err);
          if (!cancelled) {
            setDeviceStatus('error');
            setErrorMessage(err.message || 'Device error occurred.');
          }
        });

        device.on('incoming', (call: Call) => {
          // L4: surface to UI instead of auto-accepting
          const from = call.parameters?.From || 'Unknown';
          incomingCallRef.current = call;
          setIncomingCall({ call, from });
          // If the caller hangs up before agent answers, clear the prompt
          call.on('cancel', () => {
            incomingCallRef.current = null;
            setIncomingCall(null);
          });
        });

        await device.register();
        deviceRef.current = device;
      } catch (err: unknown) {
        if (!cancelled) {
          console.error('initDevice caught error:', err);
          let message = 'Failed to initialize dialer.';
          if (err instanceof Error) {
            message = err.message;
          } else if (err && typeof err === 'object' && 'message' in err) {
            message = String((err as { message: unknown }).message);
          } else if (typeof err === 'string') {
            message = err;
          }
          setDeviceStatus('error');
          setErrorMessage(message);
        }
      }
    }

    initDevice();

    return () => {
      cancelled = true;
      deviceRef.current?.destroy();
      deviceRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ─── Bind Call Events ───────────────────────────────────────────────────────
  const bindCallEvents = useCallback((call: Call) => {
    activeCallRef.current = call;
    setActiveCall(call);
    setCallStatus('connecting');
    setCallDuration(0);
    setIsMuted(false);

    call.on('ringing', () => setCallStatus('ringing'));

    call.on('accept', () => {
      setCallStatus('in-call');
      timerRef.current = setInterval(() => {
        setCallDuration((d) => d + 1);
      }, 1000);
    });

    call.on('disconnect', () => {
      setCallStatus('completed');
      setActiveCall(null);
      activeCallRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    });

    call.on('cancel', () => {
      setCallStatus('idle');
      setActiveCall(null);
      activeCallRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    });

    call.on('error', (err) => {
      // 31005 fires on normal hangup from the remote side — not a real error
      if (err?.code === 31005) return;
      console.error('Call error:', err);
      setCallStatus('failed');
      setErrorMessage(err.message || 'Call error.');
      setActiveCall(null);
      activeCallRef.current = null;
    });
  }, []);

  // ─── Accept / Reject Incoming Call ─────────────────────────────────────────
  const acceptIncomingCall = useCallback(() => {
    const call = incomingCallRef.current;
    if (!call) return;
    incomingCallRef.current = null;
    setIncomingCall(null);
    bindCallEvents(call);
    call.accept();
  }, [bindCallEvents]);

  const rejectIncomingCall = useCallback(() => {
    incomingCallRef.current?.reject();
    incomingCallRef.current = null;
    setIncomingCall(null);
  }, []);

  // ─── Start Call ─────────────────────────────────────────────────────────────
  const startCall = useCallback(async (
    phoneNumber: string,
    callerId?: string,
    sessionId?: string,
    confName?: string,
  ) => {
    if (!deviceRef.current || deviceStatus !== 'ready') {
      setErrorMessage('Dialer not ready. Please wait or refresh.');
      return;
    }
    if (callStatus !== 'idle' && callStatus !== 'completed') {
      return; // Already in a call
    }

    setErrorMessage(null);

    try {
      let params: Record<string, string>;

      if (sessionId && confName) {
        // Bridge / conference mode: browser joins a named Twilio conference.
        // Backend already created the outbound call to contact via REST API with AMD.
        params = { SessionId: sessionId, ConfName: confName };
      } else if (sessionId) {
        // Live-audio WebRTC mode: browser dials through a <Dial> TwiML response.
        // Agent hears ringing, voicemail greeting, and their recorded message drop.
        // Voice webhook detects SessionId without ConfName → uses asyncAmd <Dial> path.
        params = { SessionId: sessionId };
      } else {
        // Legacy direct-dial mode (used for inbound calls / fallback)
        params = { To: phoneNumber };
        if (callerId) params.CallerId = callerId;
      }

      const call = await deviceRef.current.connect({ params });
      bindCallEvents(call);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to place call.';
      setCallStatus('failed');
      setErrorMessage(message);
    }
  }, [deviceStatus, callStatus, bindCallEvents]);

  // ─── End Call ───────────────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    activeCallRef.current?.disconnect();
  }, []);

  // ─── Reset status ────────────────────────────────────────────────────────────
  // Call this when advancing to the next contact so callStatus doesn't bleed over.
  const resetCallStatus = useCallback(() => {
    setCallStatus('idle');
    setCallDuration(0);
  }, []);

  // ─── Mute Call ──────────────────────────────────────────────────────────────
  const muteCall = useCallback((muted: boolean) => {
    activeCallRef.current?.mute(muted);
    setIsMuted(muted);
  }, []);

  return {
    deviceStatus,
    callStatus,
    activeCall,
    callDuration,
    incomingCall,
    startCall,
    acceptIncomingCall,
    rejectIncomingCall,
    endCall,
    muteCall,
    resetCallStatus,
    isMuted,
    errorMessage,
  };
}
