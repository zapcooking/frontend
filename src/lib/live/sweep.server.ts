/**
 * Go live — the sweep. Called once a minute (the cron worker posts to
 * /api/cron/live-sweep). There is no host heartbeat: the sweep asks
 * Cloudflare what each live input is doing and acts on the answer.
 *
 * What it does, in order:
 *
 *  1. Sessions that have not ended:
 *     - first went live 90 or more minutes ago      → end, 'timeout',
 *                                                     whatever the status
 *     - created 10 or more minutes ago, never live  → end, 'never_started'
 *     - otherwise one "reading" per session, and after two consecutive
 *       readings of "not broadcasting"              → end, 'abandoned'
 *
 *     A reading counts as "not broadcasting" when Cloudflare reports the
 *     input disconnected, reports no status at all (nothing ever
 *     connected), or says the input does not exist; and when the session
 *     has dropped back to 'created' after having been live (a reconnect
 *     that did not complete). 'connected' resets the count. A status that
 *     could not be read, or one the sweep does not recognise, changes
 *     nothing.
 *
 *     Ending is a conditional update followed by deleting the input, the
 *     same as a host End. A successful publish resets the count, so a
 *     session is only ended after two readings with no broadcast between.
 *
 *  2. Ended sessions that still have an input recorded (an earlier delete
 *     could not be confirmed): delete it again.
 *
 *  3. Orphan check: list the account's live inputs, and delete any that
 *     carry this environment's name prefix, are older than ten minutes
 *     and are not recorded on any row.
 *
 *  4. Delete ended rows older than 30 days.
 *
 * Every step is safe to run twice at once: each write is conditional on
 * what the sweep saw, and deleting an input that is already gone is fine.
 *
 * Logging: one line for every reading the sweep acts on or counts, with
 * the session id, the status read, Cloudflare's last-seen time, the count
 * before and after and the action. Never an input id, and counts only for
 * the orphan check.
 */
import {
  LIVE_MAX_SECONDS,
  LIVE_NEVER_STARTED_SECONDS,
  LIVE_ORPHAN_MIN_AGE_SECONDS,
  LIVE_ROW_RETENTION_SECONDS,
  LIVE_STREAK_TO_END,
  LIVE_SWEEP_BATCH,
  LIVE_SWEEP_BUDGET_MS
} from './config';
import { removeInputAfterEnd } from './relay.server';
import {
  bumpStreak,
  clearInput,
  deleteOldEndedRows,
  endSession,
  listEndedWithInput,
  listOpenSessions,
  listRecordedInputs,
  nowSeconds,
  resetStreak,
  type LiveDb,
  type LiveEndReason,
  type SweepRow
} from './sessions.server';
import {
  deleteLiveInput,
  listLiveInputs,
  readInputStatus,
  type StreamConfig
} from './stream.server';

export interface SweepSummary {
  examined: number;
  ended: { timeout: number; never_started: number; abandoned: number };
  counted: number;
  reset: number;
  unreadable: number;
  inputsDeleted: number;
  inputsPending: number;
  retried: { deleted: number; pending: number };
  orphans: { listed: number | null; candidates: number; deleted: number; failed: number };
  rowsDeleted: number;
  outOfTime: boolean;
  streamConfigured: boolean;
}

export interface SweepOptions {
  now?: number;
  /** Milliseconds clock for the time budget. Injectable for tests. */
  clockMs?: () => number;
  budgetMs?: number;
}

/** One log line per reading acted on. Session id and status words only. */
function logReading(
  row: SweepRow,
  reading: string,
  lastSeen: string | null,
  before: number,
  after: number,
  action: string
) {
  console.log(
    `[LiveSweep] session=${row.id} status=${row.status} reading=${reading} last_seen=${lastSeen ?? '-'} streak=${before}->${after} action=${action}`
  );
}

