/**
 * Account deletion requests — shared by /api/account/deletion-request
 * (the member) and /api/admin/deletion-requests (staff).
 *
 * A request does two things immediately, because they are ours to do
 * and waiting on them costs the member something:
 *   - stops Stripe renewal (cancel_at_period_end), so nobody is billed
 *     while the request waits for staff;
 *   - deletes the member's scheduled posts, which we hold encrypted in
 *     SCHEDULER_DB and would otherwise keep publishing on their behalf.
 * Everything else — membership and credit records on member-relay,
 * events on Pantry — is staff work against the 'pending' row, within
 * the 30 days /delete-account promises.
 */

export const DELETION_SOURCES = ['web', 'ios', 'android', 'other'] as const;
export type DeletionSource = (typeof DELETION_SOURCES)[number];

export type BillingOutcome = 'cancelled' | 'none' | 'error' | 'unavailable';

export interface DeletionRequestRow {
  id: number;
  pubkey: string;
  status: 'pending' | 'completed';
  source: DeletionSource;
  billing: BillingOutcome;
  scheduled_posts_removed: number;
  attempts: number;
  requested_at: number;
  updated_at: number;
  completed_at: number | null;
}

type D1 = NonNullable<NonNullable<App.Platform['env']>['SCHEDULER_DB']>;

/** Subscription states that can still renew and charge the member. */
const RENEWING_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid']);

export function parseDeletionSource(value: unknown): DeletionSource {
  return (DELETION_SOURCES as readonly unknown[]).includes(value)
    ? (value as DeletionSource)
    : 'other';
}

/**
 * Stop every renewing Stripe subscription stamped with this pubkey.
 *
 * Uses the same `metadata['pubkey']` search as create-portal-session.
 * Subscriptions created before that metadata existed are not findable
 * here — they surface to staff as billing 'none' and are cancelled by
 * hand, which is why 'none' is not proof there is nothing to cancel.
 */
export async function cancelStripeRenewal(
  pubkey: string,
  stripeKey: string | undefined
): Promise<BillingOutcome> {
  if (!stripeKey) return 'unavailable';
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2025-12-15.clover',
      typescript: true
    });
    const found = await stripe.subscriptions.search({
      query: `metadata['pubkey']:'${pubkey}'`,
      limit: 10
    });
    const renewing = found.data.filter((s) => RENEWING_STATUSES.has(s.status));
    if (renewing.length === 0) return 'none';
    for (const sub of renewing) {
      if (!sub.cancel_at_period_end) {
        await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      }
    }
    return 'cancelled';
  } catch (error: any) {
    console.error('[Account Deletion] Stripe cancellation failed:', error?.message);
    return 'error';
  }
}

/**
 * Delete the member's scheduled posts. Rows mid-broadcast ('publishing')
 * are left for the sweep to finish; staff removes them with the rest.
 */
export async function purgeScheduledPosts(db: D1, pubkey: string): Promise<number> {
  const result = await db
    .prepare("DELETE FROM scheduled_events WHERE pubkey = ? AND status != 'publishing'")
    .bind(pubkey)
    .run();
  return result.meta.changes;
}

/**
 * Record a request. At most one pending row per pubkey (a partial unique
 * index), so a repeat while pending folds into it: the 30-day clock
 * (requested_at) keeps its first value, billing takes the latest
 * attempt's outcome, and attempts counts the repeats. A repeat after
 * completion — delete, restore from an exported key, delete again —
 * inserts a new row and leaves the completed one as the record.
 */
export async function upsertDeletionRequest(
  db: D1,
  row: Pick<DeletionRequestRow, 'pubkey' | 'source' | 'billing' | 'scheduled_posts_removed'>,
  now: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO account_deletion_requests
         (pubkey, status, source, billing, scheduled_posts_removed, attempts, requested_at, updated_at)
       VALUES (?, 'pending', ?, ?, ?, 1, ?, ?)
       ON CONFLICT(pubkey) WHERE status = 'pending' DO UPDATE SET
         source = excluded.source,
         billing = excluded.billing,
         scheduled_posts_removed = scheduled_posts_removed + excluded.scheduled_posts_removed,
         attempts = attempts + 1,
         updated_at = excluded.updated_at`
    )
    .bind(row.pubkey, row.source, row.billing, row.scheduled_posts_removed, now, now)
    .run();
}

/** The pubkey's most recent request, pending or completed. */
export async function getDeletionRequest(
  db: D1,
  pubkey: string
): Promise<DeletionRequestRow | null> {
  return db
    .prepare('SELECT * FROM account_deletion_requests WHERE pubkey = ? ORDER BY id DESC LIMIT 1')
    .bind(pubkey)
    .first<DeletionRequestRow>();
}

export async function listDeletionRequests(
  db: D1,
  status: DeletionRequestRow['status']
): Promise<DeletionRequestRow[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM account_deletion_requests WHERE status = ? ORDER BY requested_at ASC, id ASC LIMIT 200'
    )
    .bind(status)
    .all<DeletionRequestRow>();
  return results;
}

/**
 * Staff marks a pubkey's pending request done — after membership,
 * credits, Pantry, and (whenever billing is not 'cancelled') a manual
 * Stripe check. Returns false when there is no pending row.
 */
export async function completeDeletionRequest(
  db: D1,
  pubkey: string,
  now: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE account_deletion_requests
         SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE pubkey = ? AND status = 'pending'`
    )
    .bind(now, now, pubkey)
    .run();
  return result.meta.changes > 0;
}

/** A pending request whose renewal we could not confirm stopped needs a human in Stripe. */
export function needsBillingCheck(row: Pick<DeletionRequestRow, 'billing'>): boolean {
  return row.billing !== 'cancelled';
}
