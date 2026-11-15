/**
 * Go live — admin actions shared by the admin route and account deletion.
 * Ending always means: mark the session ended, then delete its Cloudflare
 * input. An input whose delete cannot be confirmed stays on the row for
 * the sweep.
 */
import { removeInputAfterEnd } from './relay.server';
import {
  deleteRowsForHost,
  endSession,
  listOpenSessionIdsForHost,
  listOpenSessions,
  setHostBlocked,
  type LiveDb,
  type LiveEndReason
} from './sessions.server';
import type { StreamConfig } from './stream.server';
import { deleteTermsAcceptancesFor } from './terms.server';

export type EndOutcome = {
  /** False when the session had already ended. */
  ended: boolean;
  input: 'none' | 'deleted' | 'pending';
};

/** End one session and delete its input. Safe to call on an ended session. */
export async function endAndRemove(
  db: LiveDb,
  cfg: StreamConfig | null,
  id: string,
  reason: LiveEndReason
): Promise<EndOutcome> {
  const ended = await endSession(db, id, reason);
  // Also run for an already-ended session: this is how an admin retries a
  // delete that could not be confirmed earlier.
  const input = await removeInputAfterEnd(db, cfg, id);
  return { ended, input };
}

/** End every session that has not ended. Used when Go live is switched off. */
export async function endAllOpen(
  db: LiveDb,
  cfg: StreamConfig | null,
  reason: LiveEndReason
): Promise<{ ended: number; inputsPending: number }> {
  let ended = 0;
  let inputsPending = 0;
  // Batches, until none are left (bounded, in case a row cannot be ended).
  for (let round = 0; round < 20; round++) {
    const open = await listOpenSessions(db, 50);
    if (open.length === 0) break;
    for (const row of open) {
      const outcome = await endAndRemove(db, cfg, row.id, reason);
      if (outcome.ended) ended++;
      if (outcome.input === 'pending') inputsPending++;
    }
  }
  return { ended, inputsPending };
}

/**
 * Block an account from hosting, then end its open session (deleting the
 * input). The block is written FIRST: a create or publish racing with
 * this call is refused by the block, so nothing new can start after the
 * end. Returns how many sessions it ended and how many inputs are pending.
 */
export async function blockHost(
  db: LiveDb,
  cfg: StreamConfig | null,
  pubkey: string
): Promise<{ ended: number; inputsPending: number }> {
  const pk = pubkey.toLowerCase();
  await setHostBlocked(db, pk, true);
  let ended = 0;
  let inputsPending = 0;
  for (const id of await listOpenSessionIdsForHost(db, pk)) {
    const outcome = await endAndRemove(db, cfg, id, 'admin');
    if (outcome.ended) ended++;
    if (outcome.input === 'pending') inputsPending++;
  }
  return { ended, inputsPending };
}

/**
 * Account deletion: end the member's open sessions (deleting their
 * inputs) and remove the rows they host, except rows under a report hold.
 * If an input could not be deleted its row is removed all the same; the
 * sweep's orphan check finds the input by name and deletes it. A hosting
 * block is NOT removed: deleting an account must not lift it. The hosting
 * agreement is removed too, unless one of the rows is under a hold or the
 * account is blocked from hosting (the sweep removes it once neither is
 * true: cleanupTermsAcceptances).
 */
export async function purgeLiveSessions(
  db: LiveDb,
  cfg: StreamConfig | null,
  pubkey: string
): Promise<number> {
  for (const id of await listOpenSessionIdsForHost(db, pubkey)) {
    await endAndRemove(db, cfg, id, 'admin');
  }
  const removed = await deleteRowsForHost(db, pubkey);
  await deleteTermsAcceptancesFor(db, pubkey);
  return removed;
}
