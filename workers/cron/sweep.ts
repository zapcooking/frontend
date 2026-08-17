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
import { standardRelays } from '../../src/lib/consts';

export const PANTRY_RELAY = 'wss://pantry.zap.cooking';

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
 * Relay set per relay_mode. 'all' is the app's default relay list,
 * imported directly from the frontend's src/lib/consts.ts — one
 * source of truth, no mirror to drift.
 */
export function relaysFor(relayMode: string): string[] {
  return relayMode === 'pantry' ? [PANTRY_RELAY] : standardRelays;
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
      `SELECT id, publish_at, relay_mode, ciphertext, iv
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
      okCount = await publish(signedEvent, relaysFor(row.relay_mode));
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
