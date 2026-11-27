/**
 * Scheduled Posts — minutely sweep/broadcast logic (spec §6).
 *
 * Pure module: all effects arrive as injected dependencies (D1
 * database, publisher function, clock) so vitest covers the claim /
 * recovery / retry logic without relays or real D1. The worker entry
 * (index.js) wires the real deps.
 *
 * LATE-BY-DESIGN: cron granularity is one minute, so publishes land
 * 0–60 s after publish_at, and the broadcast event's created_at is
 * therefore slightly in the past. That is normal, valid Nostr, and
 * fine — do not "fix" it. Same for retries: relays accept past
 * timestamps, so retrying within 24 h of publish_at is correct.
 */

import { importScheduleKey, decryptScheduledEvent } from '../../src/lib/scheduleCrypto.server';
import { storedScheduleRelays } from '../../src/lib/scheduleRelays';

export const PANTRY_RELAY = 'wss://pantry.zap.cooking';

/**
 * Relays every 'all'-mode row is broadcast to, whatever the client
 * sent. Chosen because they accept a note from a keyless publisher:
 * no NIP-42 auth, no payment, no kind allowlist (NIP-11 and relay
 * docs, checked 2026-11-23). Deliberately NOT the app's standardRelays:
 * of those four, purplepag.es stores only profiles and relay lists and
 * nostr.wine is a paid relay, so neither would ever take a scheduled
 * note. With MAX_SCHEDULE_RELAYS client relays this list must fit the
 * Workers connection limit (src/lib/scheduleRelays.ts).
 */
export const SCHEDULER_FLOOR_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net'];

/** Rows swept per tick. */
export const SWEEP_BATCH_LIMIT = 20;
/** A 'publishing' claim older than this is from a dead tick — recover it. */
export const CLAIM_STALE_SECONDS = 300;
/** Terminal failure: this many attempts, or… */
export const MAX_ATTEMPTS = 10;
/** …still unsent this long after publish_at. */
export const RETRY_WINDOW_SECONDS = 86400;
/** Wall-clock budget per tick (leave headroom under Workers' 30 s). */
export const TICK_BUDGET_SECONDS = 25;

/**
 * How long one row's broadcast may wait (publishEventRaw's early
 * settle; index.js passes these as SWEEP_PUBLISH_OPTIONS).
 *
 * Rows are published one after another against TICK_BUDGET_SECONDS,
 * and client-supplied relays can be dead. Without these a single
 * relay that never answers costs the full 10 s per-relay timeout on
 * every row that names it, about 2 rows a tick, and delays every row
 * behind it. Cost per row, and rows that fit in a 25 s tick:
 *
 *   every relay answers             well under 1 s      all 20
 *   one accepts, another is silent  first OK + grace,   about 10
 *                                   about 2.3 s
 *   nothing answers                 the hard cap, 6 s   4 to 5
 *
 * GRACE 2 s: a full batch in which every row names a dead relay takes
 * two ticks, so its tail is one minute later. 1 s would fit ~19 rows
 * but abandons slow healthy relays mid-handshake, and those then
 * never get the note; delivery to the author's own relays is worth
 * more than that worst case.
 *
 * CAP 6 s: below the 10 s per-relay timeout (or it does nothing) and
 * above a slow TLS handshake plus OK. It applies only when no relay
 * has accepted, in practice when both floor relays are unreachable.
 *
 * A row that starts just inside the budget can finish ~6 s past it.
 * That is safe: scheduled Workers get 15 minutes of wall time and a
 * claim is not treated as stale for CLAIM_STALE_SECONDS.
 */
export const PUBLISH_GRACE_AFTER_FIRST_OK_MS = 2000;
export const PUBLISH_HARD_CAP_MS = 6000;
export const SWEEP_PUBLISH_OPTIONS = {
  graceAfterFirstOkMs: PUBLISH_GRACE_AFTER_FIRST_OK_MS,
  hardCapMs: PUBLISH_HARD_CAP_MS
} as const;

/**
 * Relay set for a row. 'pantry' is the pantry relay alone and ignores
 * the row's relays. 'all' is the floor relays followed by the row's
 * own relays (the `relays` column, re-validated and capped on the way
 * out), without duplicates; a row with none gets the floor only. The
 * floor comes first so it is never the part left waiting in the
 * connection queue.
 */
export function relaysFor(relayMode: string, rowRelays?: string | null): string[] {
  if (relayMode === 'pantry') return [PANTRY_RELAY];
  const targets = [...SCHEDULER_FLOOR_RELAYS];
  for (const url of storedScheduleRelays(rowRelays)) {
    if (!targets.includes(url)) targets.push(url);
  }
  return targets;
}

interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}

interface DueRow {
  id: string;
  publish_at: number;
  relay_mode: string;
  relays: string | null;
  ciphertext: string;
  iv: string;
}

