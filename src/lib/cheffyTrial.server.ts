import { CHEFFY_TRIAL_LIMIT } from './cheffyTrial';

export interface TrialDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}

export function validTrialRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(value);
}

export async function trialRemaining(db: TrialDatabase, pubkey: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS used FROM cheffy_trial_turns WHERE pubkey = ?')
    .bind(pubkey)
    .first<{ used: number }>();
  return Math.max(0, CHEFFY_TRIAL_LIMIT - Number(row?.used ?? 0));
}

/** One SQL write serializes concurrent reservations across all Workers. */
export async function reserveTrial(
  db: TrialDatabase,
  pubkey: string,
  requestId: string
): Promise<'reserved' | 'pending' | 'completed' | 'exhausted'> {
  const result = await db
    .prepare(
      `INSERT INTO cheffy_trial_turns (pubkey, request_id, status, created_at)
    SELECT ?, ?, 'pending', ?
    WHERE (SELECT COUNT(*) FROM cheffy_trial_turns WHERE pubkey = ?) < ?
    ON CONFLICT (pubkey, request_id) DO NOTHING`
    )
    .bind(pubkey, requestId, Date.now(), pubkey, CHEFFY_TRIAL_LIMIT)
    .run();
  if (result.meta.changes === 1) return 'reserved';
  const row = await db
    .prepare('SELECT status FROM cheffy_trial_turns WHERE pubkey = ? AND request_id = ?')
    .bind(pubkey, requestId)
    .first<{ status: 'pending' | 'completed' }>();
  return row?.status ?? 'exhausted';
}

export async function finishTrial(
  db: TrialDatabase,
  pubkey: string,
  requestId: string
): Promise<number> {
  await db
    .prepare(
      "UPDATE cheffy_trial_turns SET status = 'completed' WHERE pubkey = ? AND request_id = ? AND status = 'pending'"
    )
    .bind(pubkey, requestId)
    .run();
  return trialRemaining(db, pubkey);
}

/** Only failed attempts release reservations; successful IDs remain for deduplication. */
export async function releaseTrial(
  db: TrialDatabase,
  pubkey: string,
  requestId: string
): Promise<void> {
  await db
    .prepare(
      "DELETE FROM cheffy_trial_turns WHERE pubkey = ? AND request_id = ? AND status = 'pending'"
    )
    .bind(pubkey, requestId)
    .run();
}
