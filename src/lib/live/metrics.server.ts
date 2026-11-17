/**
 * Go live — metrics for the admin (data capture).
 *
 * After a session ends, the sweep "closes it out" once
 * (LIVE_METRICS_DELAY_SECONDS later, so late zaps arrive):
 *
 *   1. reads the viewer time and peak the session's presence Durable
 *      Object summed from the anonymous heartbeats,
 *   2. sums the zap receipts on the session's "Live now" note and on its
 *      address (30311:<host>:<session id>), each payment once,
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
 * relay stays unreachable for LIVE_METRICS_GIVE_UP_SECONDS (24 hours) after
 * the end, the session is recorded with what could be read (viewer time
 * NULL, zaps 0); until then it stays waiting. Each run works through the
 * whole queue, oldest first, until it is empty or the time budget runs out.
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
import { verifyEvent } from 'nostr-tools/pure';
import { collect, type NostrEvent } from '$lib/relayCollect';
import { STREAM_RECEIPT_RELAYS } from '$lib/streams/relays';
import { goLiveZapTargets, targetFilters } from '$lib/streams/target';
import { ZapTotals, zapHistories, type PageResult } from '$lib/streams/zapTotals';
import type { EventVerifier, NostrEventLike } from '$lib/streams/types';
import type { PresenceTotals } from './presence.server';
import type { LiveDb } from './sessions.server';

/** What the close-out needs from the outside world. Injected for tests. */
export interface MetricsDeps {
  /** The presence object's totals, or null when it cannot be reached. */
  readTotals(sessionId: string): Promise<PresenceTotals | null>;
  /** Wipe the presence object. Best effort. */
  finish(sessionId: string): Promise<void>;
  /**
   * Verified sats zapped to the stream (`targets`: its "Live now" note
   * when it has one, and its address), or null when it cannot be read
   * right now (no relay answered, or the host's provider is unreachable).
   */
  zapSats(targets: string[], hostPubkey: string): Promise<number | null>;
}

export interface PendingMetricsRow {
  id: string;
  host_pubkey: string;
  started_at: number | null;
  ended_at: number;
  note_id: string | null;
  /** The peak the heartbeat route stored on the row while live. */
  peak_watching: number;
}

/** Where a close-out run has got to: the last (ended_at, id) it looked at. */
export interface PendingCursor {
  ended_at: number;
  id: string;
}

/**
 * Ended sessions not recorded yet that ended at or before `endedBy`,
 * oldest first (by ended_at, then id), after `after` when given. The
 * cursor lets one run walk the whole queue once, so a session that stays
 * waiting is not picked up again in the same run.
 */
export async function listPendingMetrics(
  db: LiveDb,
  endedBy: number,
  limit: number,
  after: PendingCursor | null = null
): Promise<PendingMetricsRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, host_pubkey, started_at, ended_at, note_id, peak_watching FROM live_sessions
        WHERE status = 'ended' AND metrics_at IS NULL AND ended_at <= ?1
          AND (?3 IS NULL OR ended_at > ?3 OR (ended_at = ?3 AND id > ?4))
        ORDER BY ended_at, id LIMIT ?2`
    )
    .bind(endedBy, limit, after?.ended_at ?? null, after?.id ?? '')
    .all<PendingMetricsRow>();
  return results;
}

/** Ended sessions not recorded yet, for any reason (the queue the page shows). */
export async function countWaiting(db: LiveDb): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM live_sessions WHERE status = 'ended' AND metrics_at IS NULL`
    )
    .bind()
    .first<{ n: number }>();
  return row?.n ?? 0;
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
 * A session that never went live, or whose host asked to delete their
 * account after it was created, is recorded but not folded. Returns
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
            -- Never for an account that asked to be deleted after this
            -- stream was created (a row kept under a hold, including one
            -- from before migration 0010). A returning key's later streams
            -- still count.
            AND NOT EXISTS (
              SELECT 1 FROM account_deletion_requests d
               WHERE d.pubkey = live_sessions.host_pubkey
                 AND d.requested_at >= live_sessions.created_at)
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

/**
 * The viewer time to store. NULL ("not measured") when the presence object
 * could not be read, and when it answered empty (nothing summed, no peak)
 * although the row shows people watched (stored peak above 0): the object
 * no longer had the stream's totals, e.g. a stream from before viewer time
 * was summed, or one whose totals were already wiped. 0 only when nobody
 * was counted at all.
 */
