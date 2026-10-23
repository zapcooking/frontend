import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

/**
 * Custom collections (any kind-30001 list but Saved) get the Saved list's
 * protections (#879): a fresh per-relay read before every write, the quorum
 * / confirmed-absence rules, one event built on the newest copy, strictly
 * newer created_at — and every tag but the recipes kept verbatim (cover,
 * image, summary, `t`, other clients' tags).
 *
 * Relays are faked per URL; each holds lists by d tag, answers empty, or
 * stays silent.
 */

let PUBKEY = '';
let accountCounter = 0;
const NOS = 'wss://nos.lol';
const PRIMAL = 'wss://relay.primal.net';
const NET = 'wss://relay.nostr.net';
const D = 'weeknight-dinners';
const R = (d: string) => `30023:${'c'.repeat(64)}:${d}`;

type Stored = { id: string; created_at: number; tags: string[][]; content: string };
type RelayState = 'silent' | Record<string, Stored>;
const net = vi.hoisted(() => ({
  relays: {} as Record<string, unknown>,
  publishedTo: [] as string[][]
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable<unknown>(null),
    userPublickey: writable(''),
    ensureNdkConnected: vi.fn(async () => {}),
    getCurrentRelays: () => [NOS, PRIMAL]
  };
});
vi.mock('$lib/nip65Routing', () => ({
  listRelayUrls: vi.fn(async () => Object.keys(net.relays)),
  listRelayUrlsFrom: vi.fn(async () => Object.keys(net.relays)),
  getOwnWriteRelays: vi.fn(async () => []),
  listRelaySet: vi.fn(async () => undefined),
  relaySetForUrls: vi.fn(async (_ndk: unknown, urls: string[]) => {
    net.publishedTo.push([...urls]);
    return undefined;
  }),
  outboxRelaySet: vi.fn(async () => undefined)
}));
vi.mock('$lib/relayListCache', () => ({
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
import { isCurrentlyOnline } from '$lib/connectionMonitor';
import { offlineStorage } from '$lib/offlineStorage';
import { get } from 'svelte/store';
import { isHiddenRecipeATag } from '$lib/consts';
import { cookbookStore, LIST_EXISTS_MESSAGE, LIST_UNCONFIRMED_MESSAGE } from './cookbookStore';

const FOREIGN = ['zap-sort', 'manual'];
const COVER_IMG = 'https://image.example/cover.jpg';

function listEvent(created_at: number, recipes: string[], extra: string[][] = []): Stored {
  return {
    id: `ev-${created_at}`,
    created_at,
    tags: [
      ['d', D],
      ['title', 'Weeknight dinners'],
      ['summary', 'Fast ones'],
      ['image', COVER_IMG],
      ['t', 'zapcooking'],
      FOREIGN,
      ...extra,
      ...recipes.map((a) => ['a', a])
    ],
    content: ''
  };
}

/** The per-relay safety read. */
const fakeQuery = async (url: string, filter?: { kinds?: number[]; '#d'?: string[] }) => {
  if (filter?.kinds?.[0] === 10002) return { url, ok: true, list: null };
  const r = net.relays[url] as RelayState;
  if (r === 'silent') return { url, ok: false, list: null };
  const found = r[filter?.['#d']?.[0] ?? ''];
  return { url, ok: true, list: found ? ({ ...found, pubkey: PUBKEY } as never) : null };
};

/** NDK subscription (My Kitchen refresh): every stored list, then EOSE. */
function fakeNdk() {
  return {
    subscribe: vi.fn(() => {
      const handlers: Record<string, ((...a: unknown[]) => unknown)[]> = {};
      const sub = {
        on: (e: string, cb: (...a: unknown[]) => unknown) => (handlers[e] ??= []).push(cb),
        stop: () => {}
      };
      queueMicrotask(async () => {
        for (const cb of handlers.eose ?? []) await cb();
      });
      return sub;
    })
  };
}

const recipe = (d: string) =>
  ({ kind: 30023, pubkey: 'c'.repeat(64), replaceableDTag: () => d }) as unknown as NDKEvent;

let published: { tags: string[][]; created_at?: number }[] = [];

/** Put a list into the store as My Kitchen would have loaded it (possibly stale). */
function seedStore(ev: Stored) {
  const event = new NDKEvent(get(ndk) as never, { ...ev, kind: 30001, pubkey: PUBKEY } as never);
  cookbookStore.update((s) => ({
    ...s,
    lists: [
      {
        id: D,
        naddr: 'naddr-x',
        title: 'Weeknight dinners',
        summary: 'Fast ones',
        image: COVER_IMG,
        coverRecipeId: ev.tags.find((t) => t[0] === 'cover')?.[1],
        // As eventToList builds it: admin-hidden recipes left out.
        recipes: ev.tags.filter((t) => t[0] === 'a' && !isHiddenRecipeATag(t[1])).map((t) => t[1]),
        recipeCount: ev.tags.filter((t) => t[0] === 'a' && !isHiddenRecipeATag(t[1])).length,
        createdAt: ev.created_at,
        isDefault: false,
        event
      },
      ...s.lists
    ]
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  vi.clearAllMocks();
  vi.mocked(isCurrentlyOnline).mockReturnValue(true);
  cookbookStore.reset();
  net.relays = {};
  net.publishedTo = [];
  PUBKEY = (++accountCounter).toString(16).padStart(64, 'b');
  ndk.set(fakeNdk() as unknown as NDK);
  userPublickey.set(PUBKEY);
  published = [];
  vi.spyOn(NDKEvent.prototype, 'publish').mockImplementation(async function (this: NDKEvent) {
    published.push({ tags: this.tags.map((t) => [...t]), created_at: this.created_at });
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

async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const out = p.finally(() => (done = true));
  for (let i = 0; i < 40 && !done; i++) await vi.advanceTimersByTimeAsync(500);
  return out;
}

const recipesIn = (e: { tags: string[][] }) => e.tags.filter((t) => t[0] === 'a').map((t) => t[1]);
const nonRecipeTags = (e: { tags: string[][] }) =>
  e.tags.filter((t) => t[0] !== 'a' && t[0] !== 'client');

/** Relays hold a NEWER version than the page/store loaded (saved from another device). */
function staleStoreNewerRelays() {
  const stale = listEvent(1000, [R('r1')], [['cover', R('r1')]]);
  const newer = listEvent(2000, [R('r1'), R('r2')], [['cover', R('r1')]]);
  seedStore(stale);
  net.relays = { [NOS]: { [D]: newer }, [PRIMAL]: { [D]: newer }, [NET]: 'silent' };
  return { stale, newer };
}

describe('custom lists: a write never builds on a stale copy', () => {
  it('add: a recipe saved on another device since this page loaded is kept', async () => {
    staleStoreNewerRelays();
    expect(await settle(cookbookStore.addRecipeToList(D, recipe('r3')))).toBe(true);
    expect(published).toHaveLength(1);
    expect(recipesIn(published[0])).toEqual([R('r1'), R('r2'), R('r3')]);
    expect(published[0].created_at).toBeGreaterThan(2000);
  });

  it('remove: removes only that recipe from the newest copy', async () => {
    staleStoreNewerRelays();
    expect(await settle(cookbookStore.removeRecipeFromList(D, R('r1')))).toBe(true);
    expect(recipesIn(published[0])).toEqual([R('r2')]);
  });

  it('details edit: keeps the recipes the relays have', async () => {
    staleStoreNewerRelays();
    expect(await settle(cookbookStore.updateList(D, { title: 'Weeknights' }))).toBe(true);
    expect(recipesIn(published[0])).toEqual([R('r1'), R('r2')]);
    expect(published[0].tags).toContainEqual(['title', 'Weeknights']);
  });

  it('Manage Recipes (order + removals) builds on the fresh copy', async () => {
    staleStoreNewerRelays();
    // The modal showed only r1 (stale page); the member reordered, removed nothing.
    const r = await settle(cookbookStore.editList(D, { order: [R('r1')], remove: [] }));
    expect(r.ok).toBe(true);
    // Unchanged order on the fresh copy: nothing to publish, and r2 survives.
    expect(published).toHaveLength(0);
    expect(recipesIn(get(cookbookStore).lists.find((l) => l.id === D)!.event)).toEqual([
      R('r1'),
      R('r2')
    ]);
  });

  it('refuses (publishes nothing) when the read misses the quorum', async () => {
    seedStore(listEvent(1000, [R('r1')]));
    net.relays = { [NOS]: 'silent', [PRIMAL]: 'silent', [NET]: { [D]: listEvent(900, []) } };
    expect(await settle(cookbookStore.addRecipeToList(D, recipe('r3')))).toBe(false);
    const r = await settle(cookbookStore.editList(D, { remove: [R('r1')] }));
    expect(r).toEqual({ ok: false, message: LIST_UNCONFIRMED_MESSAGE });
    expect(published).toHaveLength(0);
  });

  it('never creates a list by editing one that exists nowhere', async () => {
    net.relays = { [NOS]: {}, [PRIMAL]: {} };
    const r = await settle(cookbookStore.editList(D, { add: [R('r2')] }));
    expect(r.ok).toBe(false);
    expect(published).toHaveLength(0);
  });

  it('a signed copy on this device is a base like for Saved (relays lost it: nothing shrinks)', async () => {
    seedStore(listEvent(1000, [R('r1')], [['cover', R('r1')]]));
    net.relays = { [NOS]: {}, [PRIMAL]: {} };
    const r = await settle(cookbookStore.editList(D, { add: [R('r2')] }));
    expect(r.ok).toBe(true);
    expect(recipesIn(published[0])).toEqual([R('r1'), R('r2')]);
  });
});

describe('custom lists: republish keeps every tag but the recipes', () => {
  const keepsEverything = (e: { tags: string[][] }, cover = R('r1')) => {
    expect(e.tags).toContainEqual(['cover', cover]);
    expect(e.tags).toContainEqual(['image', COVER_IMG]);
    expect(e.tags).toContainEqual(['summary', 'Fast ones']);
    expect(e.tags).toContainEqual(['t', 'zapcooking']);
    expect(e.tags).toContainEqual(FOREIGN);
  };

  beforeEach(() => {
    const ev = listEvent(2000, [R('r1'), R('r2')], [['cover', R('r1')]]);
    seedStore(ev);
    net.relays = { [NOS]: { [D]: ev }, [PRIMAL]: { [D]: ev } };
  });

  it('add', async () => {
    await settle(cookbookStore.addRecipeToList(D, recipe('r3')));
    keepsEverything(published[0]);
  });

  it('remove (not the cover)', async () => {
    await settle(cookbookStore.removeRecipeFromList(D, R('r2')));
    keepsEverything(published[0]);
  });

  it('bulk add', async () => {
    const res = await settle(cookbookStore.bulkAddRecipesToList(D, [recipe('r3'), recipe('r1')]));
    expect(res).toEqual({ added: 1, skipped: 1, failed: 0 });
    keepsEverything(published[0]);
  });

  it('set cover', async () => {
    await settle(cookbookStore.setCoverRecipe(D, R('r2')));
    keepsEverything(published[0], R('r2'));
  });

  it('details edit (title only)', async () => {
    await settle(cookbookStore.updateList(D, { title: 'Weeknights' }));
    keepsEverything(published[0]);
  });

  it('Manage Recipes: reorder + remove keeps cover, image and foreign tags', async () => {
    const r = await settle(cookbookStore.editList(D, { order: [R('r2'), R('r1')], remove: [] }));
    expect(r.ok).toBe(true);
    expect(recipesIn(published[0])).toEqual([R('r2'), R('r1')]);
    keepsEverything(published[0]);
    expect(nonRecipeTags(published[0])[0]).toEqual(['d', D]);
  });

  it('publishes to exactly the relays it read', async () => {
    await settle(cookbookStore.addRecipeToList(D, recipe('r3')));
    expect(net.publishedTo.at(-1)).toEqual([NOS, PRIMAL]);
  });
});

describe('hidden recipes stay in the member’s list (#883)', () => {
  it('an admin-hidden recipe the store filtered out is still in the republished list', async () => {
    const hidden = `30023:${'f62cdccd2c958cdd9726351cbc0e804ab9e32c47f6c62d649b0aaa23f9651f0d'}:e2e-salad`;
    const ev = listEvent(2000, [R('r1'), hidden]);
    seedStore(ev);
    net.relays = { [NOS]: { [D]: ev }, [PRIMAL]: { [D]: ev } };
    await settle(cookbookStore.addRecipeToList(D, recipe('r3')));
    expect(recipesIn(published[0])).toEqual([R('r1'), hidden, R('r3')]);
  });
});

describe('createList: no blind overwrite of an existing list', () => {
  it('refuses when a list with that identifier already exists on the relays', async () => {
    net.relays = { [NOS]: { [D]: listEvent(2000, [R('r1')]) }, [PRIMAL]: {} };
    await expect(settle(cookbookStore.createList('Weeknight dinners'))).rejects.toThrow(
      LIST_EXISTS_MESSAGE
    );
    expect(published).toHaveLength(0);
  });

  it('creates ONE event with the details after the relays confirm none', async () => {
    net.relays = { [NOS]: {}, [PRIMAL]: {} };
    const naddr = await settle(cookbookStore.createList('Weeknight dinners', 'Fast', COVER_IMG));
    expect(naddr).toBeTruthy();
    expect(published).toHaveLength(1);
    for (const tag of [
      ['d', D],
      ['title', 'Weeknight dinners'],
      ['t', 'zapcooking'],
      ['summary', 'Fast'],
      ['image', COVER_IMG]
    ]) {
      expect(published[0].tags).toContainEqual(tag);
    }
    expect(get(cookbookStore).lists.find((l) => l.id === D)?.title).toBe('Weeknight dinners');
  });

  it('refuses when absence can’t be confirmed', async () => {
    net.relays = { [NOS]: 'silent', [PRIMAL]: {} };
    await expect(settle(cookbookStore.createList('Weeknight dinners'))).rejects.toThrow();
    expect(published).toHaveLength(0);
  });
});

describe('offline: the change is queued, not a snapshot of local state', () => {
  it('queues the operation and publishes nothing until it can read', async () => {
    seedStore(listEvent(1000, [R('r1')]));
    vi.mocked(isCurrentlyOnline).mockReturnValue(false);
    expect(await settle(cookbookStore.addRecipeToList(D, recipe('r3')))).toBe(true);
    expect(published).toHaveLength(0);
    expect(offlineStorage.queueOperation).toHaveBeenCalledWith('add_recipe', D, { aTag: R('r3') });
    expect(get(cookbookStore).lists.find((l) => l.id === D)?.recipes).toEqual([R('r1'), R('r3')]);
  });

  it('the queued add replays as a guarded edit on the newest copy', async () => {
    const stale = listEvent(1000, [R('r1')]);
    seedStore(stale);
    const newer = listEvent(2000, [R('r1'), R('r2')], [['cover', R('r1')]]);
    net.relays = { [NOS]: { [D]: newer }, [PRIMAL]: { [D]: newer } };
    vi.mocked(offlineStorage.getPendingOperations).mockResolvedValueOnce([
      { id: 'op1', type: 'add_recipe', listId: D, payload: { aTag: R('r3') }, retryCount: 0 } as never
    ]);
    await settle(cookbookStore.syncNow());
    expect(published).toHaveLength(1);
    expect(recipesIn(published[0])).toEqual([R('r1'), R('r2'), R('r3')]);
    expect(published[0].tags).toContainEqual(['cover', R('r1')]);
    expect(published[0].tags).toContainEqual(FOREIGN);
  });
});
