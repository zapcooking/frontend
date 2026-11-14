/**
 * Go live — session records (D1 table live_sessions, migration 0004).
 *
 * This module is the only place that reads or writes the table. It makes
 * no Cloudflare Stream calls: the live input is created at publish time,
 * by the publish relay.
 *
 * Two rules that every caller relies on:
 *  - `toPublicSession` is the ONLY shape that may leave the server. The
 *    host token hash, the Cloudflare input id, the play address and the
 *    publish lock are never returned by any endpoint.
 *  - The host token is stored as a sha256 hash, is accepted from the
 *    Authorization header only, and stops working when the session ends
 *    (the hash is cleared in the same statement that ends it).
 */
import {
  LIVE_CREATES_PER_HOUR,
  LIVE_MAX_OPEN_SESSIONS_DEFAULT,
  LIVE_MAX_PUBLISH_ATTEMPTS,
  LIVE_PUBLISH_LOCK_SECONDS,
  LIVE_RECIPE_D_MAX,
  LIVE_RECIPE_KINDS,
  LIVE_TITLE_MAX,
  type LiveHostingMode
} from './config';

export type LiveSessionStatus = 'created' | 'live' | 'ended';
export type LiveEndReason = 'host' | 'timeout' | 'abandoned' | 'never_started' | 'admin' | 'error';

/** The D1 surface this module needs (matches App.Platform's SCHEDULER_DB). */
export interface LiveDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}

/** Columns the session routes read. Deliberately not `SELECT *`. */
export interface LiveSessionRow {
  id: string;
  host_pubkey: string;
  title: string;
  recipe_a: string | null;
  host_token_hash: string;
  status: LiveSessionStatus;
  end_reason: LiveEndReason | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  /** The "Live now" note's event id, or null (no note: no comments). */
  note_id: string | null;
}

/** What anyone may see about a session. */
export interface PublicLiveSession {
  id: string;
  status: LiveSessionStatus;
  title: string;
  recipe_a: string | null;
  host_pubkey: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  /** The "Live now" note's event id; null when the host posted none. */
  note_id: string | null;
}

const SESSION_COLUMNS =
  'id, host_pubkey, title, recipe_a, host_token_hash, status, end_reason, created_at, started_at, ended_at, note_id';

const SESSION_ID_RE = /^[0-9a-f]{32}$/;
const HOST_TOKEN_RE = /^[0-9a-f]{64}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function isLiveSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value);
}

function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 128 random bits. Hex, so it can never collide with a word such as "new". */
export const newSessionId = () => randomHex(16);

/** 256 random bits, shown to the host once at create. */
export const newHostToken = () => randomHex(32);

export async function hashHostToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The host token from `Authorization: Bearer <token>`, or null. The token
 * is read from this header and nowhere else: never the URL, never the body.
 */
export function readHostToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return HOST_TOKEN_RE.test(token) ? token : null;
}

/**
 * True when `token` is this session's host token AND the session has not
 * ended. An ended session has no valid token, whatever is presented.
 */
export async function hostTokenMatches(
  row: Pick<LiveSessionRow, 'host_token_hash' | 'status'>,
  token: string | null
): Promise<boolean> {
  if (!token || row.status === 'ended' || !row.host_token_hash) return false;
  return constantTimeEqual(await hashHostToken(token), row.host_token_hash);
}

/** True when the string holds an ASCII control character (including newlines and DEL). */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Trimmed title, or null when it is missing, empty or too long. */
export function parseTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  if (title.length === 0 || title.length > LIVE_TITLE_MAX) return null;
  // Control characters have no place in a title that other pages will render.
  if (hasControlChars(title)) return null;
  return title;
}

/**
 * A recipe address `<kind>:<pubkey>:<d>`:
 *  - `undefined` / `null` / '' → no recipe (returns null, valid)
 *  - a well-formed address      → the normalized address (pubkey lowercased)
 *  - anything else              → 'invalid'
 * The host may attach any recipe, their own or another cook's.
 */
