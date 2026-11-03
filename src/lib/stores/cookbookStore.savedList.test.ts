import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

/**
 * Saving to the "Saved" list (the one-tap bookmark, signed in or resumed
 * after sign-in) — the 2026-10-23 incident (RESUME_SAVE_INCIDENT.md):
 *
 * - a first save published an EMPTY list and then the list with the recipe
 *   in the same second; relays keep the lower id on a created_at tie, so the
 *   empty one often won and the save silently failed;
 * - "no list arrived before EOSE" was taken as "no list exists", so a slow
 *   or silent relay could get the member's real list overwritten.
 *
 * Relays are faked per URL (answer empty / stay silent / hold a list) for
 * both read paths: the per-relay safety read and the NDK subscription.
 */

// A new account per test: the session's "seen" memory and the store's
// last-published stamps are per account, and must not carry between tests.
let PUBKEY = '';
let accountCounter = 0;
const NOS = 'wss://nos.lol';
const PRIMAL = 'wss://relay.primal.net';
const PYRAMID = 'wss://pyramid.fiatjaf.com';
const DTAG = 'nostrcooking-bookmarks';

type RelayState = 'empty' | 'silent' | { created_at: number; tags: string[][]; content?: string };
const net = vi.hoisted(() => ({
  relays: {} as Record<string, unknown>,
  ownWrite: [] as string[],
  /** The relay-list cache knows the member's kind 10002 (else: ask relays). */
  ownWriteCached: true,
  /** How relays answer a kind-10002 lookup when the cache doesn't know. */
  relayListAnswers: 'empty' as 'empty' | 'silent',
  publishedTo: [] as string[][]
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable<unknown>(null),
    userPublickey: writable(''),
    ensureNdkConnected: vi.fn(async () => {}),
    getCurrentRelays: () => ['wss://nos.lol', 'wss://relay.primal.net']
  };
});
const nudge = vi.hoisted(() => ({ recordNudgeMoment: vi.fn() }));
vi.mock('$lib/accountNudge', () => nudge);
vi.mock('$lib/nip65Routing', () => ({
  listRelayUrls: vi.fn(async () => Object.keys(net.relays)),
  listRelayUrlsFrom: vi.fn(async () => Object.keys(net.relays)),
  getOwnWriteRelays: vi.fn(async () => net.ownWrite),
  listRelaySet: vi.fn(async () => undefined),
  relaySetForUrls: vi.fn(async (_ndk: unknown, urls: string[]) => {
    net.publishedTo.push([...urls]);
    return undefined;
  }),
  outboxRelaySet: vi.fn(async () => undefined)
}));
vi.mock('$lib/relayListCache', () => ({
  relayListCache: {
    get: vi.fn(async () => (net.ownWriteCached ? { read: [], write: net.ownWrite } : null))
  }
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
    removeOperation: vi.fn(async () => {}),
    updateOperationRetry: vi.fn(async () => {}),
    clearFailedOperations: vi.fn(async () => {}),
    getQueueStatus: vi.fn(async () => ({ pending: 0, failed: 0 }))
  }
}));

import { ndk, userPublickey } from '$lib/nostr';
import { offlineStorage } from '$lib/offlineStorage';
import { get } from 'svelte/store';
import { cookbookStore } from './cookbookStore';

const listOn = (created_at: number, recipes: string[], extra: string[][] = []) => ({
  id: `relay-${created_at}`,
  pubkey: PUBKEY,
  kind: 30001,
  created_at,
  tags: [['d', DTAG], ['title', 'Saved'], ...extra, ...recipes.map((a) => ['a', a])],
  content: ''
});

function relayLists() {
  return Object.values(net.relays).filter((r) => typeof r === 'object') as ReturnType<
    typeof listOn
  >[];
}

/** The per-relay safety read (new code path). */
const fakeQuery = async (url: string, filter?: { kinds?: number[] }) => {
  if (filter?.kinds?.[0] === 10002) {
    return { url, ok: net.relayListAnswers === 'empty', list: null };
  }
  const r = net.relays[url] as RelayState;
  if (r === 'silent') return { url, ok: false, list: null };
  if (r === 'empty') return { url, ok: true, list: null };
  return { url, ok: true, list: { ...(r as object), pubkey: PUBKEY } as never };
};

