import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

vi.mock('$lib/comments/postComment', () => ({ postComment: vi.fn() }));
vi.mock('$lib/replyDraftStore', () => ({
  saveReplyDraft: vi.fn(),
  deleteReplyDraft: vi.fn()
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
import { saveReplyDraft, deleteReplyDraft } from '$lib/replyDraftStore';
import { miningOp } from '$lib/stores/miningOp';
import { pendingOps } from '$lib/stores/pendingOps';
import { toasts } from '$lib/toast';
import { startMinedReply, type ReplyDraft } from './minedReply';

const mockedPostComment = vi.mocked(postComment);
const mockedMine = vi.mocked(minePowIntoEvent);
const mockedSave = vi.mocked(saveReplyDraft);
const mockedDelete = vi.mocked(deleteReplyDraft);

const REPLY_ID = 'a'.repeat(64);
const parentEvent = { id: 'b'.repeat(64), pubkey: 'c'.repeat(64) } as unknown as NDKEvent;
const replyTo = { id: 'd'.repeat(64), pubkey: 'c'.repeat(64) } as unknown as NDKEvent;
const draft: ReplyDraft = { text: 'hello', media: [], poll: null };

function options(overrides?: { replyTo?: NDKEvent; onPosted?: (e: NDKEvent) => void }) {
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
    onPosted: overrides?.onPosted
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
});