export function parseRecipeAddress(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return 'invalid';
  const first = value.indexOf(':');
  const second = value.indexOf(':', first + 1);
  if (first < 0 || second < 0) return 'invalid';
  const kind = Number(value.slice(0, first));
  const pubkey = value.slice(first + 1, second).toLowerCase();
  const d = value.slice(second + 1);
  if (!LIVE_RECIPE_KINDS.includes(kind) || String(kind) !== value.slice(0, first)) return 'invalid';
  if (!HEX64_RE.test(pubkey)) return 'invalid';
  if (d.length === 0 || d.length > LIVE_RECIPE_D_MAX || hasControlChars(d)) {
    return 'invalid';
  }
  return `${kind}:${pubkey}:${d}`;
}

export function toPublicSession(row: LiveSessionRow): PublicLiveSession {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    recipe_a: row.recipe_a,
    host_pubkey: row.host_pubkey,
    created_at: row.created_at,
    started_at: row.started_at,
    ended_at: row.ended_at,
    note_id: row.note_id ?? null
  };
}

export async function getSession(db: LiveDb, id: string): Promise<LiveSessionRow | null> {
  if (!isLiveSessionId(id)) return null;
  return db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM live_sessions WHERE id = ?1`)
    .bind(id)
    .first<LiveSessionRow>();
}

/** The host's session that has not ended, if any (at most one, by unique index). */
export async function getActiveSessionForHost(
  db: LiveDb,
  hostPubkey: string
): Promise<LiveSessionRow | null> {
  return db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM live_sessions
        WHERE host_pubkey = ?1 AND status IN ('created', 'live')`
    )
    .bind(hostPubkey)
    .first<LiveSessionRow>();
}

/**
 * True only for a violation of live_sessions_one_active_idx, the partial
 * unique index on host_pubkey. SQLite (and D1) name the violated COLUMN in
 * the message, not the index: "UNIQUE constraint failed:
 * live_sessions.host_pubkey". That index is the only uniqueness rule on
 * host_pubkey, so the column identifies it. A primary-key collision reads
 * "...: live_sessions.id" and does not match.
 */
export function isOneActiveViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    /UNIQUE constraint failed: live_sessions\.host_pubkey(?![\w.])/.test(err.message)
  );
}

export type CreateSessionResult =
  | { ok: true; session: LiveSessionRow; hostToken: string }
  | {
      ok: false;
      reason:
        | 'already_active'
        | 'rate_limited'
        | 'blocked'
        | 'not_approved'
        | 'suspended'
        | 'live_full';
    };

/**
 * Insert a new session in status 'created', subject to rules that are all
 * enforced by the database in this ONE statement, so two simultaneous
 * creates (or a create racing an admin change) cannot pass a stale answer:
 *
 *  - Host block. Nothing is inserted for a host in live_blocked_hosts
 *    → `blocked`.
 *  - Approval. In 'approved' mode the host must be in live_approved_hosts
 *    → otherwise `not_approved`. In 'members' mode this is skipped.
 *  - Temporary suspension (an automatic safety end) still running
 *    → `suspended`.
 *  - Create rate limit. The host must have created fewer than
 *    LIVE_CREATES_PER_HOUR sessions in the last hour (ended ones
 *    included) → otherwise `rate_limited`.
 *  - Open-session cap. Fewer than `maxOpen` sessions (all hosts) may be
 *    open → otherwise `live_full`.
 *  - One session that has not ended per host, by the partial unique
 *    index. A violation → `already_active`.
 *
 * When nothing was inserted, the reason is worked out afterwards in that
 * order (blocked first). Every other failure is rethrown.
 */