/** NDK subscription (My Kitchen refresh): every answering relay's list, then EOSE unless all are silent. */
function fakeNdk() {
  return {
    subscribe: vi.fn(() => {
      const handlers: Record<string, ((...a: unknown[]) => unknown)[]> = {};
      const sub = {
        on: (e: string, cb: (...a: unknown[]) => unknown) => (handlers[e] ??= []).push(cb),
        stop: () => {}
      };
      queueMicrotask(async () => {
        for (const l of relayLists()) {
          for (const cb of handlers.event ?? []) await cb(new NDKEvent(undefined, l as never));
        }
        const anyAnswer = Object.values(net.relays).some((r) => r !== 'silent');
        if (anyAnswer) for (const cb of handlers.eose ?? []) await cb();
      });
      return sub;
    })
  };
}

const recipe = (d: string) =>
  ({ kind: 30023, pubkey: 'c'.repeat(64), replaceableDTag: () => d }) as unknown as NDKEvent;
const aTag = (d: string) => `30023:${'c'.repeat(64)}:${d}`;

let published: { tags: string[][]; created_at?: number; content: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  vi.clearAllMocks();
  cookbookStore.reset();
  net.relays = {};
  net.ownWrite = [];
  net.ownWriteCached = true;
  net.relayListAnswers = 'empty';
  net.publishedTo = [];
  PUBKEY = (++accountCounter).toString(16).padStart(64, 'a');
  ndk.set(fakeNdk() as unknown as NDK);
  userPublickey.set(PUBKEY);
  published = [];
  // List edits sign before publishing (signWithin): sign as the signed-in member.
  vi.spyOn(NDKEvent.prototype, 'sign').mockImplementation(async function (this: NDKEvent) {
    this.pubkey = get(userPublickey);
    this.sig = 'sig';
    return 'sig';
  });
  vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
    published.push({
      tags: this.tags.map((t) => [...t]),
      created_at: this.created_at,
      content: this.content
    });
    return new Set() as never;
  });
  (
    cookbookStore as { __setSavedListQueryForTests?: (q: unknown) => void }
  ).__setSavedListQueryForTests?.(fakeQuery);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Run a store call that may wait on timers (relay timeouts) to completion. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const out = p.finally(() => (done = true));
  for (let i = 0; i < 40 && !done; i++) await vi.advanceTimersByTimeAsync(500);
  return out;
}

const recipesIn = (e: { tags: string[][] }) => e.tags.filter((t) => t[0] === 'a').map((t) => t[1]);

describe('first save on an account with no Saved list', () => {
  it('publishes exactly ONE event, and it already holds the recipe', async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty' };

    expect(await settle(cookbookStore.quickSave(recipe('r1')))).toBe(true);

    expect(published).toHaveLength(1);
    expect(recipesIn(published[0])).toEqual([aTag('r1')]);
    expect(published[0].tags).toContainEqual(['d', DTAG]);
    expect(published[0].tags).toContainEqual(['title', 'Saved']);
  });
});

describe('every republish is strictly newer', () => {
  it('back-to-back saves in the same second get increasing created_at', async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty' };

    await settle(cookbookStore.quickSave(recipe('r1')));
    await settle(cookbookStore.quickSave(recipe('r2')));

    expect(published.length).toBeGreaterThanOrEqual(2);
    const times = published.map((p) => p.created_at);
    expect(times.every((t) => typeof t === 'number')).toBe(true);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    // …and the second builds on the first: nothing dropped.
    expect(recipesIn(published[published.length - 1])).toEqual([aTag('r1'), aTag('r2')]);
  });

  it('is newer than the list already on the relays, even one stamped in the future', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    net.relays = { [NOS]: listOn(future, [aTag('old')]), [PRIMAL]: 'empty' };

    await settle(cookbookStore.quickSave(recipe('r1')));

    expect(published).toHaveLength(1);
    expect(published[0].created_at).toBeGreaterThan(future);
  });
});

