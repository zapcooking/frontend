/**
 * Go live — the access-request queue (table live_access_requests).
 *
 * A member who is not on the approved-hosts list can ask to host, with an
 * optional note ("what you'd cook, how often"). At most one request per
 * account is pending at a time (a partial unique index). The admin
 * approves (the account is added to the approved list) or declines; both
 * are logged by the admin route. A declined account may ask again
 * LIVE_ACCESS_DECLINE_COOLDOWN_SECONDS after the decision.
 */
import { LIVE_ACCESS_DECLINE_COOLDOWN_SECONDS } from './config';
import { nowSeconds, setHostApproved, type LiveDb } from './sessions.server';

export type AccessRequestStatus = 'pending' | 'approved' | 'declined';

export interface AccessRequestRow {
  id: string;
  pubkey: string;
  note: string;
  status: AccessRequestStatus;
  created_at: number;
  decided_at: number | null;
}

/** What the requester sees about their own latest request. */
export interface OwnRequestState {
  status: AccessRequestStatus | 'none';
  created_at: number | null;
  decided_at: number | null;
  /** When a declined account may ask again; null when it may ask now (or need not). */
  retry_at: number | null;
}

const COLUMNS = 'id, pubkey, note, status, created_at, decided_at';

export async function latestRequestFor(
  db: LiveDb,
  pubkey: string
): Promise<AccessRequestRow | null> {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM live_access_requests WHERE pubkey = ?1
        ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .bind(pubkey.toLowerCase())
    .first<AccessRequestRow>();
}

export async function ownRequestState(
  db: LiveDb,
  pubkey: string,
  now: number = nowSeconds()
): Promise<OwnRequestState> {
  const row = await latestRequestFor(db, pubkey);
  if (!row) return { status: 'none', created_at: null, decided_at: null, retry_at: null };
  const retryAt =
    row.status === 'declined' && row.decided_at !== null
      ? row.decided_at + LIVE_ACCESS_DECLINE_COOLDOWN_SECONDS
      : null;
  return {
    status: row.status,
    created_at: row.created_at,
    decided_at: row.decided_at,
    retry_at: retryAt !== null && retryAt > now ? retryAt : null
  };
}

export type CreateRequestResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'already_pending' }
  | { ok: false; reason: 'declined_recently'; retry_at: number };

/** Save a new pending request, unless one is pending or a decline is too recent. */
export async function createAccessRequest(
  db: LiveDb,
  input: { pubkey: string; note: string; now?: number }
): Promise<CreateRequestResult> {
  const now = input.now ?? nowSeconds();
  const pubkey = input.pubkey.toLowerCase();
  const state = await ownRequestState(db, pubkey, now);
  if (state.status === 'pending') return { ok: false, reason: 'already_pending' };
  if (state.retry_at !== null) {
    return { ok: false, reason: 'declined_recently', retry_at: state.retry_at };
  }
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO live_access_requests (id, pubkey, note, status, created_at)
         VALUES (?1, ?2, ?3, 'pending', ?4)`
      )
      .bind(id, pubkey, input.note, now)
      .run();
  } catch (err) {
    // Two simultaneous requests: the partial unique index lets one in.
    if (err instanceof Error && /UNIQUE constraint failed: live_access_requests\.pubkey/.test(err.message)) {
      return { ok: false, reason: 'already_pending' };
    }
    throw err;
  }
  return { ok: true, id };
}

export async function listPendingRequests(db: LiveDb, limit = 100): Promise<AccessRequestRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM live_access_requests WHERE status = 'pending'
        ORDER BY created_at, rowid LIMIT ?1`
    )
    .bind(limit)
    .all<AccessRequestRow>();
  return results;
}

export async function countPendingRequests(db: LiveDb): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM live_access_requests WHERE status = 'pending'")
    .bind()
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * Decide a pending request. Approving also adds the account to the
 * approved-hosts list. Returns the request, or null when it was not
 * pending (already decided, or unknown).
 */
export async function decideRequest(
  db: LiveDb,
  id: string,
  decision: 'approved' | 'declined',
  actor: string,
  now: number = nowSeconds()
): Promise<AccessRequestRow | null> {
  const result = await db
    .prepare(
      `UPDATE live_access_requests SET status = ?2, decided_at = ?3
        WHERE id = ?1 AND status = 'pending'`
    )
    .bind(id, decision, now)
    .run();
  if ((result.meta?.changes ?? 0) !== 1) return null;
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM live_access_requests WHERE id = ?1`)
    .bind(id)
    .first<AccessRequestRow>();
  if (row && decision === 'approved') await setHostApproved(db, row.pubkey, true, actor);
  return row;
}

/**
 * The account was approved directly (not from its request): close its
 * pending request as approved, so the queue does not keep it.
 */
export async function resolvePendingAsApproved(
  db: LiveDb,
  pubkey: string,
  now: number = nowSeconds()
): Promise<void> {
  await db
    .prepare(
      `UPDATE live_access_requests SET status = 'approved', decided_at = ?2
        WHERE pubkey = ?1 AND status = 'pending'`
    )
    .bind(pubkey.toLowerCase(), now)
    .run();
}
