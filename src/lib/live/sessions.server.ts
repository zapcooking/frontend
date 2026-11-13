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
import { LIVE_RECIPE_D_MAX, LIVE_RECIPE_KINDS, LIVE_TITLE_MAX } from './config';

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
}

const SESSION_COLUMNS =
  'id, host_pubkey, title, recipe_a, host_token_hash, status, end_reason, created_at, started_at, ended_at';

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
    ended_at: row.ended_at
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

/** Sessions this host created since `sinceSeconds`, ended ones included. */
export async function countRecentCreates(
  db: LiveDb,
  hostPubkey: string,
  sinceSeconds: number
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS c FROM live_sessions WHERE host_pubkey = ?1 AND created_at > ?2')
    .bind(hostPubkey, sinceSeconds)
    .first<{ c: number }>();
  return row?.c ?? 0;
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
  | { ok: false; reason: 'already_active' };

/**
 * Insert a new session in status 'created'. The partial unique index is
 * what guarantees one active session per host, so two simultaneous creates
 * cannot both succeed; the loser reports `already_active`. Every other
 * failure is rethrown.
 */
export async function createSession(
  db: LiveDb,
  input: { hostPubkey: string; title: string; recipeA: string | null; now?: number }
): Promise<CreateSessionResult> {
  const id = newSessionId();
  const hostToken = newHostToken();
  const hash = await hashHostToken(hostToken);
  const now = input.now ?? nowSeconds();
  try {
    await db
      .prepare(
        `INSERT INTO live_sessions (id, host_pubkey, title, recipe_a, host_token_hash, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'created', ?6)`
      )
      .bind(id, input.hostPubkey, input.title, input.recipeA, hash, now)
      .run();
  } catch (err) {
    if (isOneActiveViolation(err)) return { ok: false, reason: 'already_active' };
    // Anything else (an id collision, a NOT NULL failure, a database
    // error) is not "this host already has a session" and must surface.
    throw err;
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
      ended_at: null
    }
  };
}

/**
 * End a session. One conditional statement: it only applies to a session
 * that has not ended, so a second call (or a race with another actor)
 * changes nothing. Ending also clears the host token hash and any publish
 * lock, so the token cannot be used again.
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
              host_token_hash = '', publish_lock = NULL, publish_lock_at = NULL
        WHERE id = ?1 AND status != 'ended'`
    )
    .bind(id, reason, now)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}