describe('never a blind write', () => {
  it('a list that exists on the relays is extended, not replaced', async () => {
    net.relays = { [NOS]: listOn(1700000000, [aTag('old1'), aTag('old2')]), [PRIMAL]: 'empty' };

    await settle(cookbookStore.quickSave(recipe('new')));

    expect(published).toHaveLength(1);
    expect(recipesIn(published[0])).toEqual([aTag('old1'), aTag('old2'), aTag('new')]);
  });

  it('every relay silent: publishes nothing and reports the failure', async () => {
    net.relays = { [NOS]: 'silent', [PRIMAL]: 'silent' };

    const ok = await settle(cookbookStore.quickSave(recipe('r1')));

    expect(ok).toBe(false);
    expect(published).toHaveLength(0);
    expect(vi.mocked(offlineStorage.queueOperation)).not.toHaveBeenCalled();
  });

  it('one relay answered empty, the other silent: not enough to call it absent', async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'silent' };

    const ok = await settle(cookbookStore.quickSave(recipe('r1')));

    expect(ok).toBe(false);
    expect(published).toHaveLength(0);
  });

  it("the member's own write relay is silent: refuse, even with the app relays empty", async () => {
    // The real list may live only on pyramid.
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty', [PYRAMID]: 'silent' };
    net.ownWrite = [PYRAMID];

    const ok = await settle(cookbookStore.quickSave(recipe('r1')));

    expect(ok).toBe(false);
    expect(published).toHaveLength(0);
  });
});

describe('quorum, not unanimity', () => {
  it('one dead relay in the member’s write list still saves on the first call', async () => {
    const DEAD = 'wss://dead.example';
    const OTHER = 'wss://relay.other.example';
    net.relays = {
      [PYRAMID]: 'empty',
      [OTHER]: 'empty',
      [DEAD]: 'silent',
      [NOS]: 'empty',
      [PRIMAL]: 'empty'
    };
    net.ownWrite = [PYRAMID, OTHER, DEAD];

    expect(await settle(cookbookStore.quickSave(recipe('r1')))).toBe(true);
    expect(published).toHaveLength(1);
  });
});

describe('My Kitchen cover survives a save', () => {
  it('keeps the cover (and the list’s other tags) when a recipe is saved', async () => {
    net.relays = {
      [NOS]: listOn(
        1700000000,
        [aTag('r1'), aTag('r2')],
        [
          ['cover', aTag('r2')],
          ['summary', 'weeknight wins']
        ]
      ),
      [PRIMAL]: 'empty'
    };

    await settle(cookbookStore.quickSave(recipe('r3')));

    expect(published).toHaveLength(1);
    expect(published[0].tags).toContainEqual(['cover', aTag('r2')]);
    expect(published[0].tags).toContainEqual(['summary', 'weeknight wins']);
  });
});

describe('unsave', () => {
  it('removes exactly the recipe, from the freshly read list', async () => {
    net.relays = {
      [NOS]: listOn(1700000000, [aTag('r1'), aTag('r2'), aTag('r3')]),
      [PRIMAL]: 'empty'
    };
    await settle(cookbookStore.load());

    expect(await settle(cookbookStore.removeRecipeFromList(DTAG, aTag('r2')))).toBe(true);

    const last = published[published.length - 1];
    expect(recipesIn(last)).toEqual([aTag('r1'), aTag('r3')]);
  });
});

// ── #869 review: remaining ways to overwrite or misreport ──────────────

describe('own write relays must be known, and the publish goes where the read went', () => {
  it("refuses when the member's write relays can't be established (cache miss + relays silent)", async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty' };
    net.ownWriteCached = false;
    net.relayListAnswers = 'silent';

    expect(await settle(cookbookStore.quickSave(recipe('r1')))).toBe(false);
    expect(published).toHaveLength(0);
  });

  it('a confirmed "no relay list" (relays answered empty) is fine', async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty' };
    net.ownWriteCached = false;
    net.relayListAnswers = 'empty';

    expect(await settle(cookbookStore.quickSave(recipe('r1')))).toBe(true);
    expect(published).toHaveLength(1);
  });

  it('publishes to exactly the relay set it read', async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty', [PYRAMID]: 'empty' };
    net.ownWrite = [PYRAMID];

    await settle(cookbookStore.quickSave(recipe('r1')));

    expect(net.publishedTo).toEqual([[NOS, PRIMAL, PYRAMID]]);
  });
});

