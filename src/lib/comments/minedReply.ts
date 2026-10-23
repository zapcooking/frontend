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
 * words are there when the reply box reopens.
 */
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { postComment } from '$lib/comments/postComment';
import { minePowIntoEvent, powCancel, isPowCanceled } from '$lib/powMiner';
import { saveReplyDraft, deleteReplyDraft } from '$lib/replyDraftStore';
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
  onPosted
}: MinedReplyOptions): Promise<void> {
  // The draft's key is the note being answered — the same `draftKey` the
  // reply modal hands its composer, so what this writes back is what that
  // composer restores.
  const targetId = (replyTo ?? parentEvent).id;
  // Assigned from inside the mine hook, which TypeScript's flow analysis
  // cannot see — without the cast it would type the finally-block read as
  // the literal `null`.
  let opId = null as string | null;

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
        }
        opId = addPendingOp('Posting reply...');
      }
    });

    deleteReplyDraft(targetId);
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
    endMiningOp();
    saveReplyDraft(targetId, pubkey, draft);
    if (isPowCanceled(err)) {
      // The reader pressed Stop. That is an answer, not a failure — say
      // where the reply went rather than reporting an error for something
      // they chose.
      showToast('info', 'Mining stopped — your reply draft is saved', 5000);
      return;
    }
    console.error('[MinedReply] post failed:', err);
    showToast('error', "Couldn't post reply — your draft is saved");
  } finally {
    if (opId) removePendingOp(opId);
  }
}
