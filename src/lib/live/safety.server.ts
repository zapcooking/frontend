/**
 * Go live — safety and the staged rollout: the action log, the hosting
 * mode, stream reports, report holds and the optional automatic end.
 * (Folds in the design of draft PR #976.)
 *
 * Tables (migration 0007): live_actions, live_reports, live_holds,
 * live_host_suspensions. The hosting mode is one KV key.
 *
 * Rules every caller relies on:
 *  - Every admin action, and every automatic one, is written to the
 *    action log with its time and actor (`logAction`). The log is never
 *    deleted by a retention rule.
 *  - The first report on a session opens its hold, with a snapshot of the
 *    session's public facts (never the Cloudflare input id). Only the
 *    admin releases a hold. While it is open, the session row and its
 *    reports survive every retention rule and the account-deletion purge.
 *  - A reporter is a daily-salted IP hash, never an address, and counts
 *    toward the automatic end only when that hash is present.
 */
import { endAndRemove } from './admin.server';
import {
  LIVE_AUTO_END_SUSPENSION_SECONDS,
  LIVE_AUTO_END_THRESHOLD,
  LIVE_HOSTING_MODE_KEY,
  LIVE_REPORT_DETAILS_MAX,
  LIVE_REPORT_RETENTION_SECONDS,
  LIVE_URGENT_REASONS,
  parseHostingMode,
  type LiveHostingMode,
  type LiveReportReason
} from './config';
import { getSession, nowSeconds, type LiveDb } from './sessions.server';
import type { StreamConfig } from './stream.server';

// ── Action log ───────────────────────────────────────────────────────

export type LiveActionKind =
  | 'approve'
  | 'unapprove'
  | 'mode'
  | 'end'
  | 'off'
  | 'block'
  | 'unblock'
  | 'hide'
  | 'unhide'
  | 'release_hold'
  | 'auto_end';

export const SYSTEM_ACTOR = 'system';

export interface LiveAction {
  id: string;
  occurred_at: number;
  actor: string;
  action: LiveActionKind;
  session_id: string | null;
  target_pubkey: string | null;
  detail: string;
}

/**
 * Write one action to the log. Returns false (and logs to the console)
 * when it could not be written, so the caller can say so; it never
 * throws, because the action itself has already happened.
 */
