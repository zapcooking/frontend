/**
 * Go live — DMs to the admin: real-time report alerts and hosting access
 * requests.
 *
 * The channel is the one the deletion digest and the membership notices
 * already use: a NIP-04 DM from the notification account
 * (NOTIFICATION_PRIVATE_KEY) to ADMIN_PUBKEY, published with the
 * workerd-safe raw publisher (nostr-tools' pool drops frames in the
 * Workers runtime).
 *
 * A report alert carries the reason, the stream's title and links.
 * Nothing about the reporter: no IP, no key, not even the note they wrote
 * (it is on /admin/live). Throttle: at most one alert per session every
 * LIVE_REPORT_ALERT_THROTTLE_SECONDS, by a KV key; an urgent report
 * (child safety, violence) is never throttled.
 */
import { finalizeEvent, nip04, nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import {
  LIVE_REPORT_ALERT_THROTTLE_SECONDS,
  LIVE_URGENT_REASONS,
  type LiveReportReason
} from './config';

/** Same relays as the deletion digest, which the admin already reads DMs from. */
export const ALERT_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://purplepag.es'
];

/** The throttle key's name; the route makes it per environment with liveKv(). */
export const alertThrottleName = (sessionId: string) => `alert:${sessionId}`;

const REASON_LABELS: Record<LiveReportReason, string> = {
  child_safety: 'Child safety',
  nudity: 'Nudity or sexual content',
  violence: 'Violence or immediate danger',
  spam: 'Spam or a scam',
  other: 'Something else'
};

export interface ReportAlertInput {
  sessionId: string;
  title: string;
  reason: LiveReportReason;
  /** True when a comment was reported rather than the stream itself. */
  comment: boolean;
  /** Site origin for the links, e.g. https://zap.cooking (previews link to themselves). */
  origin: string;
  /**
   * The report could not be stored (LIVE_REPORTER_HASH_SECRET missing):
   * this DM is its only record. Never throttled.
   */
  notStored?: boolean;
}

/** The report alert text. Pure, for tests. */
export function buildReportAlert(input: ReportAlertInput): string {
  const what = input.comment ? 'a comment on a live stream' : 'a live stream';
  const first =
    input.reason === 'child_safety'
      ? `🚨 CHILD SAFETY report on ${what}. Review now.`
      : input.reason === 'violence'
        ? `🚨 VIOLENCE / IMMEDIATE DANGER report on ${what}. Review now.`
        : `🚩 Report on ${what}: ${REASON_LABELS[input.reason]}.`;
  return [
    ...(input.notStored
      ? ['⚠️ NOT STORED: LIVE_REPORTER_HASH_SECRET is missing. This DM is the only record.']
      : []),
    first,
    `"${input.title}"`,
    `Watch: ${input.origin}/live/s/${input.sessionId}`,
    `Review, end or block: ${input.origin}/admin/live`
  ].join('\n');
}

export interface AccessRequestInput {
  pubkey: string;
  /** The requester's note ("what you'd cook, how often"), may be empty. */
  note: string;
  /** Requests pending in the queue, this one included. */
  pending: number;
  origin: string;
}

/** The access request text. Pure, for tests. */
export function buildAccessRequest(input: AccessRequestInput): string {
  const npub = nip19.npubEncode(input.pubkey);
  const lines = [
    `🎥 New Go live access request (${input.pending} pending)`,
    npub,
    `Profile: ${input.origin}/user/${npub}`
  ];
  if (input.note) lines.push(`Note: "${input.note}"`);
  lines.push(`Review: ${input.origin}/admin/live`);
  return lines.join('\n');
}

export interface AdminDmDeps {
  /** Hex or nsec. The notification service account's key. */
  senderKey: string | undefined;
  recipientPubkey: string;
  publish: (event: any, relays: string[]) => Promise<number>;
  now?: number;
}

function senderKeyBytes(key: string): Uint8Array {
  if (key.startsWith('nsec1')) {
    const decoded = nip19.decode(key);
    if (decoded.type !== 'nsec') throw new Error('sender key is not an nsec');
    return decoded.data;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('sender key must be 64 hex chars or nsec');
  return hexToBytes(key);
}

export type AdminDmResult = 'sent' | 'no-sender-key' | 'failed';

/** Encrypt and publish one DM to the admin. Never throws. */
export async function sendAdminDm(text: string, deps: AdminDmDeps): Promise<AdminDmResult> {
  try {
    if (!deps.senderKey) {
      console.error('[Live] admin DM not sent: NOTIFICATION_PRIVATE_KEY is not set');
      return 'no-sender-key';
    }
    const now = deps.now ?? Math.floor(Date.now() / 1000);
    const sk = senderKeyBytes(deps.senderKey);
    const content = nip04.encrypt(sk, deps.recipientPubkey, text);
    const event = finalizeEvent(
      { kind: 4, created_at: now, tags: [['p', deps.recipientPubkey]], content },
      sk
    );
    await deps.publish(event, ALERT_RELAYS);
    return 'sent';
  } catch (err) {
    console.error(`[Live] admin DM failed: ${(err as Error)?.message ?? 'error'}`);
    return 'failed';
  }
}

interface AlertKV {
  get(key: string, type?: 'text'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export type ReportAlertResult = AdminDmResult | 'throttled';

/** Send the report alert, unless throttled. Never throws. */
export async function sendReportAlert(
  input: ReportAlertInput,
  deps: AdminDmDeps & {
    kv: AlertKV | null | undefined;
    /** Full KV key of this session's throttle in this environment (liveKv). */
    throttleKey: string;
  }
): Promise<ReportAlertResult> {
  const throttleKey = deps.throttleKey;
  const urgent = LIVE_URGENT_REASONS.includes(input.reason) || input.notStored === true;
  if (!urgent && deps.kv) {
    try {
      if (await deps.kv.get(throttleKey, 'text')) return 'throttled';
    } catch {
      // A KV read failure must not swallow the alert: send it.
    }
  }
  const result = await sendAdminDm(buildReportAlert(input), deps);
  if (result === 'sent' && deps.kv) {
    try {
      await deps.kv.put(throttleKey, '1', { expirationTtl: LIVE_REPORT_ALERT_THROTTLE_SECONDS });
    } catch {
      // Worst case a burst sends a few more DMs; never fail the alert for it.
    }
  }
  return result;
}
