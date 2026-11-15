/**
 * Go live — metrics for the admin (data capture).
 *
 * After a session ends, the sweep "closes it out" once
 * (LIVE_METRICS_DELAY_SECONDS later, so late zaps arrive):
 *
 *   1. reads the viewer time and peak the session's presence Durable
 *      Object summed from the anonymous heartbeats,
 *   2. sums the zap receipts on the session's "Live now" note,
 *   3. in ONE D1 batch, folds the session into its host's month in
 *      live_host_monthly and records viewer_seconds, zap_sats and
 *      metrics_at on the row. Both statements are conditional on
 *      metrics_at being NULL, so a session is folded exactly once even
 *      when two sweeps run at the same time,
 *   4. tells the presence object to wipe itself.
 *
 * This runs from the sweep rather than from each End path (host, sweep,
 * admin, kill switch, account deletion) so every ending is covered in one
 * place and a failure is retried on the next run. If the object or every
 * relay stays unreachable for LIVE_METRICS_GIVE_UP_SECONDS, the session is
 * recorded with what could be read (viewer time NULL, zaps 0).
 *
 * Nothing about any viewer is stored: per session, two more integers; per
 * host and month, a handful of sums. Migration 0010.
 */
import {
  LIVE_METRICS_BATCH,
  LIVE_METRICS_DELAY_SECONDS,
  LIVE_METRICS_GIVE_UP_SECONDS,
  LIVE_MONTHLY_RETENTION_MONTHS
} from './config';
import { unionKeyed } from '$lib/relayCollect';
import { RECEIPT_RELAYS } from '$lib/streams/relays';
import { extractZapAmountSats } from '$lib/zapAmount';
import type { PresenceTotals } from './presence.server';
import type { LiveDb } from './sessions.server';

/** What the close-out needs from the outside world. Injected for tests. */
export interface MetricsDeps {
  /** The presence object's totals, or null when it cannot be reached. */
  readTotals(sessionId: string): Promise<PresenceTotals | null>;
  /** Wipe the presence object. Best effort. */
  finish(sessionId: string): Promise<void>;
  /** Sats zapped to a note, or null when no relay answered. */
  zapSats(noteId: string): Promise<number | null>;
}

export interface PendingMetricsRow {
  id: string;
  host_pubkey: string;
  started_at: number | null;
  ended_at: number;
  note_id: string | null;
}