export async function logAction(
  db: LiveDb,
  entry: {
    actor: string;
    action: LiveActionKind;
    sessionId?: string | null;
    targetPubkey?: string | null;
    detail?: string;
    now?: number;
  }
): Promise<boolean> {
  try {
    await db
      .prepare(
        `INSERT INTO live_actions (id, occurred_at, actor, action, session_id, target_pubkey, detail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        crypto.randomUUID(),
        entry.now ?? nowSeconds(),
        entry.actor,
        entry.action,
        entry.sessionId ?? null,
        entry.targetPubkey ?? null,
        (entry.detail ?? '').slice(0, 200)
      )
      .run();
    return true;
  } catch (err) {
    console.error(
      `[Live] action log write failed (${entry.action}): ${(err as Error)?.name ?? 'error'}`
    );
    return false;
  }
}

export async function listActions(db: LiveDb, limit = 100): Promise<LiveAction[]> {
  const { results } = await db
    .prepare(
      `SELECT id, occurred_at, actor, action, session_id, target_pubkey, detail
         FROM live_actions ORDER BY occurred_at DESC, rowid DESC LIMIT ?1`
    )
    .bind(limit)
    .all<LiveAction>();
  return results;
}

// ── Hosting mode ─────────────────────────────────────────────────────

type ModeStore = {
  get(key: string, type?: 'text'): Promise<string | unknown | null>;
  put(key: string, value: string): Promise<void>;
};

const modeStore = (platform: Readonly<App.Platform> | undefined): ModeStore | undefined =>
  platform?.env?.GATED_CONTENT as ModeStore | undefined;

/**
 * The hosting mode. 'approved' unless the key says 'members': a missing
 * namespace or a failed read keeps the rollout gated, never opens it.
 * KV is eventually consistent; a change can take about a minute to reach
 * every location.
 */
export async function getHostingMode(
  platform: Readonly<App.Platform> | undefined
): Promise<LiveHostingMode> {
  const kv = modeStore(platform);
  if (!kv) return 'approved';
  try {
    return parseHostingMode(await kv.get(LIVE_HOSTING_MODE_KEY, 'text'));
  } catch (err) {
    console.error(`[Live] hosting mode unreadable: ${(err as Error)?.name ?? 'error'}`);
    return 'approved';
  }
}

/** Write the mode. Returns false when it could not be written. */
export async function setHostingMode(
  platform: Readonly<App.Platform> | undefined,
  mode: LiveHostingMode
): Promise<boolean> {
  const kv = modeStore(platform);
  if (!kv) return false;
  try {
    await kv.put(LIVE_HOSTING_MODE_KEY, mode);
    return true;
  } catch (err) {
    console.error(`[Live] hosting mode not written: ${(err as Error)?.name ?? 'error'}`);
    return false;
  }
}

// ── Reports and holds ────────────────────────────────────────────────

export interface ReportInput {
  sessionId: string;
  /** Daily-salted IP hash (64 hex), or '' when none could be made. */
  reporterHash: string;
  reason: LiveReportReason;
  details: string;
  /** The reported comment, or null for the stream itself. */
  comment: { id: string; pubkey: string } | null;
  now?: number;
}

export type ReportResult =
  | { ok: false; reason: 'not_found' }
  | {
      ok: true;
      /** False when this reporter had already reported this target. */
      recorded: boolean;
      urgent: boolean;
      title: string;
      hostPubkey: string;
      status: 'created' | 'live' | 'ended';
    };

const HEX64_RE = /^[0-9a-f]{64}$/;

/**
 * Record a report and open the session's hold. The report and the hold
 * are written before anything else happens (an alert, an automatic end),
 * so the record exists whatever fails afterwards.
 */
export async function recordReport(db: LiveDb, input: ReportInput): Promise<ReportResult> {
  const session = await getSession(db, input.sessionId);
  if (!session) return { ok: false, reason: 'not_found' };
  const now = input.now ?? nowSeconds();
  const reporter = HEX64_RE.test(input.reporterHash)
    ? input.reporterHash
    : `unverified:${crypto.randomUUID()}`;

  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO live_reports
         (id, session_id, reporter_hash, reason, details, comment_id, comment_pubkey, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(
      crypto.randomUUID(),
      input.sessionId,
      reporter,
      input.reason,
      input.details.slice(0, LIVE_REPORT_DETAILS_MAX),
      input.comment?.id ?? null,
      input.comment?.pubkey ?? null,
      now
    )
    .run();

  // The snapshot is the session's public facts at the first report. Never
  // the Cloudflare input id: that id alone is enough to play the stream.
  const snapshot = {
    id: session.id,
    host_pubkey: session.host_pubkey,
    title: session.title,
    recipe_a: session.recipe_a,
    status: session.status,
    created_at: session.created_at,
    started_at: session.started_at,
    ended_at: session.ended_at,
    note_id: session.note_id
  };
  await db
    .prepare(
      `INSERT OR IGNORE INTO live_holds (session_id, opened_at, status, snapshot_json)
       VALUES (?1, ?2, 'open', ?3)`
    )
    .bind(input.sessionId, now, JSON.stringify(snapshot))
    .run();
  // A new report on a released case reopens it: a fresh report is under review again.
  await db
    .prepare(
      `UPDATE live_holds SET status = 'open', released_at = NULL, released_by = NULL
        WHERE session_id = ?1 AND status = 'released'`
    )
    .bind(input.sessionId)
    .run();

  return {
    ok: true,
    recorded: (inserted.meta?.changes ?? 0) === 1,
    urgent: LIVE_URGENT_REASONS.includes(input.reason),
    title: session.title,
    hostPubkey: session.host_pubkey,
    status: session.status
  };
}

/** Release an open hold. Returns whether one was open. */
export async function releaseHold(
  db: LiveDb,
  sessionId: string,
  by: string,
  now: number = nowSeconds()
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_holds SET status = 'released', released_at = ?2, released_by = ?3
        WHERE session_id = ?1 AND status = 'open'`
    )
    .bind(sessionId, now, by)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export interface IncidentReport {
  reason: LiveReportReason;
  details: string;
  comment_id: string | null;
  comment_pubkey: string | null;
  created_at: number;
}

export interface Incident {
  session_id: string;
  status: 'open' | 'released';
  opened_at: number;
  released_at: number | null;
  released_by: string | null;
  title: string;
  host_pubkey: string;
  reports: IncidentReport[];
}

/** Holds with their reports, open ones first. Reporter hashes are never returned. */
export async function listIncidents(db: LiveDb, limit = 50): Promise<Incident[]> {
  const { results: holds } = await db
    .prepare(
      `SELECT session_id, status, opened_at, released_at, released_by, snapshot_json
         FROM live_holds
        ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, opened_at DESC LIMIT ?1`
    )
    .bind(limit)
    .all<{
      session_id: string;
      status: 'open' | 'released';
      opened_at: number;
      released_at: number | null;
      released_by: string | null;
      snapshot_json: string;
    }>();
  if (holds.length === 0) return [];
  const { results: reports } = await db
    .prepare(
      `SELECT session_id, reason, details, comment_id, comment_pubkey, created_at
         FROM live_reports
        WHERE session_id IN (SELECT session_id FROM live_holds
                              ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, opened_at DESC
                              LIMIT ?1)
        ORDER BY created_at LIMIT 2000`
    )
    .bind(limit)
    .all<IncidentReport & { session_id: string }>();
  return holds.map((h) => {
    let snap: { title?: string; host_pubkey?: string } = {};
    try {
      snap = JSON.parse(h.snapshot_json);
    } catch {
      /* an unreadable snapshot still lists the hold */
    }
    return {
      session_id: h.session_id,
      status: h.status,
      opened_at: h.opened_at,
      released_at: h.released_at,
      released_by: h.released_by,
      title: snap.title ?? '',
      host_pubkey: snap.host_pubkey ?? '',
      reports: reports
        .filter((r) => r.session_id === h.session_id)
        .map(({ session_id: _s, ...r }) => r)
    };
  });
}

// ── Automatic end (off unless LIVE_SAFETY_AUTO_END is 'true') ────────

/**
 * End a stream once LIVE_AUTO_END_THRESHOLD distinct verified reporters
 * have reported the STREAM (comment reports do not count), and suspend
 * the host from going live for LIVE_AUTO_END_SUSPENSION_SECONDS. The
 * suspension is written before the end, so the host cannot start again in
 * between. Logged as 'auto_end' by 'system'. Returns whether it ended it.
 */
export async function maybeAutoEnd(
  db: LiveDb,
  cfg: StreamConfig | null,
  sessionId: string,
  now: number = nowSeconds()
): Promise<boolean> {
  const session = await getSession(db, sessionId);
  if (!session || session.status === 'ended' || !cfg) return false;
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT reporter_hash) AS n FROM live_reports
        WHERE session_id = ?1 AND comment_id IS NULL AND reporter_hash NOT LIKE 'unverified:%'`
    )
    .bind(sessionId)
    .first<{ n: number }>();
  const reporters = Number(row?.n ?? 0);
  if (reporters < LIVE_AUTO_END_THRESHOLD) return false;

  await db
    .prepare(
      `INSERT INTO live_host_suspensions (host_pubkey, suspended_until, reason, session_id)
       VALUES (?1, ?2, 'report_threshold', ?3)
       ON CONFLICT(host_pubkey) DO UPDATE SET
         suspended_until = MAX(suspended_until, excluded.suspended_until),
         reason = excluded.reason, session_id = excluded.session_id`
    )
    .bind(session.host_pubkey, now + LIVE_AUTO_END_SUSPENSION_SECONDS, sessionId)
    .run();
  const outcome = await endAndRemove(db, cfg, sessionId, 'admin');
  if (outcome.ended) {
    await logAction(db, {
      actor: SYSTEM_ACTOR,
      action: 'auto_end',
      sessionId,
      targetPubkey: session.host_pubkey,
      detail: `${reporters} reporters; suspended ${LIVE_AUTO_END_SUSPENSION_SECONDS / 60} min`,
      now
    });
  }
  return outcome.ended;
}

// ── Retention ────────────────────────────────────────────────────────

/**
 * Delete reports older than the report retention unless their session's
 * hold is open, then released holds with no reports left, then expired
 * suspensions. The action log is never deleted here.
 */
export async function cleanupSafetyRecords(
  db: LiveDb,
  now: number = nowSeconds()
): Promise<void> {
  const cutoff = now - LIVE_REPORT_RETENTION_SECONDS;
  await db
    .prepare(
      `DELETE FROM live_reports WHERE created_at < ?1
          AND NOT EXISTS (SELECT 1 FROM live_holds h
                           WHERE h.session_id = live_reports.session_id AND h.status = 'open')`
    )
    .bind(cutoff)
    .run();
  await db
    .prepare(
      `DELETE FROM live_holds WHERE status = 'released'
          AND NOT EXISTS (SELECT 1 FROM live_reports r WHERE r.session_id = live_holds.session_id)`
    )
    .bind()
    .run();
  await db
    .prepare('DELETE FROM live_host_suspensions WHERE suspended_until < ?1')
    .bind(now)
    .run();
}
