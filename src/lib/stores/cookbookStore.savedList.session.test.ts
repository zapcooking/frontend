import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

/**
 * Session rules for Saved-list edits:
 * - a key generated in this browser (signup) has no list anywhere, so its
 *   first save skips the network read — signup → save stays fast;
 * - the app-wide store never builds an edit on another account's lists
 *   (an in-place sign-in can switch accounts under it).
 */

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const NOS = 'wss://nos.lol';
const PRIMAL = 'wss://relay.primal.net';

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable<unknown>(null),
    userPublickey: writable(''),
    ensureNdkConnected: vi.fn(async () => {})
  };
});
vi.mock('$lib/nip65Routing', () => ({
  listRelayUrls: vi.fn(async () => [NOS, PRIMAL]),
  getOwnWriteRelays: vi.fn(async () => []),
  listRelaySet: vi.fn(async () => undefined),
  outboxRelaySet: vi.fn(async () => undefined)
}));
vi.mock('$lib/connectionMonitor', () => ({
  isCurrentlyOnline: vi.fn(() => true),
  onConnect: vi.fn(() => () => {})
}));
vi.mock('$lib/offlineStorage', () => ({
  offlineStorage: {
    getAllCookbooks: vi.fn(async () => []),
    saveCookbook: vi.fn(async () => {}),
    getPendingOperations: vi.fn(async () => []),
    markCookbookSynced: vi.fn(async () => {}),
    queueOperation: vi.fn(async () => {}),
    getQueueStatus: vi.fn(async () => ({ pending: 0, failed: 0 }))
  }
}));

import { ndk, userPublickey } from '$lib/nostr';
import { cookbookStore, DEFAULT_LIST_ID, SAVED_LIST_UNCONFIRMED_MESSAGE } from './cookbookStore';
import { markFreshAccount, __resetSavedListSessionForTests } from '$lib/savedList';

const recipe = (d: string) =>
  ({ kind: 30023, pubkey: 'c'.repeat(64), replaceableDTag: () => d }) as unknown as NDKEvent;
const aTag = (d: string) => `30023:${'c'.repeat(64)}:${d}`;

let query: ReturnType<typeof vi.fn>;
let published: { tags: string[][] }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  __resetSavedListSessionForTests();
  cookbookStore.reset();
  ndk.set({ subscribe: vi.fn() } as unknown as NDK);
  published = [];
  vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
    published.push({ tags: this.tags.map((t) => [...t]) });
    return new Set() as never;
  });
  query = vi.fn(async (url: string) => ({ url, ok: true, list: null }));
  cookbookStore.__setSavedListQueryForTests(query);
});

afterEach(() => {
  vi.restoreAllMocks();
  cookbookStore.__setSavedListQueryForTests(undefined);
});

describe('fresh account (key generated this session)', () => {
  it('first save skips the network read and publishes one event with the recipe', async () => {
    userPublickey.set(A);
    markFreshAccount(A);

    const result = await cookbookStore.saveToDefaultList(recipe('r1'));

    expect(result).toEqual({ ok: true, changed: true });
    expect(query).not.toHaveBeenCalled();
    expect(published).toHaveLength(1);
    expect(published[0].tags).toContainEqual(['a', aTag('r1')]);
  });

  it('later saves build on what this session published', async () => {
    userPublickey.set(A);
    markFreshAccount(A);

    await cookbookStore.saveToDefaultList(recipe('r1'));
    await cookbookStore.saveToDefaultList(recipe('r2'));

    expect(query).not.toHaveBeenCalled();
    const last = published[published.length - 1].tags.filter((t) => t[0] === 'a').map((t) => t[1]);
    expect(last).toEqual([aTag('r1'), aTag('r2')]);
  });

  it('an account signed in with an existing key is not fresh: the read runs', async () => {
    userPublickey.set(B);
    await cookbookStore.saveToDefaultList(recipe('r1'));
    expect(query).toHaveBeenCalled();
  });
});

describe('account switch under the app-wide store', () => {
  it("never builds B's list on A's", async () => {
    userPublickey.set(A);
    markFreshAccount(A);
    await cookbookStore.saveToDefaultList(recipe('a-only'));
    expect(get(cookbookStore).lists.find((l) => l.id === DEFAULT_LIST_ID)?.recipes).toEqual([
      aTag('a-only')
    ]);

    userPublickey.set(B);
    await cookbookStore.saveToDefaultList(recipe('b1'));

    const bList = published[published.length - 1].tags.filter((t) => t[0] === 'a').map((t) => t[1]);
    expect(bList).toEqual([aTag('b1')]);
    expect(get(cookbookStore).lists.find((l) => l.id === DEFAULT_LIST_ID)?.recipes).toEqual([
      aTag('b1')
    ]);
  });
});

describe('visible failure', () => {
  it('an incomplete read returns the "nothing was changed" message', async () => {
    userPublickey.set(B);
    query.mockImplementation(async (url: string) => ({ url, ok: false, list: null }));

    const result = await cookbookStore.saveToDefaultList(recipe('r1'));

    expect(result).toEqual({ ok: false, message: SAVED_LIST_UNCONFIRMED_MESSAGE });
    expect(published).toHaveLength(0);
  });

  it('a relay refusing the publish is a failure, not a silent "saved"', async () => {
    userPublickey.set(B);
    vi.mocked(NDKEvent.prototype.publish).mockRejectedValueOnce(
      new Error('Not enough relays received the event')
    );

    const result = await cookbookStore.saveToDefaultList(recipe('r1'));

    expect(result.ok).toBe(false);
    expect(get(cookbookStore).lists.find((l) => l.id === DEFAULT_LIST_ID)).toBeUndefined();
  });
});