export async function createSession(
  db: LiveDb,
  input: {
    hostPubkey: string;
    title: string;
    recipeA: string | null;
    mode: LiveHostingMode;
    now?: number;
    maxPerHour?: number;
    maxOpen?: number;
  }
): Promise<CreateSessionResult> {
  const id = newSessionId();
  const hostToken = newHostToken();
  const hash = await hashHostToken(hostToken);
  const now = input.now ?? nowSeconds();
  const maxPerHour = input.maxPerHour ?? LIVE_CREATES_PER_HOUR;
  const maxOpen = input.maxOpen ?? LIVE_MAX_OPEN_SESSIONS_DEFAULT;
  let inserted: number;
  try {
    const result = await db
      .prepare(
        `INSERT INTO live_sessions (id, host_pubkey, title, recipe_a, host_token_hash, status, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 'created', ?6
          WHERE NOT EXISTS (SELECT 1 FROM live_blocked_hosts WHERE pubkey = ?2)
            AND (?10 = 'members' OR EXISTS (SELECT 1 FROM live_approved_hosts WHERE pubkey = ?2))
            AND NOT EXISTS (SELECT 1 FROM live_host_suspensions
                             WHERE host_pubkey = ?2 AND suspended_until > ?6)
            AND (SELECT COUNT(*) FROM live_sessions
                  WHERE host_pubkey = ?2 AND created_at > ?7) < ?8
            AND (SELECT COUNT(*) FROM live_sessions
                  WHERE status IN ('created', 'live')) < ?9`
      )
      .bind(
        id,
        input.hostPubkey,
        input.title,
        input.recipeA,
        hash,
        now,
        now - 3600,
        maxPerHour,
        maxOpen,
        input.mode
      )
      .run();
    inserted = result.meta?.changes ?? 0;
  } catch (err) {
    if (isOneActiveViolation(err)) return { ok: false, reason: 'already_active' };
    // Anything else (an id collision, a NOT NULL failure, a database
    // error) is not "this host already has a session" and must surface.
    throw err;
  }
  if (inserted !== 1) {
    if (await isHostBlocked(db, input.hostPubkey)) return { ok: false, reason: 'blocked' };
    if (input.mode === 'approved' && !(await isHostApproved(db, input.hostPubkey))) {
      return { ok: false, reason: 'not_approved' };
    }
    const suspended = await db
      .prepare(
        'SELECT 1 AS x FROM live_host_suspensions WHERE host_pubkey = ?1 AND suspended_until > ?2'
      )
      .bind(input.hostPubkey, now)
      .first<{ x: number }>();
    if (suspended) return { ok: false, reason: 'suspended' };
    const recent = await db
      .prepare('SELECT COUNT(*) AS n FROM live_sessions WHERE host_pubkey = ?1 AND created_at > ?2')
      .bind(input.hostPubkey, now - 3600)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= maxPerHour) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'live_full' };
  }
  return {
    ok: true,
    hostToken,
    session: {
      id,
      host_pubkey: input.hostPubkey,
      title: input.title,
      recipe_a: input.recipeA,
      host_token_hash: hash,
      status: 'created',
      end_reason: null,
      created_at: now,
      started_at: null,
      ended_at: null,
      note_id: null
    }
  };
}

/**
 * End a session. One conditional statement: it only applies to a session
 * that has not ended, so a second call (or a race with another actor)
 * changes nothing. Ending also clears the host token hash and any publish
 * lock, so the token cannot be used again, and the play address, so
 * nobody new can join.
 *
 * It deliberately leaves cf_input_uid in place. A non-null cf_input_uid
 * always means "a Cloudflare live input exists that we still have to
 * delete": the caller deletes it and then calls `clearInput`. If that
 * delete fails, the id stays on the ended row and the sweep retries it.
 *
 * Returns true when THIS call ended the session.
 */
