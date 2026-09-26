/**
 * Mine, sign and publish a note without the composer having to stay open.
 *
 * Mining a note can take the better part of a minute. Awaiting that inside
 * the composer means the editor sits in the reader's way for the whole
 * mine, and — for the modal — that they cannot use the app at all until it
 * lands. So the composer hands the built event over here and closes; this
 * runs at module scope, reports into the mining store that draws the
 * floating indicator, and finishes the post on its own.
 *
 * The draft is deliberately NOT cleared by the caller. A mine can be
 * stopped and a publish can fail, and the note the reader typed has to
 * survive both; it is cleared here only once the relays have it.
 */
import { nip19 } from 'nostr-tools';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { publishQueue } from '$lib/publishQueue';
import { minePowIntoEvent, powCancel, isPowCanceled } from '$lib/powMiner';
import { startMiningOp, reportMiningBest, markMiningFound, endMiningOp } from '$lib/stores/miningOp';
import { addPendingOp, removePendingOp } from '$lib/stores/pendingOps';
import { showToast } from '$lib/toast';

export interface MinedPostOptions {
  event: NDKEvent;
  bits: number;
  relayMode: string;
  /** localStorage key holding the draft, cleared only on success. */
  draftKey?: string;
}

export async function startMinedPost({
  event,
  bits,
  relayMode,
  draftKey
}: MinedPostOptions): Promise<void> {
  startMiningOp(bits, powCancel);

  try {
    // Mined before it is signed, and it has to be that way round: the
    // signature covers the id, so a nonce settled afterwards would
    // invalidate the signature it was mined under.
    await minePowIntoEvent(event, bits, (p) => reportMiningBest(p.best));
    markMiningFound();
    await event.sign();
  } catch (err) {
    endMiningOp();
    if (isPowCanceled(err)) {
      // The reader pressed Stop. That is an answer, not a failure — say
      // where the note went rather than reporting an error for something
      // they chose.
      showToast('info', 'Mining stopped — your draft is saved', 5000);
      return;
    }
    console.error('[MinedPost] mining or signing failed:', err);
    showToast('error', err instanceof Error ? err.message : 'Failed to mine proof of work');
    return;
  }

  endMiningOp();

  const opId = addPendingOp('Posting...');
  try {
    const result = await publishQueue.publishWithRetry(event, relayMode as never);
    if (result.success) {
      const noteLink = event.id ? `/${nip19.noteEncode(event.id)}` : null;
      showToast(
        'success',
        'Note published',
        12000,
        noteLink ? { label: 'View', href: noteLink } : undefined
      );
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* private mode — the draft simply outlives the post */
        }
      }
    } else if (result.queued) {
      showToast('info', 'Note queued — will publish when connection improves', 5000);
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* as above */
        }
      }
    } else {
      showToast('error', result.error || 'Failed to publish');
    }
  } catch (err) {
    console.error('[MinedPost] publish failed:', err);
    showToast('error', err instanceof Error ? err.message : 'Failed to publish');
  } finally {
    removePendingOp(opId);
  }
}
