/** Durable Go Live safety intake. Not an automated NCMEC reporting system. */
import { endAndRemove } from './admin.server';
import { getSession, type LiveDb } from './sessions.server';
import type { StreamConfig } from './stream.server';

export type SafetyReason = 'child_safety' | 'nudity' | 'violence' | 'spam' | 'other';
export const SAFETY_REASONS = new Set<SafetyReason>(['child_safety','nudity','violence','spam','other']);
export const DEFAULT_AUTO_THRESHOLD = 3;

/**
 * Reporter identities are daily salted, pseudonymous IP hashes returned by
 * checkPerIpRateLimit. They are NOT proof of independent people.
 * No auto enforcement when that identifier is missing or degraded.
 */
export async function submitLiveSafetyReport(
  db: LiveDb,
  cfg: StreamConfig | null,
  params: {
    sessionId: string;
    reporterHash: string;
    reason: SafetyReason;
    details: string;
    autoShutdown: boolean;
    threshold?: number;
    now?: number;
  }
): Promise<{ recorded: boolean; duplicate: boolean; count: number; ended: boolean; urgent: boolean }> {
  const session = await getSession(db, params.sessionId);
  if (!session) throw new Error('not_found');
  const now = params.now ?? Math.floor(Date.now()/1000);
  const urgent = params.reason === 'child_safety' || params.reason === 'violence';
  const trustedHash = /^[0-9a-f]{64}$/.test(params.reporterHash);
  const reporterHash = trustedHash ? params.reporterHash : `unverified:${crypto.randomUUID()}`;
  const id = crypto.randomUUID();

  // First write evidence before any enforcement. A safety hold is created for
  // every reported session so the ordinary 30-day sweep cannot erase it.
  const record = await db.prepare(
    'INSERT OR IGNORE INTO live_safety_reports (id, session_id, reporter_hash, reason, details, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
  ).bind(id, params.sessionId, reporterHash, params.reason, params.details.slice(0,300), now).run();
  const recorded = (record.meta?.changes ?? 0) === 1;
  await db.prepare(
    "INSERT OR IGNORE INTO live_safety_holds (session_id, opened_at, reason, status) VALUES (?1, ?2, ?3, 'open')"
  ).bind(params.sessionId, now, 'moderation_review').run();

  // D1 is authoritative for the tally. Only reports with a stable
  // pseudonymous identifier count. Daily salt rotation can allow re-votes;
  // mitigate with a short 90-minute live stream and off-by-default enforcement.
  const countRow = await db.prepare(
    "SELECT COUNT(*) AS count FROM live_safety_reports WHERE session_id = ?1 AND reporter_hash NOT LIKE 'unverified:%'"
  ).bind(params.sessionId).first<{count:number}>();
  const count = Number(countRow?.count ?? 0);
  const threshold = Math.max(DEFAULT_AUTO_THRESHOLD, Math.min(10, params.threshold ?? DEFAULT_AUTO_THRESHOLD));
  let ended = false;
  if (recorded && trustedHash && params.autoShutdown && count >= threshold && session.status !== 'ended') {
    // Idempotent DB end. Failed Cloudflare input deletion is retried by sweep.
    // This is temporary stream termination, not a permanent membership ban.
    const outcome = await endAndRemove(db, cfg, params.sessionId, 'admin');
    ended = outcome.ended;
    if (ended) {
      await db.prepare('INSERT INTO live_safety_actions (id,session_id,action,reason,occurred_at) VALUES (?1,?2,?3,?4,?5)')
        .bind(crypto.randomUUID(),params.sessionId,'auto_end','independent_report_threshold',now).run();
    }
  }
  return { recorded, duplicate: !recorded, count, ended, urgent };
}