export async function endSession(
  db: LiveDb,
  id: string,
  reason: LiveEndReason,
  now: number = nowSeconds()
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_sessions
          SET status = 'ended', end_reason = ?2, ended_at = ?3,
              host_token_hash = '', publish_lock = NULL, publish_lock_at = NULL,
              cf_play_url = NULL
        WHERE id = ?1 AND status != 'ended'`
    )
    .bind(id, reason, now)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

// ── Publish relay state ──────────────────────────────────────────────
//
// Invariants the publish relay and End both rely on:
//
//  1. cf_input_uid IS NOT NULL  ⇔  a Cloudflare live input exists that
//     this row is responsible for deleting. It is written as soon as the
//     input is created and cleared only after a confirmed delete.
//  2. status = 'live'  ⇒  cf_input_uid and cf_play_url are set and the
//     relay returned an answer for that input. A session whose input has
//     been deleted for a reconnect drops back to 'created' until the new
//     publish succeeds, so a session is never reported live when it is not.
//  3. Each input receives exactly one relayed publish. Under the lock the
//     server deletes the previous input, creates a new one and uses its
//     publish URL once. The host never holds a publish URL.

/** Server-only view of the relay columns. Never serialized into a response. */
export interface LiveRelayState {
  status: LiveSessionStatus;
  cf_input_uid: string | null;
  cf_play_url: string | null;
  reconnects: number;
  started_at: number | null;
}

export async function getRelayState(db: LiveDb, id: string): Promise<LiveRelayState | null> {
  if (!isLiveSessionId(id)) return null;
  return db
    .prepare(
      'SELECT status, cf_input_uid, cf_play_url, reconnects, started_at FROM live_sessions WHERE id = ?1'
    )
    .bind(id)
    .first<LiveRelayState>();
}

export type AcquireLockResult =
  { ok: true; nonce: string } | { ok: false; reason: 'busy_or_ended' | 'attempt_limit' };

/**
 * Take the per-session publish lock. One conditional statement, so of two
 * simultaneous publishes exactly one gets it. A lock older than
 * LIVE_PUBLISH_LOCK_SECONDS is stale and can be taken over, which is what
 * stops a failed or crashed publish from stranding the host.
 *
 * Taking the lock also counts the attempt (`reconnects`), and refuses once
 * the session has used LIVE_MAX_PUBLISH_ATTEMPTS.
 */
export async function acquirePublishLock(
  db: LiveDb,
  id: string,
  now: number = nowSeconds()
): Promise<AcquireLockResult> {
  const nonce = crypto.randomUUID();
  const result = await db
    .prepare(
      `UPDATE live_sessions
          SET publish_lock = ?1, publish_lock_at = ?2, reconnects = reconnects + 1
        WHERE id = ?3 AND status != 'ended'
          AND (publish_lock IS NULL OR publish_lock_at < ?4)
          AND reconnects < ?5`
    )
    .bind(nonce, now, id, now - LIVE_PUBLISH_LOCK_SECONDS, LIVE_MAX_PUBLISH_ATTEMPTS)
    .run();
  if ((result.meta?.changes ?? 0) === 1) return { ok: true, nonce };

  const row = await getRelayState(db, id);
  if (row && row.status !== 'ended' && row.reconnects >= LIVE_MAX_PUBLISH_ATTEMPTS) {
    return { ok: false, reason: 'attempt_limit' };
  }
  return { ok: false, reason: 'busy_or_ended' };
}

/** Release the lock, only if this request still holds it. */
export async function releasePublishLock(db: LiveDb, id: string, nonce: string): Promise<void> {
  await db
    .prepare(
      'UPDATE live_sessions SET publish_lock = NULL, publish_lock_at = NULL WHERE id = ?1 AND publish_lock = ?2'
    )
    .bind(id, nonce)
    .run();
}

/**
 * The previous input has been deleted (under the lock): forget it. A live
 * session drops back to 'created', because nothing is being broadcast
 * until the new publish succeeds. Returns false if the lock was lost.
 */
export async function clearInputUnderLock(db: LiveDb, id: string, nonce: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_sessions
          SET cf_input_uid = NULL, cf_play_url = NULL,
              status = CASE WHEN status = 'live' THEN 'created' ELSE status END
        WHERE id = ?1 AND publish_lock = ?2 AND status != 'ended'`
    )
    .bind(id, nonce)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/**
 * Record a freshly created input (under the lock), BEFORE it is used, so a
 * failure in any later step leaves a row that says which input to delete.
 * Returns false if the lock was lost or the session ended meanwhile.
 */