export interface SweepDeps {
  db: D1Like;
  /** 64-hex-char SCHEDULE_ENC_KEY — same secret the Pages API encrypts with. */
  encKeyHex: string;
  /**
   * Broadcast one signed event to a relay set; resolves to the number
   * of relays that accepted (OK true). ≥1 counts as sent.
   */
  publish: (event: unknown, relays: string[]) => Promise<number>;
  /** Unix-seconds clock, injectable for tests. */
  clock?: () => number;
  budgetSeconds?: number;
}

export interface SweepSummary {
  recovered: number;
  due: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}

export async function sweepDueEvents(deps: SweepDeps): Promise<SweepSummary> {
  const { db, encKeyHex, publish } = deps;
  const clock = deps.clock ?? (() => Math.floor(Date.now() / 1000));
  const deadline = clock() + (deps.budgetSeconds ?? TICK_BUDGET_SECONDS);
  const summary: SweepSummary = { recovered: 0, due: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };

  // 1. Recovery FIRST: claims from a tick that died mid-broadcast
  // expire after 5 minutes and go back in the queue.
  const now0 = clock();
  const recovered = await db
    .prepare(
      "UPDATE scheduled_events SET status = 'pending', updated_at = ?1 WHERE status = 'publishing' AND updated_at < ?2"
    )
    .bind(now0, now0 - CLAIM_STALE_SECONDS)
    .run();
  summary.recovered = recovered.meta?.changes ?? 0;

  // 2. Due rows, oldest first.
  const { results: due } = await db
    .prepare(
      `SELECT id, publish_at, relay_mode, relays, ciphertext, iv
         FROM scheduled_events
        WHERE status = 'pending' AND publish_at <= ?1
        ORDER BY publish_at
        LIMIT ${SWEEP_BATCH_LIMIT}`
    )
    .bind(clock())
    .all<DueRow>();
  summary.due = due.length;
  if (due.length === 0) return summary;

  const key = await importScheduleKey(encKeyHex);

  for (const row of due) {
    if (clock() > deadline) {
      console.warn(`[Sweep] tick budget exhausted with ${summary.due - summary.skipped - summary.sent - summary.retried - summary.failed} rows left`);
      break;
    }

    // 3. Atomic per-row claim. changes === 0 means another sweep took
    // it or the owner cancelled it between our SELECT and now — skip
    // silently. This check is the cancel-vs-sweep safety; never batch.
    const claim = await db
      .prepare(
        "UPDATE scheduled_events SET status = 'publishing', updated_at = ?2 WHERE id = ?1 AND status = 'pending'"
      )
      .bind(row.id, clock())
      .run();
    if ((claim.meta?.changes ?? 0) !== 1) {
      summary.skipped++;
      continue;
    }

    // 4. Decrypt. Failure is a recorded attempt (last_error =
    // 'decrypt_failed'), not a hot retry loop — the attempts cap and
    // 24 h window will eventually park an undecryptable row in
    // 'failed'.
    let signedEvent: unknown;
    try {
      signedEvent = JSON.parse(await decryptScheduledEvent(key, row.ciphertext, row.iv));
    } catch {
      await recordFailedAttempt(db, row.id, 'decrypt_failed', clock(), summary);
      continue;
    }

    // 5–6. Broadcast; ≥1 relay accepting means sent.
    let okCount = 0;
    let lastError = 'no_relay_accepted';
    try {
      okCount = await publish(signedEvent, relaysFor(row.relay_mode, row.relays));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 500) : 'publish_error';
    }

    if (okCount >= 1) {
      const now = clock();
      await db
        .prepare(
          "UPDATE scheduled_events SET status = 'sent', sent_at = ?2, updated_at = ?2 WHERE id = ?1"
        )
        .bind(row.id, now)
        .run();
      summary.sent++;
    } else {
      await recordFailedAttempt(db, row.id, lastError, clock(), summary);
    }
  }

  return summary;
}

/**
 * 7. Failed attempt: attempts += 1 (SQL-side, so a competing sweep's
 * increment between our read and write can't be lost), back to
 * 'pending' for the next tick — unless the attempts cap or the 24 h
 * retry window says the row is terminally 'failed'.
 */
async function recordFailedAttempt(
  db: D1Like,
  id: string,
  lastError: string,
  now: number,
  summary: SweepSummary
): Promise<void> {
  await db
    .prepare(
      `UPDATE scheduled_events
          SET attempts = attempts + 1,
              last_error = ?2,
              updated_at = ?3,
              status = CASE
                WHEN attempts + 1 >= ${MAX_ATTEMPTS} OR ?3 > publish_at + ${RETRY_WINDOW_SECONDS}
                THEN 'failed' ELSE 'pending'
              END
        WHERE id = ?1`
    )
    .bind(id, lastError, now)
    .run();

  const after = await db
    .prepare('SELECT status FROM scheduled_events WHERE id = ?1')
    .bind(id)
    .first<{ status: string }>();
  if (after?.status === 'failed') summary.failed++;
  else summary.retried++;
}
