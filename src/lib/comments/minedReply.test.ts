import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

vi.mock('$lib/comments/postComment', () => ({ postComment: vi.fn() }));
vi.mock('$lib/replyDraftStore', () => ({
  saveReplyDraft: vi.fn(),
  deleteReplyDraft: vi.fn(),
  replyDraftRevision: vi.fn()
}));
// Only the worker-backed pieces are stubbed; isPowCanceled stays real so the
// stopped-mine path is exercised against the miner's own error shape.
vi.mock('$lib/powMiner', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  minePowIntoEvent: vi.fn(),
  powCancel: vi.fn()
}));

import { postComment, type PostCommentOptions } from '$lib/comments/postComment';
import { minePowIntoEvent } from '$lib/powMiner';
import { saveReplyDraft, deleteReplyDraft, replyDraftRevision } from '$lib/replyDraftStore';
import { miningOp, startMiningOp, endMiningOp } from '$lib/stores/miningOp';
import { pendingOps } from '$lib/stores/pendingOps';
import { toasts } from '$lib/toast';
import { startMinedReply, type ReplyDraft } from './minedReply';

const mockedPostComment = vi.mocked(postComment);
const mockedMine = vi.mocked(minePowIntoEvent);
const mockedSave = vi.mocked(saveReplyDraft);
const mockedDelete = vi.mocked(deleteReplyDraft);
const mockedRevision = vi.mocked(replyDraftRevision);

const REPLY_ID = 'a'.repeat(64);
const parentEvent = { id: 'b'.repeat(64), pubkey: 'c'.repeat(64) } as unknown as NDKEvent;
const replyTo = { id: 'd'.repeat(64), pubkey: 'c'.repeat(64) } as unknown as NDKEvent;
const draft: ReplyDraft = { text: 'hello', media: [], poll: null };

function options(overrides?: {
  replyTo?: NDKEvent;
  onPosted?: (e: NDKEvent) => void;
  restoreInPlace?: (d: ReplyDraft) => boolean;
}) {
  return {
    ndk: {} as never,
    parentEvent,
    // `in` so an explicit `replyTo: undefined` means top-level rather than
    // falling back to the default nested target.
    replyTo: overrides && 'replyTo' in overrides ? overrides.replyTo : replyTo,
    content: 'hello',
    extraTags: [],
    bits: 20,
    draft,
    pubkey: 'me',
    onPosted: overrides?.onPosted,
    restoreInPlace: overrides?.restoreInPlace
  };
}

/**
 * Stand-in for postComment's mine-then-publish order: runs the caller's mine
 * hook against a bare event, then settles the way the relay round-trip would.
 */
