/**
 * Go live — the publish relay and input cleanup.
 *
 * `publishSession` is the whole of "the host goes live": under the
 * per-session lock it deletes the previous Cloudflare input, creates a
 * fresh one, relays the host's SDP offer to it once, and marks the
 * session live. It returns the SDP answer and nothing else from
 * Cloudflare.
 *
 * Why a fresh input every time: deleting an input ends its broadcast for
 * viewers, but only while that input has carried a single broadcast. An
 * input that received a second publish keeps the first one running where
 * no server action can stop it (observed; see the spike report). One
 * relayed publish per input, with the publish URL never leaving this
 * request, is what keeps End and the kill switch effective.
 *
 * Failure rules:
 *  - Any failure releases the lock, so the host can try again at once.
 *  - No path leaves an input that the database does not know about: an
 *    input is written to the row as soon as it exists and removed from
 *    the row only after Cloudflare confirms the delete. An input that
 *    cannot be deleted stays on the row for the sweep to retry.
 *  - The session is marked live only after Cloudflare has answered the
 *    offer for the input now on the row.
 *
 * Nothing here logs SDP, a Stream URL or an input id.
 */
import {
  acquirePublishLock,
  clearInput,
  clearInputUnderLock,
  getRelayState,
  markLiveUnderLock,
  recordInputUnderLock,
  recordOrphanInput,
  releasePublishLock,
  type LiveDb
} from './sessions.server';
import { createLiveInput, deleteLiveInput, relayOffer, type StreamConfig } from './stream.server';

export type PublishResult =
  | { ok: true; answer: ArrayBuffer }
  /** Another publish holds the lock. Try again shortly. */
  | { ok: false; reason: 'busy' }
  /** The session has ended. Not retryable. */
  | { ok: false; reason: 'ended' }
  /** The session has used all its publish attempts. Not retryable. */
  | { ok: false; reason: 'attempt_limit' }
  /** Cloudflare failed or did not answer. Try again. */
  | { ok: false; reason: 'unavailable' }
  /** Cloudflare refused this particular offer. Retrying it will not help. */
  | { ok: false; reason: 'offer_rejected' };

/** Operator-facing name of a session's input. Never sent to a client. */
export const inputNameFor = (sessionId: string) => `zc-live-${sessionId}`;

/**
 * Delete an input that IS recorded on the row. On a confirmed delete the
 * row forgets it; otherwise it stays recorded for the sweep.
 */
async function discardRecorded(
  db: LiveDb,
  cfg: StreamConfig,
  id: string,
  uid: string,
  step: string
): Promise<boolean> {
  const outcome = await deleteLiveInput(cfg, uid);
  if (outcome === 'failed') {
    console.error(
      `[Live] session ${id}: input not deleted after ${step}; left recorded for the sweep`
    );
    return false;
  }
  await clearInput(db, id, uid);
  return true;
}

/**
 * Delete an input that is NOT on the row (the lock was lost or the session
 * ended before it could be recorded). If the delete fails, write it to the
 * row when the row has room, so the sweep can still find it.
 */
async function discardUnrecorded(
  db: LiveDb,
  cfg: StreamConfig,
  id: string,
  uid: string,
  step: string
): Promise<void> {
  const outcome = await deleteLiveInput(cfg, uid);
  if (outcome !== 'failed') return;
  const recorded = await recordOrphanInput(db, id, uid);
  console.error(
    recorded
      ? `[Live] session ${id}: input not deleted after ${step}; recorded for the sweep`
      : `[Live] session ${id}: ORPHAN input "${inputNameFor(id)}" not deleted after ${step} and not recordable; delete it by name`
  );
}

/** The lock is gone: say why, as precisely as the row allows. */
async function lostLock(db: LiveDb, id: string): Promise<PublishResult> {
  const state = await getRelayState(db, id);
  return { ok: false, reason: !state || state.status === 'ended' ? 'ended' : 'busy' };
}

export async function publishSession(
  db: LiveDb,
  cfg: StreamConfig,
  id: string,
  offer: Uint8Array
): Promise<PublishResult> {
  const lock = await acquirePublishLock(db, id);
  if (!lock.ok) {
    if (lock.reason === 'attempt_limit') return { ok: false, reason: 'attempt_limit' };
    return lostLock(db, id);
  }
  const { nonce } = lock;

  try {
    // 1. Delete the previous input. This is what ends the previous
    //    broadcast; if it cannot be confirmed, stop here rather than
    //    start a second broadcast that would leave the first unkillable.
    const before = await getRelayState(db, id);
    if (!before || before.status === 'ended') return { ok: false, reason: 'ended' };
    if (before.cf_input_uid) {
      if ((await deleteLiveInput(cfg, before.cf_input_uid)) === 'failed') {
        await releasePublishLock(db, id, nonce);
        return { ok: false, reason: 'unavailable' };
      }
      if (!(await clearInputUnderLock(db, id, nonce))) return lostLock(db, id);
    }

    // 2. Create a fresh input.
    const created = await createLiveInput(cfg, inputNameFor(id));
    if (!created.ok) {
      await releasePublishLock(db, id, nonce);
      return { ok: false, reason: 'unavailable' };
    }
    const { uid, publishUrl, playUrl } = created.input;

    // 3. Record it before using it.
    if (!(await recordInputUnderLock(db, id, nonce, uid))) {
      await discardUnrecorded(db, cfg, id, uid, 'losing the lock');
      return lostLock(db, id);
    }

    // 4. Relay the offer, once.
    const relayed = await relayOffer(publishUrl, offer, 'publish');
    if (!relayed.ok) {
      await discardRecorded(db, cfg, id, uid, 'a failed relay');
      await releasePublishLock(db, id, nonce);
      // If the session was ended while the offer was in flight, End has
      // already deleted the input and that is why the relay failed. Say so.
      const after = await getRelayState(db, id);
      if (!after || after.status === 'ended') return { ok: false, reason: 'ended' };
      return {
        ok: false,
        reason: relayed.reason === 'rejected' ? 'offer_rejected' : 'unavailable'
      };
    }

    // 5. Only now is the session live.
    if (!(await markLiveUnderLock(db, id, nonce, uid, playUrl))) {
      await discardRecorded(db, cfg, id, uid, 'the session ending mid-publish');
      return lostLock(db, id);
    }
    return { ok: true, answer: relayed.answer };
  } catch (err) {
    // A database error mid-flight. Free the host to retry; the row still
    // names any input that was recorded.
    console.error(`[Live] session ${id}: publish failed: ${(err as Error)?.name ?? 'error'}`);
    await releasePublishLock(db, id, nonce).catch(() => undefined);
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * After a session has been ended: delete its Cloudflare input, which is
 * what actually stops the broadcast for viewers.
 *
 *   'none'     no input was recorded
 *   'deleted'  the input is gone and the row has forgotten it
 *   'pending'  the delete could not be confirmed (or Stream is not
 *              configured). The session is still ended; the input id
 *              stays on the row so the sweep can retry.
 */
export async function removeInputAfterEnd(
  db: LiveDb,
  cfg: StreamConfig | null,
  id: string
): Promise<'none' | 'deleted' | 'pending'> {
  const state = await getRelayState(db, id);
  if (!state?.cf_input_uid) return 'none';
  if (!cfg) {
    console.error(
      `[Live] session ${id}: ended, but Stream is not configured; input left for the sweep`
    );
    return 'pending';
  }
  return (await discardRecorded(db, cfg, id, state.cf_input_uid, 'the session ending'))
    ? 'deleted'
    : 'pending';
}