export async function recordInputUnderLock(
  db: LiveDb,
  id: string,
  nonce: string,
  uid: string
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_sessions SET cf_input_uid = ?3
        WHERE id = ?1 AND publish_lock = ?2 AND status != 'ended' AND cf_input_uid IS NULL`
    )
    .bind(id, nonce, uid)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/**
 * The relay succeeded: the session is live on this input. Releases the
 * lock in the same statement. Returns false if the lock was lost or the
 * session ended meanwhile, in which case the caller must delete the input.
 */
export async function markLiveUnderLock(
  db: LiveDb,
  id: string,
  nonce: string,
  uid: string,
  playUrl: string,
  now: number = nowSeconds()
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_sessions
          SET status = 'live', cf_play_url = ?4, started_at = COALESCE(started_at, ?5),
              disconnected_streak = 0, publish_lock = NULL, publish_lock_at = NULL
        WHERE id = ?1 AND publish_lock = ?2 AND status != 'ended' AND cf_input_uid = ?3`
    )
    .bind(id, nonce, uid, playUrl, now)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/**
 * Forget an input after a CONFIRMED delete, whoever holds the lock and
 * whatever the status. Only clears the row if it still points at `uid`.
 */
export async function clearInput(db: LiveDb, id: string, uid: string): Promise<void> {
  await db
    .prepare(
      `UPDATE live_sessions
          SET cf_input_uid = NULL, cf_play_url = NULL,
              status = CASE WHEN status = 'live' THEN 'created' ELSE status END
        WHERE id = ?1 AND cf_input_uid = ?2`
    )
    .bind(id, uid)
    .run();
}

/**
 * Last resort for an input that could be neither used nor deleted and is
 * not on the row: write it down if the row has no input recorded, so the
 * sweep can delete it later. Returns whether it was recorded.
 */
export async function recordOrphanInput(db: LiveDb, id: string, uid: string): Promise<boolean> {
  const result = await db
    .prepare('UPDATE live_sessions SET cf_input_uid = ?2 WHERE id = ?1 AND cf_input_uid IS NULL')
    .bind(id, uid)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

// ── Guest cap ────────────────────────────────────────────────────────
//
// The cap counts guest JOINS per session. It is two plain integers on
// the session row and nothing else: no row, key, address or handle is
// kept for any viewer, so a viewer leaving is not (and cannot be)
// detected. Members are never counted.

/**
 * Take one guest slot. One conditional statement, so two guests arriving
 * at the last slot cannot both get it. Only a live session has slots.
 */
export async function takeGuestSlot(db: LiveDb, id: string, cap: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_sessions SET guest_joins = guest_joins + 1
        WHERE id = ?1 AND status = 'live' AND guest_joins < ?2`
    )
    .bind(id, cap)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/** Give a slot back when the guest did not actually get in (the relay failed). */
export async function returnGuestSlot(db: LiveDb, id: string): Promise<void> {
  await db
    .prepare(
      'UPDATE live_sessions SET guest_joins = guest_joins - 1 WHERE id = ?1 AND guest_joins > 0'
    )
    .bind(id)
    .run();
}

/** Count one guest turned away at the cap. An integer, nothing about the guest. */
export async function countCapRefusal(db: LiveDb, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE live_sessions SET cap_refusals = cap_refusals + 1 WHERE id = ?1 AND status = 'live'"
    )
    .bind(id)
    .run();
}

/**
 * Count one join admitted on a rejoin pass, if the session is live and
 * still under the ceiling. One conditional statement, like a guest slot.
 * False means the pass is not honoured: the viewer is a new guest.
 */
export async function takePassRejoin(db: LiveDb, id: string, ceiling: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_sessions SET pass_rejoins = pass_rejoins + 1
        WHERE id = ?1 AND status = 'live' AND pass_rejoins < ?2`
    )
    .bind(id, ceiling)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

/** Give a pass rejoin back when the viewer did not actually get in. */
export async function returnPassRejoin(db: LiveDb, id: string): Promise<void> {
  await db
    .prepare(
      'UPDATE live_sessions SET pass_rejoins = pass_rejoins - 1 WHERE id = ?1 AND pass_rejoins > 0'
    )
    .bind(id)
    .run();
}

// ── Sweep, admin and retention ───────────────────────────────────────

/** A session the sweep has to look at. Server-side only. */
export interface SweepRow {
  id: string;
  status: LiveSessionStatus;
  cf_input_uid: string | null;
  created_at: number;
  started_at: number | null;
  disconnected_streak: number;
}

/** Sessions that have not ended, oldest first. */
export async function listOpenSessions(db: LiveDb, limit: number): Promise<SweepRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, status, cf_input_uid, created_at, started_at, disconnected_streak
         FROM live_sessions WHERE status != 'ended' ORDER BY created_at LIMIT ?1`
    )
    .bind(limit)
    .all<SweepRow>();
  return results;
}

/**
 * Count one more "not broadcasting" reading. Conditional on the streak
 * the caller saw and on the session not having ended, so two sweeps that
 * overlap cannot both count the same reading. Returns whether it applied.
 */
export async function bumpStreak(db: LiveDb, id: string, seen: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_sessions SET disconnected_streak = disconnected_streak + 1
        WHERE id = ?1 AND status != 'ended' AND disconnected_streak = ?2`
    )
    .bind(id, seen)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function resetStreak(db: LiveDb, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE live_sessions SET disconnected_streak = 0 WHERE id = ?1 AND status != 'ended' AND disconnected_streak != 0"
    )
    .bind(id)
    .run();
}

