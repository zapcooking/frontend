import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import { userPublickey } from '$lib/nostr';
import { fetchMuteList, parseMuteListEvent, type MuteList } from '$lib/mutableIntegration';

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

function createMuteListStore() {
  const { subscribe, set, update } = writable<MuteListState>({
    muteList: null,
    loading: false,
    error: null,
    lastFetched: null
  });

  return {
    subscribe,

    async load(force: boolean = false) {
      const currentState = get({ subscribe });
      const pubkey = get(userPublickey);

      if (!pubkey) {
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
        const event = await fetchMuteList(pubkey);
        if (event) {
          const nip51MuteList = await parseMuteListEvent(event);
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
          muteList: baseMuteList,
          loading: false,
          error: null,
          lastFetched: Date.now()
        });
      } catch (error) {
        console.error('Failed to load mute list:', error);
        // Even on error, load localStorage mutes
        const localMutes = getLocalStorageMutes();
        set({
          muteList: {
            pubkeys: localMutes.map((pk) => ({
              type: 'pubkey' as const,
              value: pk,
              private: false
            })),
            words: [],
            tags: [],
            threads: []
          },
          loading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          lastFetched: Date.now()
        });
      }
    },

    invalidate() {
      update((state) => ({ ...state, lastFetched: null }));
    }
  };
}

export const muteListStore = createMuteListStore();

// Derived store for quick pubkey checks
export const mutedPubkeys = derived(muteListStore, ($store) => {
  if (!$store.muteList) return new Set<string>();
  return new Set($store.muteList.pubkeys.map((p) => p.value));
});