describe('a refresh that lands after a save does not undo it', () => {
  it('keeps the newer published Saved list over an older relay copy', async () => {
    net.relays = { [NOS]: listOn(1700000000, [aTag('old')]), [PRIMAL]: 'empty' };
    await settle(cookbookStore.saveToDefaultList(recipe('new')));
    const saved = () => get(cookbookStore).lists.find((l) => l.id === DTAG)?.recipes;
    expect(saved()).toEqual([aTag('old'), aTag('new')]);

    // A refresh still serving the old copy finishes now.
    await settle(cookbookStore.refreshFromNostr());

    expect(saved()).toEqual([aTag('old'), aTag('new')]);
  });
});

describe('bulk add to Saved counts against the freshly read list', () => {
  it('re-adds a recipe the cache thinks is saved but the relays no longer have', async () => {
    // Cache: r1 saved. Relays (newer): r1 was removed elsewhere.
    net.relays = { [NOS]: listOn(1700000000, [aTag('r1')]), [PRIMAL]: 'empty' };
    await settle(cookbookStore.load());
    net.relays = { [NOS]: listOn(1700000500, []), [PRIMAL]: 'empty' };

    const result = await settle(
      cookbookStore.bulkAddRecipesToList(DTAG, [recipe('r1'), recipe('r2')])
    );

    expect(result).toEqual({ added: 2, skipped: 0, failed: 0 });
    expect(recipesIn(published[published.length - 1])).toEqual([aTag('r1'), aTag('r2')]);
  });

  it('even an all-cached request goes through the guarded read', async () => {
    net.relays = { [NOS]: listOn(1700000000, [aTag('r1')]), [PRIMAL]: 'empty' };
    await settle(cookbookStore.load());
    net.relays = { [NOS]: listOn(1700000500, []), [PRIMAL]: 'empty' };

    const result = await settle(cookbookStore.bulkAddRecipesToList(DTAG, [recipe('r1')]));

    expect(result).toEqual({ added: 1, skipped: 0, failed: 0 });
  });
});

describe('My Kitchen list page edits to Saved (editSavedList)', () => {
  it('a reorder keeps recipes saved elsewhere since the page loaded', async () => {
    // Page loaded [r1, r2]; meanwhile r3 was saved on another device.
    net.relays = {
      [NOS]: listOn(1700000000, [aTag('r1'), aTag('r2'), aTag('r3')]),
      [PRIMAL]: 'empty'
    };

    await settle(cookbookStore.editSavedList({ order: [aTag('r2'), aTag('r1')] }));

    expect(recipesIn(published[0])).toEqual([aTag('r2'), aTag('r1'), aTag('r3')]);
  });

  it('details edits keep the recipes and cover of the fresh copy', async () => {
    net.relays = {
      [NOS]: listOn(1700000000, [aTag('r1')], [['cover', aTag('r1')]]),
      [PRIMAL]: 'empty'
    };

    await settle(cookbookStore.editSavedList({ meta: { summary: 'weeknights' } }));

    expect(published[0].tags).toContainEqual(['summary', 'weeknights']);
    expect(published[0].tags).toContainEqual(['cover', aTag('r1')]);
    expect(recipesIn(published[0])).toEqual([aTag('r1')]);
  });
});

describe('account nudge: the first saved recipe is a natural moment', () => {
  it('a save that adds a recipe records it', async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty' };
    expect(await settle(cookbookStore.quickSave(recipe('r1')))).toBe(true);
    expect(nudge.recordNudgeMoment).toHaveBeenCalledWith(PUBKEY, 'saved-recipe');
  });

  it('a remove-only edit does not', async () => {
    net.relays = { [NOS]: listOn(1700000000, [aTag('old1')]), [PRIMAL]: 'empty' };
    const result = await settle(cookbookStore.removeFromDefaultList(aTag('old1')));
    expect(result.ok).toBe(true);
    expect(nudge.recordNudgeMoment).not.toHaveBeenCalled();
  });

  it('a save that fails does not', async () => {
    net.relays = { [NOS]: 'silent', [PRIMAL]: 'silent' };
    expect(await settle(cookbookStore.quickSave(recipe('r1')))).toBe(false);
    expect(nudge.recordNudgeMoment).not.toHaveBeenCalled();
  });
});