/** Ended sessions whose Cloudflare input has not been confirmed deleted. */
export async function listEndedWithInput(
  db: LiveDb,
  limit: number
): Promise<{ id: string; cf_input_uid: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT id, cf_input_uid FROM live_sessions
        WHERE status = 'ended' AND cf_input_uid IS NOT NULL ORDER BY ended_at LIMIT ?1`
    )
    .bind(limit)
    .all<{ id: string; cf_input_uid: string }>();
  return results;
}

/** Every input id currently recorded on any row. */
export async function listRecordedInputs(db: LiveDb): Promise<Set<string>> {
  const { results } = await db
    .prepare('SELECT cf_input_uid FROM live_sessions WHERE cf_input_uid IS NOT NULL LIMIT ?1')
    .bind(10_000)
    .all<{ cf_input_uid: string }>();
  return new Set(results.map((r) => r.cf_input_uid));
}

/**
 * Delete ended rows older than the retention period. Kept regardless of
 * age: a row that still has an input to delete (until that is done), and
 * a reported row: while its hold is open, and after release until its
 * reports have aged out (the report retention, 90 days), so a report
 * never outlives the session it is about.
 */
export async function deleteOldEndedRows(db: LiveDb, endedBefore: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM live_sessions
        WHERE status = 'ended' AND ended_at < ?1 AND cf_input_uid IS NULL
          AND NOT EXISTS (SELECT 1 FROM live_holds h WHERE h.session_id = live_sessions.id)
          AND NOT EXISTS (SELECT 1 FROM live_reports r WHERE r.session_id = live_sessions.id)`
    )
    .bind(endedBefore)
    .run();
  return result.meta?.changes ?? 0;
}

/** What an admin sees about a session. No input id, token or lock. */
export interface AdminSessionView {
  id: string;
  host_pubkey: string;
  title: string;
  status: LiveSessionStatus;
  end_reason: LiveEndReason | null;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  reconnects: number;
  guest_joins: number;
  cap_refusals: number;
  pass_rejoins: number;
  disconnected_streak: number;
  input_recorded: boolean;
  /** The report hold: 'open', 'released', or null when never reported. */
  hold_status: 'open' | 'released' | null;
  hold_opened_at: number | null;
}

/**
 * Sessions an admin has to see: open ones, ended ones whose input is not
 * confirmed deleted yet, and every session under an open report hold.
 */
