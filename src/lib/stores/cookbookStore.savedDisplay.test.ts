import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

/**
 * My Kitchen showing the member's own Saved list — the 2026-10-23
 * regression after #869: the list opened empty although it was on nos.lol
 * and Primal.
 *
 * The refresh subscription goes to nos.lol, purplepag.es, Primal and
 * nostr.wine. purplepag.es and nostr.wine never hold lists and answer at
 * once; NDK then ends the subscription after half the relays answered, so
 * it can finish before nos.lol and Primal deliver. That aggregate EOSE was
 * taken as "the Saved list doesn't exist", and the list page showed the
 * unpublished placeholder as if it were the member's list.
 *
 * Here the subscription always ends early with nothing (that's the NDK
 * behaviour), while the per-relay read gets each relay's own answer.
 */

let PUBKEY = '';
let accountCounter = 0;
const NOS = 'wss://nos.lol';
const PRIMAL = 'wss://relay.primal.net';
const PURPLE = 'wss://purplepag.es';
const WINE = 'wss://nostr.wine';
const DTAG = 'nostrcooking-bookmarks';

type RelayState = 'empty' | 'silent' | { created_at: number; tags: string[][]; content?: string };
const net = vi.hoisted(() => ({ relays: {} as Record<string, unknown> }));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable<unknown>(null),
    userPublickey: writable(''),
    ensureNdkConnected: vi.fn(async () => {}),
    getCurrentRelays: () => Object.keys(net.relays)
  };
});
vi.mock('$lib/nip65Routing', () => ({
  listRelayUrls: vi.fn(async () => Object.keys(net.relays)),
  listRelayUrlsFrom: vi.fn(async () => Object.keys(net.relays)),
  getOwnWriteRelays: vi.fn(async () => []),
  listRelaySet: vi.fn(async () => undefined),
  relaySetForUrls: vi.fn(async () => undefined),
  outboxRelaySet: vi.fn(async () => undefined)
}));
vi.mock('$lib/relayListCache', () => ({
  // No kind 10002 (like the reporting account): lists live on the app relays.
  relayListCache: { get: vi.fn(async () => ({ read: [], write: [] })) }
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
import { cookbookStore, DEFAULT_LIST_ID } from './cookbookStore';

const aTag = (d: string) => `30023:${'c'.repeat(64)}:${d}`;
const listOn = (created_at: number, recipes: string[]) => ({
  id: `relay-${created_at}`,
  pubkey: PUBKEY,
  kind: 30001,
  created_at,
  tags: [['d', DTAG], ['title', 'Saved'], ...recipes.map((a) => ['a', a])],
  content: ''
});
const recipe = (d: string) =>
  ({ kind: 30023, pubkey: 'c'.repeat(64), replaceableDTag: () => d }) as unknown as NDKEvent;
const recipesIn = (e: { tags: string[][] }) => e.tags.filter((t) => t[0] === 'a').map((t) => t[1]);

/** Each relay's own answer to the per-relay read. */
const fakeQuery = async (url: string) => {
  const r = net.relays[url] as RelayState;
  if (r === 'silent') return { url, ok: false, list: null };
  if (r === 'empty') return { url, ok: true, list: null };
  return { url, ok: true, list: { ...(r as object), pubkey: PUBKEY } as never };
};

/** The refresh subscription as NDK ends it early: EOSE before any list arrived. */
function earlyEoseNdk() {
  return {
    subscribe: vi.fn(() => {
      const handlers: Record<string, ((...a: unknown[]) => unknown)[]> = {};
      queueMicrotask(async () => {
        for (const cb of handlers.eose ?? []) await cb();
      });
      return {
        on: (e: string, cb: (...a: unknown[]) => unknown) => (handlers[e] ??= []).push(cb),
        stop: () => {}
      };
    })
  };
}

/** An IndexedDB record of the Saved list (complete, signed). */
function deviceCopy(recipes: string[]) {
  return {
    id: DTAG,
    pubkey: PUBKEY,
    data: {
      id: DTAG,
      naddr: 'naddr1fake',
      title: 'Saved',
      recipeCount: recipes.length,
      recipes,
      createdAt: 1700000000,
      isDefault: true,
      eventTags: [['d', DTAG], ['title', 'Saved'], ...recipes.map((a) => ['a', a])],
      eventPubkey: PUBKEY,
      eventCreatedAt: 1700000000,
      eventId: 'device-copy',
      eventContent: ''
    },
    lastSynced: 1700000000,
    pendingChanges: false,
    localVersion: 1
  };
}

let published: { tags: string[][] }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  vi.clearAllMocks();
  cookbookStore.reset();
  net.relays = {};
  PUBKEY = (++accountCounter).toString(16).padStart(64, 'b');
  ndk.set(earlyEoseNdk() as unknown as NDK);
  userPublickey.set(PUBKEY);
  published = [];
  vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
    published.push({ tags: this.tags.map((t) => [...t]) });
    return new Set() as never;
  });
  cookbookStore.__setSavedListQueryForTests(fakeQuery as never);
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

describe('locked passkey session, refresh, unlock', () => {
  it('shows the Saved list from the relays, not an empty placeholder', async () => {
    net.relays = {
      [NOS]: listOn(1761218623, [aTag('r1'), aTag('r2')]),
      [PURPLE]: 'empty',
      [PRIMAL]: listOn(1761218623, [aTag('r1'), aTag('r2')]),
      [WINE]: 'empty'
    };

    // Locked: the app browses anonymously; the page's load finds no account.
    userPublickey.set('');
    await settle(cookbookStore.load());
    expect(get(cookbookStore).lists).toHaveLength(0);

    // Unlock, then what My Kitchen does for the member's own Saved list.
    userPublickey.set(PUBKEY);
    await settle(cookbookStore.load());
    const saved = await settle(cookbookStore.ensureDefaultList());

    expect(saved).not.toBeNull();
    expect(saved!.localOnly).toBeFalsy();
    expect(saved!.recipes).toEqual([aTag('r1'), aTag('r2')]);

    const view = await settle(cookbookStore.resolveSavedList());
    expect(view.status).toBe('found');
    if (view.status === 'found') {
      expect(view.confirmed).toBe(true);
      expect(view.list.recipes).toEqual([aTag('r1'), aTag('r2')]);
    }
    expect(published).toHaveLength(0);
  });
});

describe('purplepag.es and nostr.wine answer first, the list relays stay silent', () => {
  it('is "couldn\'t load", never an empty list', async () => {
    net.relays = { [NOS]: 'silent', [PURPLE]: 'empty', [PRIMAL]: 'silent', [WINE]: 'empty' };

    await settle(cookbookStore.load());
    expect(await settle(cookbookStore.ensureDefaultList())).toBeNull();
    expect((await settle(cookbookStore.resolveSavedList())).status).toBe('unavailable');
    expect(get(cookbookStore).lists.some((l) => l.localOnly)).toBe(false);
    expect(published).toHaveLength(0);
  });

  it('nos.lol and Primal answering empty do prove absence: the empty placeholder', async () => {
    net.relays = { [NOS]: 'empty', [PURPLE]: 'empty', [PRIMAL]: 'empty', [WINE]: 'empty' };

    const view = await settle(cookbookStore.resolveSavedList());

    expect(view.status).toBe('absent');
    if (view.status === 'absent') expect(view.list.localOnly).toBe(true);
    expect(published).toHaveLength(0);
  });
});

describe("this device's copy is the fallback", () => {
  it('is shown (unconfirmed) when the relays miss, and survives the early-ending refresh', async () => {
    vi.mocked(offlineStorage.getAllCookbooks).mockResolvedValue([
      deviceCopy([aTag('r1'), aTag('r2')])
    ] as never);
    net.relays = { [NOS]: 'silent', [PURPLE]: 'empty', [PRIMAL]: 'silent', [WINE]: 'empty' };

    const view = await settle(cookbookStore.resolveSavedList());
    // Let the background refresh's (empty) EOSE land too.
    await settle(cookbookStore.refreshFromNostr());

    expect(view.status).toBe('found');
    if (view.status === 'found') {
      expect(view.confirmed).toBe(false);
      expect(view.list.recipes).toEqual([aTag('r1'), aTag('r2')]);
    }
    const inStore = get(cookbookStore).lists.find((l) => l.id === DEFAULT_LIST_ID);
    expect(inStore?.recipes).toEqual([aTag('r1'), aTag('r2')]);
  });
});

describe('the placeholder is never written', () => {
  it('a save while the store holds the placeholder builds on the real list the read finds', async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty' };
    const placeholder = await settle(cookbookStore.ensureDefaultList());
    expect(placeholder?.localOnly).toBe(true);

    // Saved from another device since.
    net.relays = { [NOS]: listOn(1761218623, [aTag('other')]), [PRIMAL]: 'empty' };
    expect(await settle(cookbookStore.quickSave(recipe('new')))).toBe(true);

    expect(published).toHaveLength(1);
    expect(recipesIn(published[0])).toEqual([aTag('other'), aTag('new')]);
  });

  it('refuses when the read misses the quorum, and publishes nothing', async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty' };
    expect((await settle(cookbookStore.ensureDefaultList()))?.localOnly).toBe(true);

    net.relays = { [NOS]: 'empty', [PRIMAL]: 'silent' };
    const result = await settle(cookbookStore.editSavedList({ meta: { summary: 'x' } }));

    expect(result.ok).toBe(false);
    expect(published).toHaveLength(0);
  });

  it('is never persisted to this device', async () => {
    net.relays = { [NOS]: 'empty', [PRIMAL]: 'empty' };
    await settle(cookbookStore.ensureDefaultList());
    await settle(cookbookStore.refreshFromNostr());

    const persisted = vi.mocked(offlineStorage.saveCookbook).mock.calls as unknown as [
      { localOnly?: boolean }
    ][];
    expect(persisted.some(([list]) => list.localOnly)).toBe(false);
  });
});
