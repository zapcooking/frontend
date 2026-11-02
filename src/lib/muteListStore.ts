import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { userPublickey } from '$lib/nostr';
import {
  fetchMuteListWithStatus,
  parseMuteListEvent,
  type MuteList
} from '$lib/mutableIntegration';

interface MuteListState {
  muteList: MuteList | null;
  loading: boolean;
  error: string | null;
  lastFetched: number | null;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get muted users from localStorage (legacy system)
 */
function getLocalStorageMutes(): string[] {
  if (!browser) return [];
  try {
    const stored = localStorage.getItem('mutedUsers');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Mutes applied on this device that a load's relay copy may not show yet:
// the optimistic hide from a post's menu (pubkeys are also mirrored in the
// legacy localStorage list, which can fail on its own), kept until the
// relay copy confirms them — or the member unmutes here. Without this, the
// store's reload after publishing could briefly drop a just-made mute (or
// one whose encrypted content can't be decrypted on this device) and flash
// the muted post back on screen.
const pendingPubkeys = new Set<string>();
const pendingThreads = new Set<string>();

const EMPTY_MUTE_LIST = (): MuteList => ({ pubkeys: [], words: [], tags: [], threads: [] });

/** The list with every unconfirmed local mute applied; confirmed ones are
 *  pruned from the pending set as the relay copy reports them. */
function withPendingOverlay(list: MuteList): MuteList {
  for (const p of list.pubkeys) pendingPubkeys.delete(p.value);
  for (const t of list.threads) pendingThreads.delete(t.value);
  const pubkeys = [...list.pubkeys];
  for (const pk of pendingPubkeys) {
    if (!pubkeys.some((x) => x.value === pk)) {
      pubkeys.push({ type: 'pubkey', value: pk, private: true });
    }
  }
  const threads = [...list.threads];
  for (const id of pendingThreads) {
    if (!threads.some((x) => x.value === id)) {
      threads.push({ type: 'thread', value: id, private: true });
    }
  }
  return { ...list, pubkeys, threads };
}

function createMuteListStore() {
  const { subscribe, set, update } = writable<MuteListState>({
    muteList: null,
    loading: false,
    error: null,
    lastFetched: null
  });

  // Several components ask at mount (feeds, notifications, a profile): one
  // fetch serves them all.
  let inflight: Promise<void> | null = null;

  async function loadOnce(force: boolean): Promise<void> {
    const currentState = get({ subscribe });
    const pubkey = get(userPublickey);

    if (!pubkey) {
      pendingPubkeys.clear();
      pendingThreads.clear();
      set({ muteList: null, loading: false, error: null, lastFetched: null });
      return;
    }

    // Use cache if recent and not forced
    if (!force && currentState.muteList && currentState.lastFetched) {
      const age = Date.now() - currentState.lastFetched;
      if (age < CACHE_DURATION) {
        return; // Use cached data
      }
    }

    update((state) => ({ ...state, loading: true, error: null }));

    try {
      // Start with localStorage mutes (legacy system)
      const localMutes = getLocalStorageMutes();
      console.log('[MuteListStore] localStorage mutes:', localMutes);
      const baseMuteList: MuteList = {
        pubkeys: localMutes.map((pk) => ({
          type: 'pubkey' as const,
          value: pk,
          private: false
        })),
        words: [],
        tags: [],
        threads: []
      };

      // Try to fetch NIP-51 mute list and merge
      const fetched = await fetchMuteListWithStatus(pubkey);
      if (fetched.status === 'unavailable') {
        // The relays could not be asked (cold pool, timeout). Caching this
        // localStorage-only view would hide the member's mutes for the
        // cache window, so leave lastFetched null: the next load() asks
        // the relays again.
        console.warn(
          '[MuteListStore] Relay copy unavailable; keeping local mutes and retrying on next load()'
        );
        set({
          muteList: withPendingOverlay(baseMuteList),
          loading: false,
          error: 'Mute list unavailable on relays',
          lastFetched: null
        });
        return;
      }
      if (fetched.status === 'found') {
        const nip51MuteList = await parseMuteListEvent(fetched.event);
        // Merge NIP-51 mutes with localStorage mutes (dedupe by pubkey)
        const existingPubkeys = new Set(baseMuteList.pubkeys.map((p) => p.value));
        for (const pk of nip51MuteList.pubkeys) {
          if (!existingPubkeys.has(pk.value)) {
            baseMuteList.pubkeys.push(pk);
          }
        }
        baseMuteList.words.push(...nip51MuteList.words);
        baseMuteList.tags.push(...nip51MuteList.tags);
        baseMuteList.threads.push(...nip51MuteList.threads);
      }

      console.log(
        '[MuteListStore] Setting mute list with',
        baseMuteList.pubkeys.length,
        'muted pubkeys'
      );
      set({
        muteList: withPendingOverlay(baseMuteList),
        loading: false,
        error: null,
        lastFetched: Date.now()
      });
    } catch (error) {
      console.error('Failed to load mute list:', error);
      // Even on error, load localStorage mutes
      const localMutes = getLocalStorageMutes();
      set({
        muteList: withPendingOverlay({
          pubkeys: localMutes.map((pk) => ({
            type: 'pubkey' as const,
            value: pk,
            private: false
          })),
          words: [],
          tags: [],
          threads: []
        }),
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        // A failed load must not stick: the next load() retries instead of
        // trusting this view for the cache window.
        lastFetched: null
      });
    }
  }

  return {
    subscribe,

    load(force: boolean = false): Promise<void> {
      if (inflight) return inflight;
      inflight = loadOnce(force).finally(() => {
        inflight = null;
      });
      return inflight;
    },

    invalidate() {
      update((state) => ({ ...state, lastFetched: null }));
    },

    /**
     * Apply a mute change to this device immediately, before the relay
     * edit confirms it ($lib/muteToggle): the post on screen must vanish
     * the moment its author is muted. The change stays merged into every
     * later load until the relay copy confirms it, so a reload can't
     * flash the muted content back.
     */
    applyLocalMute(target: { pubkey?: string; eventId?: string }, muted: boolean) {
      if (!target.pubkey && !target.eventId) return;
      if (target.pubkey) {
        if (muted) pendingPubkeys.add(target.pubkey);
        else pendingPubkeys.delete(target.pubkey);
      }
      if (target.eventId) {
        if (muted) pendingThreads.add(target.eventId);
        else pendingThreads.delete(target.eventId);
      }
      update((state) => {
        const base = state.muteList ?? EMPTY_MUTE_LIST();
        // Drop the target from the loaded list, then re-apply the overlay:
        // a mute dedupes into one entry, an unmute takes effect even when
        // the relay copy it is being removed from still carries it.
        const pubkeys = base.pubkeys.filter((p) => p.value !== target.pubkey);
        const threads = base.threads.filter((t) => t.value !== target.eventId);
        return {
          ...state,
          error: null,
          muteList: withPendingOverlay({ ...base, pubkeys, threads })
        };
      });
    }
  };
}

export const muteListStore = createMuteListStore();

// Derived store for quick pubkey checks
export const mutedPubkeys = derived(muteListStore, ($store) => {
  if (!$store.muteList) return new Set<string>();
  return new Set($store.muteList.pubkeys.map((p) => p.value));
});
