/**
 * Go live — real-time report alert to the admin.
 *
 * A report on a Go live stream (or on one of its comments) DMs the admin
 * account at once, so a stream can be ended while it is still live. The
 * channel is the one the deletion digest and the membership notices
 * already use: a NIP-04 DM from the notification account
 * (NOTIFICATION_PRIVATE_KEY) to ADMIN_PUBKEY, published with the
 * workerd-safe raw publisher (nostr-tools' pool drops frames in the
 * Workers runtime).
 *
 * The message carries the reason, the stream's title and links. Nothing
 * about the reporter: no IP, no key, not even the free text they wrote
 * (it is in the review queue).
 *
 * Throttle: at most one DM per session every
 * LIVE_REPORT_ALERT_THROTTLE_SECONDS, by a KV key. A child-safety report
 * is never throttled.
 */
import { finalizeEvent, nip04, nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import { LIVE_REPORT_ALERT_THROTTLE_SECONDS } from './config';

/** Same relays as the deletion digest, which the admin already reads DMs from. */
export const ALERT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://purplepag.es'
];

export const ALERT_THROTTLE_PREFIX = 'live:alert:';

export const CHILD_SAFETY_REASON = 'child_safety';

const REASON_LABELS: Record<string, string> = {
  child_safety: 'Child safety',
  nsfw: 'Nudity or sexual content',
  spam: 'Spam or a scam',
  other: 'Something else'
};

export interface ReportAlertInput {
  sessionId: string;
  title: string;
  reason: string;
  /** True when a comment was reported rather than the stream itself. */
  comment: boolean;
  /** Site origin for the links, e.g. https://zap.cooking (previews link to themselves). */
  origin: string;
}

/** The DM text. Pure, for tests. */
export function buildReportAlert(input: ReportAlertInput): string {
  const label = REASON_LABELS[input.reason] ?? input.reason;
  const urgent = input.reason === CHILD_SAFETY_REASON;
  const what = input.comment ? 'a comment on a live stream' : 'a live stream';
  return [
    urgent
      ? `🚨 CHILD SAFETY report on ${what}. Review now.`
      : `🚩 Report on ${what}: ${label}.`,
    `"${input.title}"`,
    `Watch: ${input.origin}/live/s/${input.sessionId}`,
    `End or block the host: ${input.origin}/admin/live`
  ].join('\n');
}

interface AlertKV {
  get(key: string, type?: 'text'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface ReportAlertDeps {
  kv: AlertKV | null | undefined;
  /** Hex or nsec. The notification service account's key. */
  senderKey: string | undefined;
  recipientPubkey: string;
  publish: (event: any, relays: string[]) => Promise<number>;
  now?: number;
}

export type ReportAlertResult = 'sent' | 'throttled' | 'no-sender-key' | 'failed';

function senderKeyBytes(key: string): Uint8Array {
  if (key.startsWith('nsec1')) {
    const decoded = nip19.decode(key);
    if (decoded.type !== 'nsec') throw new Error('sender key is not an nsec');
    return decoded.data;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('sender key must be 64 hex chars or nsec');
  return hexToBytes(key);
}

/** Send the alert, unless throttled. Never throws. */
export async function sendReportAlert(
  input: ReportAlertInput,
  deps: ReportAlertDeps
): Promise<ReportAlertResult> {
  try {
    if (!deps.senderKey) {
      console.error('[Live] report alert not sent: NOTIFICATION_PRIVATE_KEY is not set');
      return 'no-sender-key';
    }
    const throttleKey = ALERT_THROTTLE_PREFIX + input.sessionId;
    const urgent = input.reason === CHILD_SAFETY_REASON;
    if (!urgent && deps.kv) {
      try {
        if (await deps.kv.get(throttleKey, 'text')) return 'throttled';
      } catch {
        // A KV read failure must not swallow the alert: send it.
      }
    }

    const now = deps.now ?? Math.floor(Date.now() / 1000);
    const sk = senderKeyBytes(deps.senderKey);
    const content = nip04.encrypt(sk, deps.recipientPubkey, buildReportAlert(input));
    const event = finalizeEvent(
      { kind: 4, created_at: now, tags: [['p', deps.recipientPubkey]], content },
      sk
    );
    await deps.publish(event, ALERT_RELAYS);

    if (deps.kv) {
      try {
        await deps.kv.put(throttleKey, '1', {
          expirationTtl: LIVE_REPORT_ALERT_THROTTLE_SECONDS
        });
      } catch {
        // Worst case a burst sends a few more DMs; never fail the alert for it.
      }
    }
    return 'sent';
  } catch (err) {
    console.error(`[Live] report alert failed: ${(err as Error)?.message ?? 'error'}`);
    return 'failed';
  }
}