export function viewerSecondsFor(totals: PresenceTotals | null, storedPeak: number): number | null {
  if (!totals) return null;
  if (totals.viewer_seconds === 0 && totals.peak === 0 && storedPeak > 0) return null;
  return totals.viewer_seconds;
}

export interface CloseOutSummary {
  /** Recorded this run (gaveUp included). */
  recorded: number;
  /** Of those, recorded with what could be read after LIVE_METRICS_GIVE_UP_SECONDS. */
  gaveUp: number;
  /** Looked at this run but the presence object or relays did not answer; retried later. */
  retry: number;
  /** Ended sessions still not recorded after this run, for any reason. */
  waiting: number;
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
  const summary: CloseOutSummary = { recorded: 0, gaveUp: 0, retry: 0, waiting: 0 };
  try {
    // The whole queue, oldest first, in batches, until it is empty or the
    // time budget runs out. The cursor walks each session once per run.
    let cursor: PendingCursor | null = null;
    drain: while (!outOfTime()) {
      const rows = await listPendingMetrics(
        db,
        now - LIVE_METRICS_DELAY_SECONDS,
        LIVE_METRICS_BATCH,
        cursor
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        if (outOfTime()) break drain;
        cursor = { ended_at: row.ended_at, id: row.id };
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
          // Every session has an address to be zapped at, note or no note.
          deps.zapSats(goLiveZapTargets(row.host_pubkey, row.id, row.note_id), row.host_pubkey)
        ]);
        if ((totals === null || sats === null) && !giveUp) {
          summary.retry++;
          console.log(
            `[LiveSweep] session=${row.id} metrics=waiting presence=${totals ? 'ok' : 'unreachable'} zaps=${sats === null ? 'unreachable' : 'ok'}`
          );
          continue;
        }
        const did = await recordSessionMetrics(
          db,
          row.id,
          {
            viewer_seconds: viewerSecondsFor(totals, row.peak_watching),
            peak: totals?.peak ?? 0,
            zap_sats: sats ?? 0
          },
          now
        );
        if (!did) continue; // another sweep recorded it
        if (totals === null || sats === null) {
          summary.gaveUp++;
          summary.recorded++;
          console.warn(
            `[LiveSweep] session=${row.id} metrics=gave_up presence=${totals ? 'ok' : 'unreachable'} zaps=${sats === null ? 'unreachable' : 'ok'}`
          );
        } else {
          summary.recorded++;
        }
        // Recorded: the presence object keeps nothing more about the session.
        await deps.finish(row.id);
      }
    }
  } catch (err) {
    console.error(`[LiveSweep] metrics close-out failed: ${(err as Error)?.name ?? 'error'}`);
  }
  try {
    summary.waiting = await countWaiting(db);
  } catch {
    // A database without migration 0010: nothing is counted.
  }
  return summary;
}

// ── Zaps ─────────────────────────────────────────────────────────────

/** One relay page (a REQ until EOSE or this timeout). */
const ZAP_PAGE_TIMEOUT_MS = 5000;
/** The whole zap read for one session: profile, provider and receipts. */
const ZAP_BUDGET_MS = 9000;
const PROVIDER_TIMEOUT_MS = 4000;
const ZAP_PAGE_SIZE = 250;
const ZAP_MAX_PAGES = 20;

/** The same receipt relays as the stream chat's live zap total. */
const ZAP_RELAYS: string[] = [...STREAM_RECEIPT_RELAYS];
/** Where the host's profile (kind 0, for the lightning address) is read. */
const PROFILE_RELAYS = [...new Set(['wss://purplepag.es', ...ZAP_RELAYS])];

export type Provider = { pubkey: string } | 'none' | 'unreachable';

export interface ZapReadDeps {
  collect?: typeof collect;
  fetch?: typeof fetch;
  verify?: EventVerifier;
  /**
   * Providers already looked up in this run, by host. One run often
   * records several of one host's streams (a backlog), so each host's
   * profile and LNURL document are read once per run.
   */
  providers?: Map<string, Promise<Provider>>;
}

/**
 * The host's zap provider: the nostrPubkey of the LNURL document behind
 * the lud16 in their newest profile. The same rule as resolveZapProvider
 * (src/lib/streams/zapProvider.ts), read with raw sockets because
 * nostr-tools' pool does not run in workerd. 'none' when the host has no
 * zappable address (so no receipt can be verified); 'unreachable' when
 * no relay answered or the LNURL document could not be fetched.
 */
