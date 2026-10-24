/**
 * Daily account-deletion digest — the push half of the staff queue.
 *
 * A deletion request lands as a row in SCHEDULER_DB. A row nobody reads
 * means a member who deleted their account can keep being charged by an
 * older Stripe subscription our metadata search could not find. So the
 * daily cron DMs the admin account (NIP-04, the same channel the
 * membership notifications and /api/cron/test-notification use) for as
 * long as ANY request is pending, and it keeps doing that until each one
 * is marked completed at /admin/deletion-requests. It is a daily nag by
 * design, not a one-shot alert that can be missed once and lost.
 *
 * The message carries counts and a link, never pubkeys.
 *
 * Published with publishEventRaw, the workerd-safe publisher the
 * scheduled-posts sweep already relies on (nostr-tools' pool drops
 * frames in the Workers runtime).
 */

import { finalizeEvent, nip04, nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';

export const DIGEST_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://purplepag.es'
];

export const ADMIN_URL = 'https://zap.cooking/admin/deletion-requests';

const DAY = 86400;
const DUE_DAYS = 30;

export interface PendingRow {
  billing: string;
  requested_at: number;
}

interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> };
  };
}

export interface DigestDeps {
  db: D1Like;
  /** Hex or nsec. The notification service account's key. */
  senderKey: string | undefined;
  recipientPubkey: string;
  publish: (event: any, relays: string[]) => Promise<number>;
  now?: number;
}

/** The digest text, or null when nothing is pending. Pure, for tests. */
export function buildDigest(rows: PendingRow[], now: number): string | null {
  if (rows.length === 0) return null;
  const daysLeft = (r: PendingRow) => Math.ceil((r.requested_at + DUE_DAYS * DAY - now) / DAY);
  const stripe = rows.filter((r) => r.billing !== 'cancelled').length;
  const overdue = rows.filter((r) => daysLeft(r) < 0).length;
  const soon = rows.filter((r) => daysLeft(r) >= 0 && daysLeft(r) <= 7).length;

  const lines = [
    `🗑 ${rows.length} account deletion request${rows.length === 1 ? '' : 's'} pending.`
  ];
  if (stripe > 0) {
    lines.push(
      `⚠️ ${stripe} need${stripe === 1 ? 's' : ''} a manual Stripe check. Renewal was not confirmed stopped, so the member may still be charged.`
    );
  }
  if (overdue > 0) lines.push(`🔴 ${overdue} past the 30-day deadline.`);
  if (soon > 0) lines.push(`🟠 ${soon} due within 7 days.`);
  lines.push(`Review and mark completed: ${ADMIN_URL}`);
  return lines.join('\n');
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

export type DigestResult = 'sent' | 'nothing-pending' | 'no-sender-key';

export async function runDeletionDigest(deps: DigestDeps): Promise<DigestResult> {
  const now = deps.now ?? Math.floor(Date.now() / 1000);
  const { results } = await deps.db
    .prepare(
      "SELECT billing, requested_at FROM account_deletion_requests WHERE status = ? ORDER BY requested_at"
    )
    .bind('pending')
    .all<PendingRow>();

  const message = buildDigest(results, now);
  if (!message) return 'nothing-pending';

  // Checked after the query on purpose: a missing secret only matters
  // when there is something to report, and then it must be loud.
  if (!deps.senderKey) return 'no-sender-key';

  const sk = senderKeyBytes(deps.senderKey);
  const content = nip04.encrypt(sk, deps.recipientPubkey, message);
  const event = finalizeEvent(
    { kind: 4, created_at: now, tags: [['p', deps.recipientPubkey]], content },
    sk
  );
  // Throws when no relay accepts — the caller logs it, and tomorrow's
  // tick tries again because the rows are still pending.
  await deps.publish(event, DIGEST_RELAYS);
  return 'sent';
}