export async function listSessionsForAdmin(db: LiveDb, limit: number): Promise<AdminSessionView[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.host_pubkey, s.title, s.status, s.end_reason, s.created_at, s.started_at,
              s.ended_at, s.reconnects, s.guest_joins, s.cap_refusals, s.pass_rejoins,
              s.disconnected_streak, (s.cf_input_uid IS NOT NULL) AS input_recorded,
              h.status AS hold_status, h.opened_at AS hold_opened_at
         FROM live_sessions s LEFT JOIN live_holds h ON h.session_id = s.id
        WHERE s.status != 'ended' OR s.cf_input_uid IS NOT NULL OR h.status = 'open'
        ORDER BY s.created_at DESC LIMIT ?1`
    )
    .bind(limit)
    .all<Omit<AdminSessionView, 'input_recorded'> & { input_recorded: number }>();
  return results.map((r) => ({
    ...r,
    input_recorded: !!r.input_recorded,
    hold_status: r.hold_status ?? null,
    hold_opened_at: r.hold_opened_at ?? null
  }));
}

// ── Approved hosts (staged rollout) ──────────────────────────────────

/** True when this account is on the approved-hosts list. */
export async function isHostApproved(db: LiveDb, pubkey: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM live_approved_hosts WHERE pubkey = ?1')
    .bind(pubkey.toLowerCase())
    .first<{ x: number }>();
  return !!row;
}

/** Add to or remove from the approved list. Returns whether anything changed. */
export async function setHostApproved(
  db: LiveDb,
  pubkey: string,
  approved: boolean,
  addedBy: string
): Promise<boolean> {
  const pk = pubkey.toLowerCase();
  const result = approved
    ? await db
        .prepare(
          'INSERT OR IGNORE INTO live_approved_hosts (pubkey, created_at, added_by) VALUES (?1, ?2, ?3)'
        )
        .bind(pk, nowSeconds(), addedBy)
        .run()
    : await db.prepare('DELETE FROM live_approved_hosts WHERE pubkey = ?1').bind(pk).run();
  return (result.meta?.changes ?? 0) === 1;
}

export async function listApprovedHosts(
  db: LiveDb,
  limit = 1000
): Promise<{ pubkey: string; created_at: number; added_by: string }[]> {
  const { results } = await db
    .prepare(
      'SELECT pubkey, created_at, added_by FROM live_approved_hosts ORDER BY created_at DESC LIMIT ?1'
    )
    .bind(limit)
    .all<{ pubkey: string; created_at: number; added_by: string }>();
  return results;
}

// ── Host blocks ──────────────────────────────────────────────────────

/** True when the admin has blocked this account from hosting. */
export async function isHostBlocked(db: LiveDb, pubkey: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM live_blocked_hosts WHERE pubkey = ?1')
    .bind(pubkey.toLowerCase())
    .first<{ x: number }>();
  return !!row;
}

/** Block or unblock one account. Idempotent either way. */
export async function setHostBlocked(db: LiveDb, pubkey: string, blocked: boolean): Promise<void> {
  const pk = pubkey.toLowerCase();
  if (blocked) {
    await db
      .prepare('INSERT OR IGNORE INTO live_blocked_hosts (pubkey, created_at) VALUES (?1, ?2)')
      .bind(pk, nowSeconds())
      .run();
  } else {
    await db.prepare('DELETE FROM live_blocked_hosts WHERE pubkey = ?1').bind(pk).run();
  }
}

export async function listBlockedHosts(
  db: LiveDb,
  limit = 500
): Promise<{ pubkey: string; created_at: number }[]> {
  const { results } = await db
    .prepare('SELECT pubkey, created_at FROM live_blocked_hosts ORDER BY created_at DESC LIMIT ?1')
    .bind(limit)
    .all<{ pubkey: string; created_at: number }>();
  return results;
}

/** Ids of one host's sessions that have not ended. */
export async function listOpenSessionIdsForHost(db: LiveDb, hostPubkey: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT id FROM live_sessions WHERE host_pubkey = ?1 AND status != 'ended'")
    .bind(hostPubkey)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/**
 * Delete every row of one host, except rows under a report hold (a
 * deletion must not destroy a record a report is about). Returns how many
 * were removed.
 */
export async function deleteRowsForHost(db: LiveDb, hostPubkey: string): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM live_sessions WHERE host_pubkey = ?1
          AND NOT EXISTS (SELECT 1 FROM live_holds h
                           WHERE h.session_id = live_sessions.id AND h.status = 'open')`
    )
    .bind(hostPubkey)
    .run();
  return result.meta?.changes ?? 0;
}