async function resolveProvider(host: string, deps: ZapReadDeps): Promise<Provider> {
  const read = deps.collect ?? collect;
  const results = await Promise.all(
    PROFILE_RELAYS.map((url) =>
      read(
        url,
        { p: { kinds: [0], authors: [host], limit: 1 } },
        { timeoutMs: PROVIDER_TIMEOUT_MS }
      )
    )
  );
  if (!results.some((r) => r.done.p && !r.closed.p)) return 'unreachable';
  let profile: NostrEvent | null = null;
  for (const r of results) {
    for (const e of r.events.p) {
      if (e.kind !== 0 || e.pubkey !== host) continue;
      if (!(deps.verify ?? (verifyEvent as unknown as EventVerifier))(e)) continue;
      if (!profile || e.created_at > profile.created_at) profile = e;
    }
  }
  let content: Record<string, unknown> = {};
  try {
    content = JSON.parse(profile?.content || '{}');
  } catch {
    content = {};
  }
  const parts = typeof content.lud16 === 'string' ? content.lud16.trim().split('@') : [];
  if (parts.length !== 2 || !parts[0] || !/^[a-z0-9.-]+$/i.test(parts[1])) return 'none';
  const url = `https://${parts[1]}/.well-known/lnurlp/${encodeURIComponent(parts[0])}`;
  try {
    const res = await (deps.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return 'unreachable';
    const meta = (await res.json()) as Record<string, unknown>;
    if (!meta.allowsNostr || typeof meta.nostrPubkey !== 'string') return 'none';
    const pubkey = meta.nostrPubkey.toLowerCase();
    return /^[0-9a-f]{64}$/.test(pubkey) ? { pubkey } : 'none';
  } catch {
    return 'unreachable';
  }
}

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * Verified sats zapped to a stream: to any of `targets` (a Go live
 * session's "Live now" note and its address, see goLiveZapTargets). Only
 * receipts signed by the host's own zap provider count, with a signed zap
 * request for the same target and host and an invoice that matches it,
 * each payment once across all targets: the same rule as the stream
 * chat's zap total (ZapTotals.accept). Receipt history is walked backward
 * page by page on every relay, once per target (zapHistory).
 *
 * Null (try again later) when the provider is unreachable or, for any
 * target, no relay finished a clean pass; a relay that answers CLOSED
 * (auth-required, rate-limited) is not a clean pass. 0 when the host has
 * no zappable address, or there is no target. A history longer than the
 * scan walks is logged and the verified sum so far is returned.
 */
export async function fetchStreamZapSats(
  targets: readonly string[],
  host: string,
  deps: ZapReadDeps = {}
): Promise<number | null> {
  if (targets.length === 0) return 0;
  const signal = AbortSignal.timeout(ZAP_BUDGET_MS);
  let lookup = deps.providers?.get(host);
  if (!lookup) {
    lookup = resolveProvider(host, deps);
    deps.providers?.set(host, lookup);
  }
  const provider = await lookup;
  if (provider === 'unreachable') return null;
  if (provider === 'none') return 0;
  const read = deps.collect ?? collect;
  const verify = deps.verify ?? (verifyEvent as unknown as EventVerifier);
  const totals = new ZapTotals();
  // One ZapTotals for every target: a payment is counted once by its
  // payment hash, whichever target's scan (or relay) brought the receipt.
  const results = await zapHistories(
    {
      sources: ZAP_RELAYS,
      query: async (relay, filter): Promise<PageResult> => {
        const r = await read(relay, { z: filter }, { timeoutMs: ZAP_PAGE_TIMEOUT_MS, signal });
        return {
          events: r.events.z as NostrEventLike[],
          complete: r.done.z && !r.closed.z
        };
      },
      accept: async (event) => {
        await totals.accept(event, {
          address: targets,
          recipient: host,
          provider: provider.pubkey,
          verify,
          digest: sha256Hex
        });
      },
      signal,
      pageSize: ZAP_PAGE_SIZE,
      maxPages: ZAP_MAX_PAGES
    },
    targetFilters(targets).map((fragment) => ({ kinds: [9735], ...fragment }))
  );
  // A target no relay answered for could be hiding zaps: wait, do not
  // record a total that silently leaves it out.
  if (results.some((r) => r.answered === 0 && !r.truncated)) return null;
  if (results.some((r) => r.truncated)) {
    console.warn(
      `[LiveSweep] targets=${targets.length} host=${host.slice(0, 8)} zaps=truncated sats_so_far=${Math.floor(totals.msats / 1000)}`
    );
  }
  return Math.floor(totals.msats / 1000);
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
