import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { ndk, userPublickey, ensureNdkConnected } from '$lib/nostr';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { outboxRelaySet } from '$lib/outboxPublish';
import { addClientTagToEvent } from '$lib/nip89';
import { showToast } from '$lib/toast';

/**
 * Note bookmarks — the note action bar's bookmark button.
 *
 * Writes the same list the iOS client reads: NIP-51 kind 30003 "bookmark
 * set" with d-tag `bookmarks` (iOS derives the d-tag by slugifying the
 * list name, so a web list named "Bookmarks" IS an iOS list named
 * "Bookmarks") and one public `e` tag per saved note id. iOS's
 * `listsContaining(noteId:)` matches any 30003 list, so a note saved here
 * shows bookmarked there, and vice versa.
 *
 * Optimistic toggle: the tag set flips immediately, then the replaceable
 * event republishes; a failed publish rolls the local state back and toasts.
 */

const LIST_D_TAG = 'bookmarks';
const LIST_TITLE = 'Bookmarks';

interface NoteBookmarksState {
  /** Lowercased note ids currently saved. */
  ids: Set<string>;
  loaded: boolean;
  loading: boolean;
  /** Pubkey the current state was loaded for (resets on account switch). */
  pubkey: string | null;
}

function createNoteBookmarksStore() {
  const { subscribe, set, update } = writable<NoteBookmarksState>({
    ids: new Set(),
    loaded: false,
    loading: false,
    pubkey: null
  });

  let inflight: Promise<void> | null = null;
  // created_at of the last list we published, so quick on/off toggles
  // force strictly increasing timestamps (see publishList).
  let lastPublishCreatedAt = 0;

  /** The user's bookmark-set event, or null when they have none yet. */
  async function fetchListEvent(pubkey: string): Promise<NDKEvent | null> {
    const ndkInstance = get(ndk);
    if (!ndkInstance) return null;
    await ensureNdkConnected();
    return new Promise<NDKEvent | null>((resolve) => {
      const sub = ndkInstance.subscribe(
        { kinds: [30003], authors: [pubkey], '#d': [LIST_D_TAG], limit: 1 },
        { closeOnEose: true }
      );
      const timeout = setTimeout(() => resolve(null), 6000);
      sub.on('event', (event: NDKEvent) => {
        clearTimeout(timeout);
        resolve(event);
      });
      sub.on('eose', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  async function load(): Promise<void> {
    const pubkey = get(userPublickey);
    if (!browser || !pubkey) {
      set({ ids: new Set(), loaded: false, loading: false, pubkey: null });
      return;
    }
    if (inflight) return inflight;

    const current = get({ subscribe });
    if (current.loaded && current.pubkey === pubkey) return;

    inflight = (async () => {
      update((s) => ({ ...s, loading: true }));
      try {
        const event = await fetchListEvent(pubkey);
        const ids = new Set<string>();
        if (event) {
          for (const tag of event.tags) {
            if (tag[0] === 'e' && tag[1]) ids.add(tag[1].toLowerCase());
          }
        }
        set({ ids, loaded: true, loading: false, pubkey });
      } catch (error) {
        console.warn('[NoteBookmarks] load failed:', error);
        set({ ids: new Set(), loaded: true, loading: false, pubkey });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function publishList(ids: Set<string>): Promise<boolean> {
    const ndkInstance = get(ndk);
    const pubkey = get(userPublickey);
    if (!ndkInstance || !pubkey) return false;

    const event = new NDKEvent(ndkInstance);
    event.kind = 30003;
    // Successive toggles can land in the same second; replaceable events
    // with identical created_at resolve nondeterministically across relays,
    // so a quick on/off could leave half the relays showing the bookmark.
    // Force strictly increasing timestamps within the session.
    event.created_at = Math.max(Math.floor(Date.now() / 1000), lastPublishCreatedAt + 1);
    lastPublishCreatedAt = event.created_at;
    event.tags = [
      ['d', LIST_D_TAG],
      ['title', LIST_TITLE],
      ...[...ids].map((id) => ['e', id])
    ];
    addClientTagToEvent(event);
    try {
      await event.publish(await outboxRelaySet(event, 'list'));
      return true;
    } catch (error) {
      console.warn('[NoteBookmarks] publish failed:', error);
      return false;
    }
  }

  return {
    subscribe,

    /** Load the member's bookmark set once per session/account. */
    load,

    /**
     * Toggle a note's bookmark. Optimistic: state flips first, the
     * replaceable event republishes, and a failed publish rolls back.
     */
    async toggle(noteId: string): Promise<boolean> {
      const pubkey = get(userPublickey);
      if (!browser || !pubkey) {
        showToast('info', 'Log in to save notes');
        return false;
      }

      await load();
      const id = noteId.toLowerCase();
      const before = get({ subscribe }).ids;
      const saved = before.has(id);
      const next = new Set(before);
      if (saved) next.delete(id);
      else next.add(id);

      // Optimistic flip…
      set({ ids: next, loaded: true, loading: false, pubkey });

      const ok = await publishList(next);
      if (!ok) {
        // …rolled back when the relays refuse it.
        set({ ids: before, loaded: true, loading: false, pubkey });
        showToast('error', "Couldn't save bookmark — please try again.");
      }
      return ok ? !saved : saved;
    }
  };
}

export const noteBookmarksStore = createNoteBookmarksStore();