/** Ended sessions not recorded yet that ended at or before `endedBy`, oldest first. */
export async function listPendingMetrics(
  db: LiveDb,
  endedBy: number,
  limit: number
): Promise<PendingMetricsRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, host_pubkey, started_at, ended_at, note_id FROM live_sessions
        WHERE status = 'ended' AND metrics_at IS NULL AND ended_at <= ?1
        ORDER BY ended_at LIMIT ?2`
    )
    .bind(endedBy, limit)
    .all<PendingMetricsRow>();
  return results;
}

export interface SessionMetrics {
  /** NULL when it could not be read. */
  viewer_seconds: number | null;
  /** The presence object's peak; the stored peak is raised to it if lower. */
  peak: number;
  zap_sats: number;
}

/**
 * Fold one ended session into live_host_monthly and record its metrics.
 * One transaction; both statements apply only while metrics_at is NULL.
 * A session that never went live is recorded but not folded. Returns
 * whether THIS call recorded it.
 */
export async function recordSessionMetrics(
  db: LiveDb,
  id: string,
  m: SessionMetrics,
  now: number
): Promise<boolean> {
  const vs = m.viewer_seconds;
  const peak = Number.isSafeInteger(m.peak) && m.peak > 0 ? m.peak : 0;
  const sats = Number.isSafeInteger(m.zap_sats) && m.zap_sats > 0 ? m.zap_sats : 0;
  const [, marked] = await db.batch([
    // The SELECT reads the row before the UPDATE below marks it, and
    // returns nothing once it is marked, so the fold happens once.
    db
      .prepare(
        `INSERT INTO live_host_monthly
           (host_pubkey, month, streams, stream_seconds, longest_seconds,
            viewer_seconds, peak_watching, zap_sats, updated_at)
         SELECT host_pubkey, strftime('%Y-%m', started_at, 'unixepoch'), 1,
                max(0, ended_at - started_at), max(0, ended_at - started_at),
                coalesce(?2, 0), max(peak_watching, ?3), ?4, ?5
           FROM live_sessions
          WHERE id = ?1 AND metrics_at IS NULL AND status = 'ended'
            AND started_at IS NOT NULL AND ended_at IS NOT NULL
         ON CONFLICT (host_pubkey, month) DO UPDATE SET
           streams         = streams + 1,
           stream_seconds  = stream_seconds + excluded.stream_seconds,
           longest_seconds = max(longest_seconds, excluded.longest_seconds),
           viewer_seconds  = viewer_seconds + excluded.viewer_seconds,
           peak_watching   = max(peak_watching, excluded.peak_watching),
           zap_sats        = zap_sats + excluded.zap_sats,
           updated_at      = excluded.updated_at`
      )
      .bind(id, vs, peak, sats, now),
    db
      .prepare(
        `UPDATE live_sessions
            SET viewer_seconds = ?2, zap_sats = ?3,
                peak_watching = max(peak_watching, ?4), metrics_at = ?5
          WHERE id = ?1 AND metrics_at IS NULL AND status = 'ended'`
      )
      .bind(id, vs, sats, peak, now)
  ]);
  return (marked?.meta?.changes ?? 0) === 1;
}

export interface CloseOutSummary {
  recorded: number;
  /** Waiting for the presence object or a relay; retried next run. */
  waiting: number;
  /** Recorded without viewer time after LIVE_METRICS_GIVE_UP_SECONDS. */
  gaveUp: number;
}

/**
 * The sweep's close-out step. `outOfTime` is the sweep's budget check.
 * Fails soft: an error (for example a database without migration 0010)
 * is logged by name and the step stops.
 */
export async function closeOutEndedSessions(
  db: LiveDb,
  deps: MetricsDeps,
  now: number,
  outOfTime: () => boolean
): Promise<CloseOutSummary> {
  const summary: CloseOutSummary = { recorded: 0, waiting: 0, gaveUp: 0 };
  try {
    const rows = await listPendingMetrics(db, now - LIVE_METRICS_DELAY_SECONDS, LIVE_METRICS_BATCH);
    for (const row of rows) {
      if (outOfTime()) break;
      const giveUp = now - row.ended_at >= LIVE_METRICS_GIVE_UP_SECONDS;

      if (row.started_at === null) {
        // Never went live: no viewers, no presence object, nothing to fold.
        if (
          await recordSessionMetrics(db, row.id, { viewer_seconds: 0, peak: 0, zap_sats: 0 }, now)
        )
          summary.recorded++;
        continue;
      }

      const [totals, sats] = await Promise.all([
        deps.readTotals(row.id),
        row.note_id ? deps.zapSats(row.note_id) : Promise.resolve(0)
      ]);
      if ((totals === null || sats === null) && !giveUp) {
        summary.waiting++;
        console.log(
          `[LiveSweep] session=${row.id} metrics=waiting presence=${totals ? 'ok' : 'unreachable'} zaps=${sats === null ? 'unreachable' : 'ok'}`
        );
        continue;
      }
      const did = await recordSessionMetrics(
        db,
        row.id,
        {
          viewer_seconds: totals?.viewer_seconds ?? null,
          peak: totals?.peak ?? 0,
          zap_sats: sats ?? 0
        },
        now
      );
      if (!did) continue; // another sweep recorded it
      if (totals === null || sats === null) {
        summary.gaveUp++;
        console.warn(
          `[LiveSweep] session=${row.id} metrics=gave_up presence=${totals ? 'ok' : 'unreachable'} zaps=${sats === null ? 'unreachable' : 'ok'}`
        );
      } else {
        summary.recorded++;
      }
      // Recorded: the presence object keeps nothing more about the session.
      await deps.finish(row.id);
    }
  } catch (err) {
    console.error(`[LiveSweep] metrics close-out failed: ${(err as Error)?.name ?? 'error'}`);
  }
  return summary;
}

// ── Zaps ─────────────────────────────────────────────────────────────

const ZAP_READ_TIMEOUT_MS = 5000;

/**
 * The receipt relays plus the zap aggregators. A copy of
 * ZAP_AGGREGATOR_RELAYS (src/lib/recipeZaps.ts), which cannot be imported
 * here: that module loads the browser's NDK instance.
 */
const ZAP_AGGREGATORS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://offchain.pub',
  'wss://relay.snort.social'
];

/**
 * Sats in the zap receipts (kind 9735) on one note, merged across the
 * receipt relays and de-duplicated by receipt id. The same unverified rule
 * as the host's ended screen (any receipt counts, amount from its invoice).
 * Null when no relay finished answering.
 */
export async function fetchNoteZapSats(
  noteId: string,
  read: typeof unionKeyed = unionKeyed
): Promise<number | null> {
  const relays = [...new Set([...RECEIPT_RELAYS, ...ZAP_AGGREGATORS])];
  const { events, anyDone } = await read(
    relays,
    { z: { kinds: [9735], '#e': [noteId], limit: 500 } },
    { timeoutMs: ZAP_READ_TIMEOUT_MS }
  );
  if (!anyDone.z && events.z.length === 0) return null;
  let sats = 0;
  for (const receipt of events.z) {
    if (!receipt.tags.some((t) => t[0] === 'e' && t[1] === noteId)) continue;
    const n = extractZapAmountSats(receipt).sats;
    if (Number.isSafeInteger(n) && n > 0) sats += n;
  }
  return sats;
}

// ── Retention ────────────────────────────────────────────────────────

/** 'YYYY-MM' (UTC) of a unix-seconds time, shifted by `deltaMonths`. */
export function monthKey(unixSeconds: number, deltaMonths = 0): string {
  const d = new Date(unixSeconds * 1000);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + deltaMonths;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Delete months older than the retention (the current month counts as one). */
export async function deleteOldMonthly(db: LiveDb, now: number): Promise<number> {
  const oldestKept = monthKey(now, -(LIVE_MONTHLY_RETENTION_MONTHS - 1));
  try {
    const result = await db
      .prepare('DELETE FROM live_host_monthly WHERE month < ?1')
      .bind(oldestKept)
      .run();
    return result.meta?.changes ?? 0;
  } catch (err) {
    console.error(`[LiveSweep] monthly retention failed: ${(err as Error)?.name ?? 'error'}`);
    return 0;
  }
}

/** Account deletion: remove the host's monthly rows. */
export async function deleteMonthlyForHost(db: LiveDb, hostPubkey: string): Promise<void> {
  await db
    .prepare('DELETE FROM live_host_monthly WHERE host_pubkey = ?1')
    .bind(hostPubkey.toLowerCase())
    .run();
}

// ── Admin read (/admin/live/metrics) ─────────────────────────────────

export interface MonthlyRow {
  host_pubkey: string;
  month: string;
  streams: number;
  stream_seconds: number;
  longest_seconds: number;
  viewer_seconds: number;
  peak_watching: number;
  zap_sats: number;
}

export interface MetricsStreamRow {
  id: string;
  host_pubkey: string;
  title: string;
  status: 'created' | 'live' | 'ended';
  end_reason: string | null;
  started_at: number;
  ended_at: number | null;
  peak_watching: number;
  joins: number;
  viewer_seconds: number | null;
  zap_sats: number | null;
  metrics_at: number | null;
}

/** Monthly rows for the given months. */
export async function listMonthly(db: LiveDb, months: string[]): Promise<MonthlyRow[]> {
  if (months.length === 0) return [];
  const marks = months.map((_, i) => `?${i + 1}`).join(', ');
  const { results } = await db
    .prepare(
      `SELECT host_pubkey, month, streams, stream_seconds, longest_seconds, viewer_seconds,
              peak_watching, zap_sats
         FROM live_host_monthly WHERE month IN (${marks}) ORDER BY month, host_pubkey`
    )
    .bind(...months)
    .all<MonthlyRow>();
  return results;
}

/** Streams that went live at or after `since`, newest first (the 30-day table). */
export async function listMetricsStreams(
  db: LiveDb,
  since: number,
  limit = 2000
): Promise<MetricsStreamRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, host_pubkey, title, status, end_reason, started_at, ended_at, peak_watching,
              joins, viewer_seconds, zap_sats, metrics_at
         FROM live_sessions
        WHERE started_at IS NOT NULL AND started_at >= ?1
        ORDER BY started_at DESC LIMIT ?2`
    )
    .bind(since, limit)
    .all<MetricsStreamRow>();
  return results;
}

/** Ended streams that went live but are not folded into their month yet. */
export async function countUnrecorded(db: LiveDb): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM live_sessions
        WHERE status = 'ended' AND metrics_at IS NULL AND started_at IS NOT NULL`
    )
    .bind()
    .first<{ n: number }>();
  return row?.n ?? 0;
}
