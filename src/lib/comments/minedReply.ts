/**
 * Mine, sign and publish a reply without the composer having to stay open.
 *
 * The reply-side counterpart of $lib/minedPost. Mining can take the better
 * part of a minute, and awaiting it inside the composer kept the editor on
 * screen for the whole wait — for the reply modal, with the rest of the app
 * blurred out behind it. So the composer hands the finished draft over here
 * and closes; this runs at module scope, reports into the mining store that
 * draws the floating indicator, and finishes the post on its own through
 * `postComment`, which still owns the NIP-22/NIP-10 tagging and the inbox
 * routing.
 *
 * The draft travels with the job. It lives in $lib/replyDraftStore — the
 * same store the composer restores from on mount and the draft dock lists —
 * under the id of the note being answered: deleted once the relays have the
 * reply, written back if the mine is stopped or the publish fails, so the
 * words are there when the reply box reopens. Only while the record is still
 * the one that was on disk at hand-off, though: signing and the relays run
 * after the indicator ends, and a reader who reopened the box and started a
 * newer reply to the same note in that window keeps it.
 */
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { postComment } from '$lib/comments/postComment';
import { minePowIntoEvent, powCancel, isPowCanceled } from '$lib/powMiner';
import { saveReplyDraft, deleteReplyDraft, replyDraftRevision } from '$lib/replyDraftStore';
import { startMiningOp, reportMiningBest, endMiningOp } from '$lib/stores/miningOp';
import { addPendingOp, removePendingOp } from '$lib/stores/pendingOps';
import { showToast } from '$lib/toast';
import type { MediaAttachment } from '$lib/composerMedia';
import type { PollConfig } from '$lib/polls';

/**
 * What the member typed, in the composer's own pre-processing shape — raw
 * text, ordered attachment slots, poll config — so a restore gives back
 * exactly what was typed rather than the mention-substituted wire form.
 */
export interface ReplyDraft {
  text: string;
  media: MediaAttachment[];
  poll: PollConfig | null;
}

export interface MinedReplyOptions {
  ndk: NDK;
  parentEvent: NDKEvent;
  replyTo?: NDKEvent;
  /** Final wire content — mentions substituted, media URLs appended. */
  content: string;
  extraTags: string[][];
  contentKind?: number;
  bits: number;
  /** Held so a stopped mine or a failed publish can write it back. */
  draft: ReplyDraft;
  /** The member's pubkey; the saved draft is scoped to it (see replyDraftStore). */
  pubkey: string;
  /**
   * Fired with the published event. A notification only — this can land a
   * minute after the composer that started it closed, while the member is
   * typing something else — so it must never dismiss UI.
   */
  onPosted?: ((event: NDKEvent) => void) | null;
  /**
   * Offered the draft on a stop or a failure before it is written back, for
   * a composer that hands off without closing (a thread's permanent reply
   * box) and so never remounts to read the store. Returns true when it took
   * the words back in place — then nothing is written. The composer decides
   * ownership: still mounted, and still empty.
   */
  restoreInPlace?: ((draft: ReplyDraft) => boolean) | null;
}

export async function startMinedReply({
  ndk,
  parentEvent,
  replyTo,
  content,
  extraTags,
  contentKind,
  bits,
  draft,
  pubkey,
  onPosted,
  restoreInPlace
}: MinedReplyOptions): Promise<void> {
  // The draft's key is the note being answered — the same `draftKey` the
  // reply modal hands its composer, so what this writes back is what that
  // composer restores.
  const targetId = (replyTo ?? parentEvent).id;
  // The record on disk at hand-off — a blur snapshot of these same words, or
  // nothing. Any other revision at the end is a newer draft, not ours.
  const revision = replyDraftRevision(targetId);
  const draftIsOurs = () => replyDraftRevision(targetId) === revision;
  // Assigned from inside the mine hook, which TypeScript's flow analysis
  // cannot see — without the cast it would type the finally-block read as
  // the literal `null`.
  let opId = null as string | null;
  // Set once the mine hook has ended the indicator. From then on the
  // indicator may belong to the NEXT mine, which this job must not clear.
  let mineEnded = false as boolean;

  startMiningOp(bits, powCancel);
  try {
    const { event } = await postComment(ndk, {
      parentEvent,
      replyTo,
      content,
      extraTags,
      contentKind,
      signingStrategy: 'explicit-with-timeout',
      // Mining happens inside postComment, immediately before signing: the
      // id the signature covers is the one the nonce was mined for. The
      // indicator ends when the nonce lands — the miner is free for the
      // next reply — and the pending pill carries signing and the relay
      // round-trip.
      mine: async (ev) => {
        try {
          await minePowIntoEvent(ev, bits, (p) => reportMiningBest(p.best));
        } finally {
          endMiningOp();
          mineEnded = true;
        }
        opId = addPendingOp('Posting reply...');
      }
    });

    if (draftIsOurs()) deleteReplyDraft(targetId);
    showToast(
      'success',
      'Reply published',
      12000,
      event.id ? { label: 'View', href: `/${nip19.noteEncode(event.id)}` } : undefined
    );
    try {
      onPosted?.(event);
    } catch (err) {
      console.error('[MinedReply] onPosted failed:', err);
    }
  } catch (err) {
    // The mine hook ends the op on its own way out, but a failure before it
    // runs (postComment's parent validation) must not leave the indicator
    // pulsing forever.
    if (!mineEnded) endMiningOp();
    let restored = false;
    try {
      restored = restoreInPlace?.(draft) ?? false;
    } catch (restoreErr) {
      console.error('[MinedReply] restoreInPlace failed:', restoreErr);
    }
    // A newer draft for this note wins; overwriting it with the older words
    // would lose what the reader is typing now to recover what they sent.
    const keptNewer = !restored && !draftIsOurs();
    if (!restored && !keptNewer) saveReplyDraft(targetId, pubkey, draft);
    if (isPowCanceled(err)) {
      // The reader pressed Stop. That is an answer, not a failure — say
      // where the reply went rather than reporting an error for something
      // they chose.
      showToast(
        'info',
        keptNewer
          ? 'Mining stopped — kept the newer draft you started'
          : restored
            ? 'Mining stopped — your reply is back in the box'
            : 'Mining stopped — your reply draft is saved',
        5000
      );
      return;
    }
    console.error('[MinedReply] post failed:', err);
    showToast(
      'error',
      keptNewer
        ? "Couldn't post reply — kept the newer draft you started"
        : restored
          ? "Couldn't post reply — it's back in the box"
          : "Couldn't post reply — your draft is saved"
    );
  } finally {
    if (opId) removePendingOp(opId);
  }
}
