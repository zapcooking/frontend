import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

/**
 * Cold-session regression tests for the cookbook store
 * (docs/ndk-readiness-discovery.md §4a/§4b, PR B):
 *
 * - load() on a cold cache AWAITS the relay refresh, so consumers never
 *   observe initialized:true with an empty, never-fetched list set (the
 *   My Kitchen "Start Your Kitchen" flash).
 * - ensureDefaultList() only creates the default kind-30001 after a refresh
 *   that reached EOSE confirmed absence — never against a store that hasn't
 *   fetched (the replaceable-event overwrite hazard), and never on
 *   navigator.onLine alone.
 */

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable<unknown>(null),
    userPublickey: writable(''),
    ensureNdkConnected: vi.fn(async () => {})
  };
});

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

import { ndk, userPublickey, ensureNdkConnected } from '$lib/nostr';
import { isCurrentlyOnline } from '$lib/connectionMonitor';
import { offlineStorage } from '$lib/offlineStorage';
import {
  cookbookStore,
  DEFAULT_LIST_ID,
  DEFAULT_LIST_TITLE,
  type CookbookState
} from './cookbookStore';

const PUBKEY = 'a'.repeat(64);

// The mocked ndk store keeps the real module's Writable<NDK> type.
const setNdk = (instance: FakeNdkInstance) => ndk.set(instance as unknown as NDK);

type Handler = (...args: unknown[]) => unknown;

class FakeSubscription {
  private handlers = new Map<string, Handler[]>();
  stopped = false;

  on(event: string, cb: Handler) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  stop() {
    this.stopped = true;
  }

  async emit(event: string, ...args: unknown[]): Promise<void> {
    for (const cb of this.handlers.get(event) ?? []) {
      await cb(...args);
    }
  }
}

/** A relay-side kind-30001 event, as delivered to the subscription. */
function relayListEvent(dTag: string, title: string, recipeATags: string[] = []) {
  return {
    tags: [
      ['d', dTag],
      ['title', title],
      ...recipeATags.map((a) => ['a', a])
    ],
    created_at: 1700000000,
    pubkey: PUBKEY
  } as unknown as NDKEvent;
}

interface FakeNdkInstance {
  subscribe: ReturnType<typeof vi.fn>;
}

/** Fake NDK whose subscribe() hands each new subscription to `onSubscribe`. */
function makeFakeNdk(onSubscribe?: (sub: FakeSubscription) => void): FakeNdkInstance {
  return {
    subscribe: vi.fn(() => {
      const sub = new FakeSubscription();
      onSubscribe?.(sub);
      return sub;
    })
  };
}

/** Auto-respond: relay delivers `events` then EOSE on the next microtask. */
function autoRespond(events: NDKEvent[]): FakeNdkInstance {
  return makeFakeNdk((sub) => {
    queueMicrotask(async () => {
      for (const e of events) await sub.emit('event', e);
      await sub.emit('eose');
    });
  });
}

function warmCacheEntry(dTag: string, title: string, recipes: string[] = []) {
  return {
    id: dTag,
    pubkey: PUBKEY,
    data: {
      id: dTag,
      naddr: 'naddr1fake',
      title,
      recipeCount: recipes.length,
      recipes,
      createdAt: 1690000000,
      isDefault: dTag === DEFAULT_LIST_ID,
      eventTags: [
        ['d', dTag],
        ['title', title]
      ],
      eventPubkey: PUBKEY,
      eventCreatedAt: 1690000000
    },
    lastSynced: 1690000000,
    pendingChanges: false,
    localVersion: 1
  };
}