export async function runLiveSweep(
  db: LiveDb,
  cfg: StreamConfig | null,
  opts: SweepOptions = {}
): Promise<SweepSummary> {
  const now = opts.now ?? nowSeconds();
  const clockMs = opts.clockMs ?? (() => Date.now());
  const deadline = clockMs() + (opts.budgetMs ?? LIVE_SWEEP_BUDGET_MS);
  const summary: SweepSummary = {
    examined: 0,
    ended: { timeout: 0, never_started: 0, abandoned: 0 },
    counted: 0,
    reset: 0,
    unreadable: 0,
    inputsDeleted: 0,
    inputsPending: 0,
    retried: { deleted: 0, pending: 0 },
    orphans: { listed: null, candidates: 0, deleted: 0, failed: 0 },
    rowsDeleted: 0,
    outOfTime: false,
    streamConfigured: cfg !== null
  };
  const outOfTime = () => {
    if (clockMs() <= deadline) return false;
    summary.outOfTime = true;
    return true;
  };

  /** End a session (if nobody else has) and delete its input. */
  const end = async (row: SweepRow, reason: Exclude<LiveEndReason, 'host' | 'admin' | 'error'>) => {
    if (!(await endSession(db, row.id, reason, now))) return false;
    summary.ended[reason]++;
    const outcome = await removeInputAfterEnd(db, cfg, row.id);
    if (outcome === 'deleted') summary.inputsDeleted++;
    if (outcome === 'pending') summary.inputsPending++;
    return true;
  };

  // ── 1. Sessions that have not ended ────────────────────────────────
  for (const row of await listOpenSessions(db, LIVE_SWEEP_BATCH)) {
    if (outOfTime()) break;
    summary.examined++;
    const before = row.disconnected_streak;

    if (row.started_at !== null && now - row.started_at >= LIVE_MAX_SECONDS) {
      const did = await end(row, 'timeout');
      logReading(row, 'not_read', null, before, before, did ? 'end:timeout' : 'already_ended');
      continue;
    }
    if (row.started_at === null) {
      if (now - row.created_at >= LIVE_NEVER_STARTED_SECONDS) {
        const did = await end(row, 'never_started');
        logReading(
          row,
          'not_read',
          null,
          before,
          before,
          did ? 'end:never_started' : 'already_ended'
        );
      }
      continue;
    }

    // The session has been live at some point. Take one reading.
    let reading: string;
    let lastSeen: string | null = null;
    let notBroadcasting: boolean;
    if (row.status !== 'live' || !row.cf_input_uid) {
      // Dropped back to 'created' by a reconnect that has not completed.
      reading = 'no_input';
      notBroadcasting = true;
    } else if (!cfg) {
      summary.unreadable++;
      logReading(row, 'stream_not_configured', null, before, before, 'none');
      continue;
    } else {
      const status = await readInputStatus(cfg, row.cf_input_uid);
      reading = status.reading === 'other' ? `other:${status.state}` : status.reading;
      lastSeen = status.lastSeen;
      if (status.reading === 'connected') {
        if (before !== 0) {
          await resetStreak(db, row.id);
          summary.reset++;
          logReading(row, reading, lastSeen, before, 0, 'reset');
        }
        continue;
      }
      if (status.reading === 'unreadable' || status.reading === 'other') {
        summary.unreadable++;
        logReading(
          row,
          status.reading === 'unreadable' ? `unreadable:${status.state}` : reading,
          lastSeen,
          before,
          before,
          'none'
        );
        continue;
      }
      notBroadcasting = true; // disconnected, none, missing
    }

    if (notBroadcasting) {
      if (!(await bumpStreak(db, row.id, before))) {
        // Another sweep counted this reading, or the session just ended
        // or went live again. Nothing to do.
        logReading(row, reading, lastSeen, before, before, 'skipped');
        continue;
      }
      summary.counted++;
      const after = before + 1;
      if (after >= LIVE_STREAK_TO_END) {
        const did = await end(row, 'abandoned');
        logReading(row, reading, lastSeen, before, after, did ? 'end:abandoned' : 'already_ended');
      } else {
        logReading(row, reading, lastSeen, before, after, 'counted');
      }
    }
  }

  // ── 2. Retry deletes left on ended rows ────────────────────────────
  if (cfg && !outOfTime()) {
    for (const row of await listEndedWithInput(db, LIVE_SWEEP_BATCH)) {
      if (outOfTime()) break;
      if ((await deleteLiveInput(cfg, row.cf_input_uid)) === 'failed') {
        summary.retried.pending++;
        console.log(`[LiveSweep] session=${row.id} status=ended action=delete_retry:pending`);
      } else {
        await clearInput(db, row.id, row.cf_input_uid);
        summary.retried.deleted++;
        console.log(`[LiveSweep] session=${row.id} status=ended action=delete_retry:deleted`);
      }
    }
  }

  // ── 3. Orphan check ────────────────────────────────────────────────
  if (cfg && !outOfTime()) {
    const listed = await listLiveInputs(cfg);
    if (listed) {
      summary.orphans.listed = listed.length;
      const recorded = await listRecordedInputs(db);
      const mine = new RegExp(`^${cfg.inputPrefix.replace(/[^a-z0-9-]/g, '')}[0-9a-f]{32}$`);
      for (const input of listed) {
        if (!mine.test(input.name)) continue; // not this environment's
        if (recorded.has(input.uid)) continue; // a row is responsible for it
        if (input.createdAt === null || now - input.createdAt < LIVE_ORPHAN_MIN_AGE_SECONDS)
          continue;
        summary.orphans.candidates++;
        if (outOfTime()) break;
        if ((await deleteLiveInput(cfg, input.uid)) === 'failed') summary.orphans.failed++;
        else summary.orphans.deleted++;
      }
    }
    // Counts only: no names, no ids.
    console.log(
      `[LiveSweep] orphans listed=${summary.orphans.listed ?? 'unreadable'} candidates=${summary.orphans.candidates} deleted=${summary.orphans.deleted} failed=${summary.orphans.failed}`
    );
  }

  // ── 4. Retention ───────────────────────────────────────────────────
  if (!outOfTime()) {
    summary.rowsDeleted = await deleteOldEndedRows(db, now - LIVE_ROW_RETENTION_SECONDS);
    if (summary.rowsDeleted > 0) console.log(`[LiveSweep] rows_deleted=${summary.rowsDeleted}`);
  }

  if (summary.outOfTime)
    console.warn('[LiveSweep] time budget used up; the rest waits for the next run');
  return summary;
}