function postCommentThat(publish: () => Promise<void>) {
  mockedPostComment.mockImplementation(async (_ndk: NDK, opts: PostCommentOptions) => {
    const event = { id: REPLY_ID } as NDKEvent;
    await opts.mine?.(event);
    await publish();
    return { event, publishedRelays: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  toasts.set([]);
  endMiningOp();
  // No draft on disk at hand-off unless a test says otherwise.
  mockedRevision.mockReturnValue(null);
});

describe('startMinedReply', () => {
  it('mines under the indicator, publishes under the pending pill, then reports success', async () => {
    const order: string[] = [];
    let bitsWhileMining: number | undefined;
    let indicatorWhilePublishing: unknown = 'unset';
    let pillWhilePublishing: string[] = [];

    mockedMine.mockImplementation(async () => {
      order.push('mine');
      bitsWhileMining = get(miningOp)?.bits;
    });
    postCommentThat(async () => {
      order.push('publish');
      indicatorWhilePublishing = get(miningOp);
      pillWhilePublishing = get(pendingOps).map((op) => op.label);
    });
    const onPosted = vi.fn();

    await startMinedReply(options({ onPosted }));

    expect(order).toEqual(['mine', 'publish']);
    expect(bitsWhileMining).toBe(20);
    // The indicator ends with the nonce; signing and the relays ride the pill.
    expect(indicatorWhilePublishing).toBeNull();
    expect(pillWhilePublishing).toEqual(['Posting reply...']);

    expect(onPosted).toHaveBeenCalledTimes(1);
    expect(onPosted.mock.calls[0][0]).toMatchObject({ id: REPLY_ID });
    expect(get(pendingOps)).toEqual([]);
    expect(get(miningOp)).toBeNull();
    expect(get(toasts)[0]).toMatchObject({ variant: 'success', message: 'Reply published' });
    expect(get(toasts)[0].link?.href).toMatch(/^\/note1/);
    // The draft the composer handed over is spent.
    expect(mockedDelete).toHaveBeenCalledWith(replyTo.id);
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('keys the draft on what is being answered — the parent when there is no replyTo', async () => {
    mockedMine.mockResolvedValue(undefined);
    postCommentThat(async () => {});

    await startMinedReply(options({ replyTo: undefined }));

    expect(mockedDelete).toHaveBeenCalledWith(parentEvent.id);
  });

  it('a stopped mine writes the draft back with an info toast, not an error', async () => {
    mockedMine.mockRejectedValue(new Error('pow-canceled'));
    postCommentThat(async () => {
      throw new Error('publish must not run after a stopped mine');
    });

    await startMinedReply(options());

    expect(mockedSave).toHaveBeenCalledWith(replyTo.id, 'me', draft);
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(get(toasts)[0]).toMatchObject({ variant: 'info' });
    expect(get(toasts)[0].message).toMatch(/draft is saved/);
    expect(get(miningOp)).toBeNull();
    expect(get(pendingOps)).toEqual([]);
  });

  it('a failed publish writes the draft back and clears the pending pill', async () => {
    mockedMine.mockResolvedValue(undefined);
    postCommentThat(async () => {
      throw new Error('relay said no');
    });
    const onPosted = vi.fn();

    await startMinedReply(options({ onPosted }));

    expect(mockedSave).toHaveBeenCalledWith(replyTo.id, 'me', draft);
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(onPosted).not.toHaveBeenCalled();
    expect(get(toasts)[0]).toMatchObject({ variant: 'error' });
    expect(get(toasts)[0].message).toMatch(/draft is saved/);
    expect(get(pendingOps)).toEqual([]);
    expect(get(miningOp)).toBeNull();
  });

  it('a throwing onPosted does not turn a published reply into a failure', async () => {
    mockedMine.mockResolvedValue(undefined);
    postCommentThat(async () => {});
    const onPosted = vi.fn(() => {
      throw new Error('host blew up');
    });

    await startMinedReply(options({ onPosted }));

    expect(get(toasts)[0]).toMatchObject({ variant: 'success' });
    expect(mockedDelete).toHaveBeenCalledWith(replyTo.id);
    expect(mockedSave).not.toHaveBeenCalled();
  });

  describe('a newer draft saved while the reply signs and publishes', () => {
    // The indicator ends with the nonce, and the reader can reopen the box
    // and save a newer reply to the same note before the relays answer.
    function newerDraftDuringPublish(publish: () => Promise<void> = async () => {}) {
      mockedRevision.mockReturnValue(100);
      mockedMine.mockResolvedValue(undefined);
      postCommentThat(async () => {
        mockedRevision.mockReturnValue(200);
        await publish();
      });
    }

    it('success leaves the newer draft alone', async () => {
      newerDraftDuringPublish();

      await startMinedReply(options());

      expect(get(toasts)[0]).toMatchObject({ variant: 'success' });
      expect(mockedDelete).not.toHaveBeenCalled();
    });

    it('failure keeps the newer draft rather than overwriting it with the older words', async () => {
      newerDraftDuringPublish(async () => {
        throw new Error('relay said no');
      });

      await startMinedReply(options());

      expect(mockedSave).not.toHaveBeenCalled();
      expect(mockedDelete).not.toHaveBeenCalled();
      expect(get(toasts)[0]).toMatchObject({ variant: 'error' });
      expect(get(toasts)[0].message).toMatch(/newer draft/);
    });

    it('the record from hand-off is still ours to delete', async () => {
      mockedRevision.mockReturnValue(100);
      mockedMine.mockResolvedValue(undefined);
      postCommentThat(async () => {});

      await startMinedReply(options());

      expect(mockedDelete).toHaveBeenCalledWith(replyTo.id);
    });
  });

  describe('the indicator after the mine hook has ended it', () => {
    it("a failed publish does not clear the next mine's indicator", async () => {
      const nextStop = vi.fn();
      mockedMine.mockResolvedValue(undefined);
      postCommentThat(async () => {
        // The miner is free once the nonce lands; another reply starts.
        startMiningOp(24, nextStop);
        throw new Error('relay said no');
      });

      await startMinedReply(options());

      expect(get(miningOp)).toMatchObject({ bits: 24, stop: nextStop });
      expect(get(pendingOps)).toEqual([]);
    });

    it('a failure before the mine hook runs still clears its own indicator', async () => {
      mockedPostComment.mockRejectedValue(new Error('no parent'));

      await startMinedReply(options());

      expect(mockedMine).not.toHaveBeenCalled();
      expect(get(miningOp)).toBeNull();
      expect(mockedSave).toHaveBeenCalledWith(replyTo.id, 'me', draft);
    });
  });

  it('a composer still mounted can take a stopped mine back in place — then nothing is written', async () => {
    mockedMine.mockRejectedValue(new Error('pow-canceled'));
    postCommentThat(async () => {});
    const restoreInPlace = vi.fn(() => true);

    await startMinedReply(options({ restoreInPlace }));

    expect(restoreInPlace).toHaveBeenCalledWith(draft);
    expect(mockedSave).not.toHaveBeenCalled();
    expect(get(toasts)[0]).toMatchObject({ variant: 'info' });
    expect(get(toasts)[0].message).toMatch(/back in the box/);
  });

  it('a composer that declines the in-place restore gets the store write', async () => {
    mockedMine.mockResolvedValue(undefined);
    postCommentThat(async () => {
      throw new Error('relay said no');
    });
    const restoreInPlace = vi.fn(() => false);

    await startMinedReply(options({ restoreInPlace }));

    expect(restoreInPlace).toHaveBeenCalledWith(draft);
    expect(mockedSave).toHaveBeenCalledWith(replyTo.id, 'me', draft);
  });
});