describe('cookbookStore cold-session behavior', () => {
  let publishSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    cookbookStore.reset();
    userPublickey.set(PUBKEY);
    vi.mocked(isCurrentlyOnline).mockReturnValue(true);
    vi.mocked(offlineStorage.getAllCookbooks).mockResolvedValue([]);
    vi.mocked(offlineStorage.getPendingOperations).mockResolvedValue([]);
    publishSpy = vi
      .spyOn(NDKEvent.prototype, 'publish')
      .mockResolvedValue(new Set() as never);
  });

  afterEach(() => {
    cookbookStore.reset();
    publishSpy.mockRestore();
    vi.useRealTimers();
  });

  describe('load() on a cold cache', () => {
    it('awaits the relay refresh and never emits initialized:true with an empty, unfetched list set', async () => {
      let capturedSub: FakeSubscription | null = null;
      setNdk(makeFakeNdk((sub) => (capturedSub = sub)));

      const states: CookbookState[] = [];
      const unsubscribe = cookbookStore.subscribe((s) =>
        states.push({ ...s, lists: [...s.lists] })
      );

      let loadResolved = false;
      const loadPromise = cookbookStore.load().then(() => {
        loadResolved = true;
      });

      // Let load() reach the subscription; without EOSE it must not resolve.
      await vi.advanceTimersByTimeAsync(0);
      expect(capturedSub).not.toBeNull();
      expect(loadResolved).toBe(false);
      expect(vi.mocked(ensureNdkConnected)).toHaveBeenCalled();

      await capturedSub!.emit('event', relayListEvent(DEFAULT_LIST_ID, DEFAULT_LIST_TITLE, ['30023:pk:x']));
      await capturedSub!.emit('eose');
      await loadPromise;

      unsubscribe();
      expect(loadResolved).toBe(true);
      expect(get(cookbookStore).lists).toHaveLength(1);
      expect(get(cookbookStore).lists[0].id).toBe(DEFAULT_LIST_ID);

      // The empty-flash regression: no observed state may claim
      // "initialized, and there are zero lists" before the fetch landed.
      const emptyInitialized = states.filter((s) => s.initialized && s.lists.length === 0);
      expect(emptyInitialized).toHaveLength(0);
    });

    it('with a warm cache, resolves from IndexedDB immediately and reconciles in the background', async () => {
      vi.mocked(offlineStorage.getAllCookbooks).mockResolvedValue([
        warmCacheEntry(DEFAULT_LIST_ID, DEFAULT_LIST_TITLE)
      ] as never);

      let capturedSub: FakeSubscription | null = null;
      setNdk(makeFakeNdk((sub) => (capturedSub = sub)));

      await cookbookStore.load();

      // Cache rendered without waiting for the network.
      const afterLoad = get(cookbookStore);
      expect(afterLoad.initialized).toBe(true);
      expect(afterLoad.lists).toHaveLength(1);
      expect(afterLoad.lists[0].title).toBe(DEFAULT_LIST_TITLE);

      // The background refresh started, and its EOSE reconciles the UI:
      // a recipe saved on another device shows up without a reload.
      expect(afterLoad.lists[0].recipes).toEqual([]);
      await vi.advanceTimersByTimeAsync(0);
      expect(capturedSub).not.toBeNull();
      await capturedSub!.emit(
        'event',
        relayListEvent(DEFAULT_LIST_ID, DEFAULT_LIST_TITLE, ['30023:pk:from-other-device'])
      );
      await capturedSub!.emit('eose');
      expect(get(cookbookStore).lists[0].recipes).toEqual(['30023:pk:from-other-device']);
    });
  });

  describe('ensureDefaultList()', () => {
    it('does NOT create when the list exists on relays but not yet in the store (overwrite hazard)', async () => {
      // Cold store, but the user's real Saved list (with recipes) lives on
      // the relays. Pre-fix behavior published a fresh EMPTY kind-30001 with
      // the same d tag here, superseding it.
      setNdk(autoRespond([
        relayListEvent(DEFAULT_LIST_ID, DEFAULT_LIST_TITLE, ['30023:pk:r1', '30023:pk:r2'])
      ]));

      const result = await cookbookStore.ensureDefaultList();

      expect(result).not.toBeNull();
      expect(result!.id).toBe(DEFAULT_LIST_ID);
      expect(result!.recipes).toEqual(['30023:pk:r1', '30023:pk:r2']);
      expect(publishSpy).not.toHaveBeenCalled();
      expect(vi.mocked(offlineStorage.queueOperation)).not.toHaveBeenCalled();
    });

    it('creates (and publishes) after a completed refresh confirmed absence', async () => {
      setNdk(autoRespond([]));

      const result = await cookbookStore.ensureDefaultList();

      expect(result).not.toBeNull();
      expect(result!.id).toBe(DEFAULT_LIST_ID);
      expect(result!.recipes).toEqual([]);
      expect(publishSpy).toHaveBeenCalledTimes(1);
      expect(get(cookbookStore).lists.some((l) => l.isDefault)).toBe(true);
    });

    it('creates even when navigator.onLine is false — readiness, not onLine, is the gate', async () => {
      // navigator.onLine misreporting must not block a publish the relays
      // can actually take: the refresh below completes, confirming absence.
      vi.mocked(isCurrentlyOnline).mockReturnValue(false);
      setNdk(autoRespond([]));

      const result = await cookbookStore.ensureDefaultList();

      expect(result).not.toBeNull();
      expect(publishSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null and creates nothing when absence cannot be confirmed (refresh never EOSEs)', async () => {
      // Relays unreachable: subscription never EOSEs, the refresh resolves
      // via its timeout, absence stays unconfirmed.
      setNdk(makeFakeNdk());

      let result: Awaited<ReturnType<typeof cookbookStore.ensureDefaultList>> = null;
      const promise = cookbookStore.ensureDefaultList().then((r) => (result = r));

      await vi.advanceTimersByTimeAsync(11000); // past REFRESH_EOSE_TIMEOUT_MS
      await promise;

      expect(result).toBeNull();
      expect(publishSpy).not.toHaveBeenCalled();
      expect(vi.mocked(offlineStorage.queueOperation)).not.toHaveBeenCalled();
      expect(get(cookbookStore).lists).toHaveLength(0);
    });

    it('reuses a refresh that already confirmed absence instead of running another', async () => {
      const fakeNdk = autoRespond([]);
      setNdk(fakeNdk);

      await cookbookStore.refreshFromNostr();
      expect(fakeNdk.subscribe).toHaveBeenCalledTimes(1);

      const result = await cookbookStore.ensureDefaultList();
      expect(result).not.toBeNull();
      expect(fakeNdk.subscribe).toHaveBeenCalledTimes(1); // no second subscribe
      expect(publishSpy).toHaveBeenCalledTimes(1);
    });
  });
});