/** Sessions that are live right now, newest first, in the public shape. */
export async function listLiveSessions(db: LiveDb, limit = 50): Promise<PublicLiveSession[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SESSION_COLUMNS} FROM live_sessions
        WHERE status = 'live' ORDER BY started_at DESC LIMIT ?1`
    )
    .bind(limit)
    .all<LiveSessionRow>();
  return results.map(toPublicSession);
}

// ── "Live now" note ──────────────────────────────────────────────────

const NOTE_ID_RE = /^[0-9a-f]{64}$/;

export function isNoteId(value: unknown): value is string {
  return typeof value === 'string' && NOTE_ID_RE.test(value);
}

/**
 * Record the session's "Live now" note. Set once, and only while the
 * session has not ended. Returns whether it was recorded.
 */
export async function setSessionNote(db: LiveDb, id: string, noteId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE live_sessions SET note_id = ?2
        WHERE id = ?1 AND note_id IS NULL AND status != 'ended'`
    )
    .bind(id, noteId)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

// ── Hidden commenters ────────────────────────────────────────────────
//
// Commenters left out of Go live chats by moderation: per host (the host
// hid them, in all their streams) or global (the admin hid them
// everywhere). Keys are commenters' public keys, never viewers'.

export const HIDDEN_GLOBAL_SCOPE = 'global';
/** Upper bound per scope, so a runaway client cannot grow a list without end. */
export const HIDDEN_MAX_PER_SCOPE = 5000;

export interface HiddenAuthor {
  pubkey: string;
  /** 'host': hidden by this session's host; 'global': hidden by the admin everywhere. */
  scope: 'host' | 'global';
}

/** Everyone hidden from this host's chats: the host's own list plus the global one. */
export async function listHiddenForHost(db: LiveDb, host: string): Promise<HiddenAuthor[]> {
  const { results } = await db
    .prepare(
      `SELECT pubkey, scope FROM live_hidden_authors
        WHERE scope = ?1 OR scope = ?2 ORDER BY created_at, pubkey LIMIT ?3`
    )
    .bind(host, HIDDEN_GLOBAL_SCOPE, HIDDEN_MAX_PER_SCOPE * 2)
    .all<{ pubkey: string; scope: string }>();
  return results.map((r) => ({
    pubkey: r.pubkey,
    scope: r.scope === HIDDEN_GLOBAL_SCOPE ? 'global' : 'host'
  }));
}

/**
 * Hide or unhide one commenter in one scope (a host pubkey or 'global').
 * Returns 'ok', or 'full' when the scope already holds the maximum.
 */
export async function setHiddenAuthor(
  db: LiveDb,
  scope: string,
  pubkey: string,
  hidden: boolean
): Promise<'ok' | 'full'> {
  if (!hidden) {
    await db
      .prepare('DELETE FROM live_hidden_authors WHERE scope = ?1 AND pubkey = ?2')
      .bind(scope, pubkey)
      .run();
    return 'ok';
  }
  // One conditional insert: only while the scope is under its cap.
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO live_hidden_authors (scope, pubkey, created_at)
       SELECT ?1, ?2, ?3
        WHERE (SELECT COUNT(*) FROM live_hidden_authors WHERE scope = ?1) < ?4`
    )
    .bind(scope, pubkey, nowSeconds(), HIDDEN_MAX_PER_SCOPE)
    .run();
  if ((result.meta?.changes ?? 0) === 1) return 'ok';
  const exists = await db
    .prepare('SELECT 1 AS x FROM live_hidden_authors WHERE scope = ?1 AND pubkey = ?2')
    .bind(scope, pubkey)
    .first<{ x: number }>();
  return exists ? 'ok' : 'full';
}
