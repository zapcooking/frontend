/**
 * Cookbook Store - Unified management for recipe collections
 * 
 * Uses NIP-51 kind 30001 for all lists. The default "Saved" list uses
 * the identifier 'nostrcooking-bookmarks' for backward compatibility.
 * 
 * OFFLINE-FIRST: Reads from IndexedDB first, then syncs with Nostr.
 * Changes are persisted locally and queued for sync when offline.
 */

import { outboxRelaySet } from '$lib/outboxPublish';
import { writable, derived, get } from 'svelte/store';
import { ndk, userPublickey, ensureNdkConnected } from '$lib/nostr';
import { NDKEvent, type NDKFilter, type NDKSubscription } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { RECIPE_TAGS, RECIPE_TAG_PREFIX_NEW, isHiddenRecipeATag } from '$lib/consts';
import { offlineStorage, type SyncOperation, type OfflineCookbook, type SerializedCookbookData } from '$lib/offlineStorage';
import { isCurrentlyOnline, onConnect } from '$lib/connectionMonitor';
import { parseATag } from '$lib/listTags';
import {
  buildSavedListEdit,
  decideSavedListBase,
  listAbsenceProven,
  newestList,
  type ListEvent,
  type SavedListChange
} from '$lib/savedListSafety';
import {
  getListSeen,
  isFreshAccount,
  noteListSeen,
  readListFromRelays,
  type QueryList
} from '$lib/savedList';

// Default list identifier (backward compatible with existing bookmarks)
export const DEFAULT_LIST_ID = 'nostrcooking-bookmarks';
export const DEFAULT_LIST_TITLE = 'Saved';

export interface CookbookList {
  id: string;           // The 'd' tag value
  naddr: string;        // Encoded address for routing
  title: string;
  summary?: string;
  image?: string;        // Legacy cover image URL (for backward compatibility)
  coverRecipeId?: string; // NEW: Reference to recipe to use as cover (a-tag format)
  recipeCount: number;
  recipes: string[];    // Array of 'a' tag values (kind:pubkey:identifier)
  createdAt: number;
  isDefault: boolean;
  event: NDKEvent;      // Original NDK event for updates
  pendingSync?: boolean; // True if has local changes not yet synced to Nostr
  /**
   * The default list's on-screen placeholder before its first save: never
   * published, never persisted, never a base for an edit — the first save
   * publishes the real list with the recipe in it.
   */
  localOnly?: boolean;
  /**
   * Restored from an IndexedDB record that predates storing event content:
   * fine to display, never the base of an edit.
   */
  contentUnknown?: boolean;
}

/** Outcome of an edit to the default "Saved" list. */
export type SavedListResult =
  | { ok: true; changed: boolean; /** Recipes actually added (not already there). */ added: number }
  | { ok: false; message: string };

export const SAVED_LIST_UNCONFIRMED_MESSAGE =
  "Couldn't load your Saved list, so nothing was changed. Please try again in a moment.";
export const SAVED_LIST_PUBLISH_FAILED_MESSAGE =
  "Couldn't update your Saved list, so nothing was changed. Please try again.";

/** What a per-relay read of the Saved list established. */
type SavedReadOutcome = 'found' | 'absent' | 'unknown';

/**
 * The member's own Saved list for display (My Kitchen's list page):
 * - `found`: the best copy available. `confirmed` is false when relays didn't
 *   return it this time and it comes from this device (IndexedDB).
 * - `absent`: relays proved there is none yet; `list` is the unpublished
 *   placeholder, for display only.
 * - `unavailable`: neither — the page must say it couldn't load, never show
 *   an empty list.
 */
export type SavedListView =
  | { status: 'found'; list: CookbookList; confirmed: boolean }
  | { status: 'absent'; list: CookbookList }
  | { status: 'unavailable' };

export interface CookbookState {
  lists: CookbookList[];
  loading: boolean;
  initialized: boolean;
  error: string | null;
  syncStatus: 'synced' | 'syncing' | 'pending' | 'offline';
  pendingOperations: number;
}

// Create the store
function createCookbookStore() {
  const { subscribe, set, update } = writable<CookbookState>({
    lists: [],
    loading: false,
    initialized: false,
    error: null,
    syncStatus: 'synced',
    pendingOperations: 0
  });

  let subscription: NDKSubscription | null = null;
  let syncUnsubscribe: (() => void) | null = null;

  // The Saved list's presence is decided by a per-relay read (readSavedList),
  // never by the refresh subscription finishing: NDK ends a subscription once
  // half its relays answered, and purplepag.es / nostr.wine (which never hold
  // lists) answer first, so "no Saved list at EOSE" often means "nos.lol
  // hadn't answered yet". One read per account and generation, shared.
  let savedRead: { gen: number; pubkey: string; promise: Promise<SavedReadOutcome> } | null = null;
  // The current generation's read proved the Saved list absent
  // (listAbsenceProven). Only then may the on-screen placeholder appear.
  let savedAbsenceProven = false;
  // Single-flight guard: concurrent refresh calls share one subscription —
  // a second subscribe would stop the first sub and strand its awaiter.
  let inflightRefresh: Promise<void> | null = null;

  // If relays never EOSE (dead pool, filter routed nowhere), resolve anyway so
  // an awaited refresh can't hang the UI. Does NOT count as a completed
  // refresh — absence stays unconfirmed.
  const REFRESH_EOSE_TIMEOUT_MS = 10000;

  // Account the store's lists belong to. The store is app-wide and a
  // sign-in can switch accounts under it: another account's lists must
  // never be shown, edited or republished under the new signer.
  let storePubkey = '';

  // created_at of the last version this session published, per list.
  // Every republish is strictly newer than both it and the list's current
  // event: relays keep the lower id when two versions tie on created_at,
  // which silently dropped saves made within one second.
  const lastPublishedAt = new Map<string, number>();

  // Default-list edits run one at a time: two quick saves would otherwise
  // both build on the same base and one would drop the other's recipe.
  let defaultEditQueue: Promise<unknown> = Promise.resolve();

  // Test seam: the per-relay reader used by default-list edits.
  let savedListQuery: QueryList | undefined;

  // Bumped by every reset (sign-out, account switch). Async loads and
  // refreshes capture it when they start and commit only if it is unchanged
  // — a slow load for account A must never install A's lists after B took
  // over the store.
  let generation = 0;

  // ensureLoaded(): one load per account, shared by every caller (a feed can
  // mount dozens of save buttons).
  let loadedFor = '';
  let inflightLoad: { pubkey: string; promise: Promise<void> } | null = null;

  // Register for auto-sync when connection is restored
  if (typeof window !== 'undefined') {
    syncUnsubscribe = onConnect(() => {
      console.log('[CookbookStore] Connection restored, triggering sync');
      syncPendingChanges();
    });
  }

  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const publishedKey = (pubkey: string, listId: string) => `${pubkey}:${listId}`;

  /** Strictly newer than the list's current event and this session's last publish. */
  function stampCreatedAt(event: NDKEvent, list: CookbookList | undefined, pubkey: string, listId: string) {
    const k = publishedKey(pubkey, listId);
    event.created_at = Math.max(
      nowSeconds(),
      (list?.event?.created_at ?? 0) + 1,
      (lastPublishedAt.get(k) ?? 0) + 1
    );
    lastPublishedAt.set(k, event.created_at);
  }

  function resetState() {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
    // Any load or refresh still running belongs to the state being reset:
    // its results must not land in the new one (see `generation`).
    generation++;
    // A reset store has no relay knowledge: absence must be re-proven
    // before ensureDefaultList may show the placeholder again.
    savedRead = null;
    savedAbsenceProven = false;
    inflightRefresh = null;
    set({
      lists: [],
      loading: false,
      initialized: false,
      error: null,
      syncStatus: 'synced',
      pendingOperations: 0
    });
  }

  /** Drop another account's lists before acting for `pubkey`. */
  function ensureAccount(pubkey: string) {
    if (storePubkey && storePubkey !== pubkey) resetState();
    storePubkey = pubkey;
  }

  /** Whether async work started at `gen` for `pubkey` may still change the store. */
  function stillCurrent(gen: number, pubkey: string): boolean {
    return gen === generation && storePubkey === pubkey && get(userPublickey) === pubkey;
  }

  /**
   * A list's event as an edit base: only a complete, signed copy by the
   * editing account counts — never the unpublished placeholder, another
   * account's list, or an IndexedDB record that lost its content.
   */
  function listEventOf(list: CookbookList | undefined, pubkey: string): ListEvent | null {
    if (!list || list.localOnly || list.contentUnknown) return null;
    if (!list.event?.id || !list.event.created_at || list.event.pubkey !== pubkey) return null;
    return { id: list.event.id, created_at: list.event.created_at, tags: list.event.tags, content: list.event.content };
  }

  /**
   * Read the Saved list from every relay it is written to, one REQ per relay
   * to its own EOSE (the safety read's reader). A list found is put into the
   * store when newer than what it holds. 'absent' only when
   * listAbsenceProven; anything less is 'unknown' and the store keeps the
   * best copy it has (IndexedDB, this session).
   */
  async function doReadSavedList(pubkey: string, gen: number): Promise<SavedReadOutcome> {
    let read: Awaited<ReturnType<typeof readListFromRelays>>;
    try {
      read = await readListFromRelays(pubkey, DEFAULT_LIST_ID, savedListQuery);
    } catch (error) {
      console.warn('[CookbookStore] Saved list read failed:', error);
      return 'unknown';
    }
    if (!stillCurrent(gen, pubkey)) return 'unknown';
    const found = newestList(...read.answers.map(a => a.list));
    if (found) {
      noteListSeen(pubkey, DEFAULT_LIST_ID, found);
      const current = get({ subscribe }).lists.find(l => l.id === DEFAULT_LIST_ID);
      if (!current || current.localOnly || (current.event?.created_at ?? 0) < found.created_at) {
        const ndkInstance = get(ndk);
        if (ndkInstance) {
          await adoptDefaultList(new NDKEvent(ndkInstance, { ...found, kind: 30001, pubkey } as never), pubkey);
        }
      }
      return 'found';
    }
    if (read.discovery === 'known' && listAbsenceProven(read.answers)) {
      savedAbsenceProven = true;
      return 'absent';
    }
    console.warn(
      '[CookbookStore] Saved list read incomplete:',
      read.discovery === 'unknown'
        ? 'write relays unknown'
        : read.answers.map(a => `${a.url}:${a.ok ? 'eose' : 'silent'}`)
    );
    return 'unknown';
  }

  /** The current generation's Saved-list read; `fresh` starts a new one. */
  function readSavedList(pubkey: string, fresh = false): Promise<SavedReadOutcome> {
    if (!fresh && savedRead && savedRead.gen === generation && savedRead.pubkey === pubkey) {
      return savedRead.promise;
    }
    const gen = generation;
    const promise = doReadSavedList(pubkey, gen);
    savedRead = { gen, pubkey, promise };
    // An inconclusive read isn't kept: the next caller asks the relays again.
    promise.then(outcome => {
      if (outcome === 'unknown' && savedRead?.promise === promise) savedRead = null;
    });
    return promise;
  }

  /** Put the default list's newest event into the store and IndexedDB. */
  async function adoptDefaultList(event: NDKEvent, pubkey: string): Promise<void> {
    if (storePubkey !== pubkey || get(userPublickey) !== pubkey) return;
    const list = eventToList(event, pubkey);
    if (!list) return;
    update(s => ({
      ...s,
      lists: [list, ...s.lists.filter(l => l.id !== DEFAULT_LIST_ID)]
    }));
    await offlineStorage.saveCookbook(list, pubkey, true);
  }

  /**
   * The one way the default "Saved" list is changed ($lib/savedListSafety
   * has the rules): read it from the relays it lives on, refuse unless the
   * read reaches the quorum, build ONE event on the newest copy, publish it
   * — to exactly the relays that were read — strictly newer than anything
   * before it. Nothing is published, and the store is untouched, when any
   * step fails. `pubkey` is the account that asked for the edit: it is
   * refused if a different account is signed in by the time it runs.
   */
  async function doEditDefaultList(change: SavedListChange, pubkey: string): Promise<SavedListResult> {
    const ndkInstance = get(ndk);
    if (!pubkey || !ndkInstance) return { ok: false, message: 'Sign in to save recipes.' };
    if (get(userPublickey) !== pubkey) return { ok: false, message: SAVED_LIST_UNCONFIRMED_MESSAGE };
    ensureAccount(pubkey);

    const local = listEventOf(get({ subscribe }).lists.find(l => l.id === DEFAULT_LIST_ID), pubkey);
    const fresh = isFreshAccount(pubkey);
    let answers: Awaited<ReturnType<typeof readListFromRelays>>['answers'] = [];
    let ownWrite: string[] = [];
    let urls: string[] = [];
    try {
      if (fresh) {
        const { listRelayUrls } = await import('$lib/nip65Routing');
        urls = await listRelayUrls(pubkey);
      } else {
        const read = await readListFromRelays(pubkey, DEFAULT_LIST_ID, savedListQuery);
        if (read.discovery === 'unknown') {
          console.warn("[CookbookStore] Saved list edit refused: couldn't establish the member's write relays");
          return { ok: false, message: SAVED_LIST_UNCONFIRMED_MESSAGE };
        }
        ({ answers, ownWrite, urls } = read);
      }
    } catch (error) {
      console.error('[CookbookStore] Saved list read failed:', error);
      return { ok: false, message: SAVED_LIST_UNCONFIRMED_MESSAGE };
    }
    const decision = decideSavedListBase({
      answers,
      ownWrite,
      local,
      seen: getListSeen(pubkey, DEFAULT_LIST_ID),
      fresh
    });
    if (!decision.ok) {
      console.warn('[CookbookStore] Saved list edit refused: read incomplete', answers.map(a => `${a.url}:${a.ok ? 'eose' : 'silent'}`));
      return { ok: false, message: SAVED_LIST_UNCONFIRMED_MESSAGE };
    }
    // Signed in as someone else while reading: this base isn't theirs.
    if (get(userPublickey) !== pubkey) return { ok: false, message: SAVED_LIST_UNCONFIRMED_MESSAGE };
    noteListSeen(pubkey, DEFAULT_LIST_ID, decision.base);

    const k = publishedKey(pubkey, DEFAULT_LIST_ID);
    const next = buildSavedListEdit(decision.base, change, {
      dTag: DEFAULT_LIST_ID,
      title: DEFAULT_LIST_TITLE,
      now: nowSeconds(),
      floor: lastPublishedAt.get(k) ?? 0
    });

    if (!next.changed) {
      // Nothing to publish (already saved / already gone) — but show the
      // newest copy the read found.
      if (decision.base?.id) {
        await adoptDefaultList(new NDKEvent(ndkInstance, { ...decision.base, kind: 30001, pubkey } as never), pubkey);
      }
      return { ok: true, changed: false, added: 0 };
    }

    const event = new NDKEvent(ndkInstance);
    event.kind = 30001;
    event.tags = next.tags;
    event.content = next.content;
    event.created_at = next.created_at;
    const { addClientTagToEvent } = await import('$lib/nip89');
    addClientTagToEvent(event);
    try {
      const { relaySetForUrls } = await import('$lib/nip65Routing');
      await event.publish(await relaySetForUrls(ndkInstance, urls));
    } catch (error) {
      console.error('[CookbookStore] Saved list publish failed:', error);
      return { ok: false, message: SAVED_LIST_PUBLISH_FAILED_MESSAGE };
    }
    lastPublishedAt.set(k, event.created_at!);
    noteListSeen(pubkey, DEFAULT_LIST_ID, {
      id: event.id,
      created_at: event.created_at!,
      tags: event.tags,
      content: event.content
    });
    await adoptDefaultList(event, pubkey);
    return { ok: true, changed: true, added: next.added };
  }

  /** Queue an edit for the account signed in NOW (see doEditDefaultList). */
  function editDefaultList(change: SavedListChange): Promise<SavedListResult> {
    const pubkey = get(userPublickey);
    const run = defaultEditQueue.catch(() => {}).then(() => doEditDefaultList(change, pubkey));
    defaultEditQueue = run.catch(() => {});
    return run;
  }

  const aTagOf = (recipeEvent: NDKEvent) =>
    `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`;

  /**
   * Process pending sync operations
   */
  async function syncPendingChanges(): Promise<void> {
    const pubkey = get(userPublickey);
    const ndkInstance = get(ndk);
    
    if (!pubkey || !ndkInstance || !isCurrentlyOnline()) {
      return;
    }

    update(s => ({ ...s, syncStatus: 'syncing' }));

    const operations = await offlineStorage.getPendingOperations();
    console.log(`[CookbookStore] Processing ${operations.length} pending operations`);

    for (const op of operations) {
      try {
        await executeSyncOperation(op, ndkInstance, pubkey);
        await offlineStorage.removeOperation(op.id);
        
        // Mark cookbook as synced
        await offlineStorage.markCookbookSynced(op.listId, pubkey);
        
        // Update pending count
        update(s => ({ 
          ...s, 
          pendingOperations: Math.max(0, s.pendingOperations - 1),
          lists: s.lists.map(l => 
            l.id === op.listId ? { ...l, pendingSync: false } : l
          )
        }));
      } catch (error) {
        console.error(`[CookbookStore] Failed to sync operation ${op.id}:`, error);
        await offlineStorage.updateOperationRetry(op.id, String(error));
        
        // Stop if too many retries
        if (op.retryCount >= 9) {
          console.warn(`[CookbookStore] Operation ${op.id} exceeded max retries, removing`);
          await offlineStorage.removeOperation(op.id);
        }
      }
    }

    // Clear failed operations
    await offlineStorage.clearFailedOperations();

    // Update final sync status
    const remaining = await offlineStorage.getPendingOperations();
    update(s => ({ 
      ...s, 
      syncStatus: remaining.length > 0 ? 'pending' : 'synced',
      pendingOperations: remaining.length
    }));
  }

  /**
   * Execute a single sync operation against Nostr
   */
  async function executeSyncOperation(
    op: SyncOperation,
    ndkInstance: any,
    pubkey: string
  ): Promise<void> {
    const state = get({ subscribe });
    const list = state.lists.find(l => l.id === op.listId);

    // The default list is never replayed from local state: a queued edit
    // becomes a fresh safe edit (and an old queued empty "create" is moot —
    // the first save creates the list with its recipe).
    if (op.listId === DEFAULT_LIST_ID) {
      const change: SavedListChange | null =
        op.type === 'add_recipe' ? { add: [op.payload.aTag] }
        : op.type === 'remove_recipe' ? { remove: [op.payload.recipeATag] }
        : op.type === 'set_cover' ? { cover: op.payload.recipeATag }
        : null;
      if (!change) return;
      const result = await editDefaultList(change);
      if (!result.ok) throw new Error(result.message);
      return;
    }
    
    switch (op.type) {
      case 'create_list': {
        const event = new NDKEvent(ndkInstance);
        event.kind = 30001;
        event.tags = [
          ['d', op.payload.identifier],
          ['title', op.payload.title],
          ['t', RECIPE_TAG_PREFIX_NEW]
        ];
        if (op.payload.summary) event.tags.push(['summary', op.payload.summary]);
        if (op.payload.image) event.tags.push(['image', op.payload.image]);
        
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        stampCreatedAt(event, list, pubkey, op.listId);
        await event.publish(await outboxRelaySet(event, 'list'));
        break;
      }
      
      case 'add_recipe': {
        if (!list) throw new Error('List not found');
        const event = rebuildListEvent(list, ndkInstance);
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        stampCreatedAt(event, list, pubkey, op.listId);
        await event.publish(await outboxRelaySet(event, 'list'));
        break;
      }
      
      case 'remove_recipe': {
        if (!list) throw new Error('List not found');
        const event = rebuildListEvent(list, ndkInstance);
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        stampCreatedAt(event, list, pubkey, op.listId);
        await event.publish(await outboxRelaySet(event, 'list'));
        break;
      }
      
      case 'update_list': {
        if (!list) throw new Error('List not found');
        const event = rebuildListEvent(list, ndkInstance);
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        stampCreatedAt(event, list, pubkey, op.listId);
        await event.publish(await outboxRelaySet(event, 'list'));
        break;
      }
      
      case 'set_cover': {
        if (!list) throw new Error('List not found');
        const event = rebuildListEvent(list, ndkInstance);
        const { addClientTagToEvent } = await import('$lib/nip89');
        addClientTagToEvent(event);
        stampCreatedAt(event, list, pubkey, op.listId);
        await event.publish(await outboxRelaySet(event, 'list'));
        break;
      }
      
      case 'delete_list': {
        const deleteEvent = new NDKEvent(ndkInstance);
        deleteEvent.kind = 5;
        deleteEvent.tags = [
          ['e', op.payload.eventId],
          ['a', `30001:${pubkey}:${op.listId}`]
        ];
        await deleteEvent.publish(await outboxRelaySet(deleteEvent, 'list'));
        break;
      }
    }
  }

  /**
   * Rebuild a list event from current state
   */
  function rebuildListEvent(list: CookbookList, ndkInstance: any): NDKEvent {
    const event = new NDKEvent(ndkInstance);
    event.kind = 30001;
    event.tags = [['d', list.id]];
    
    event.tags.push(['title', list.title]);
    if (list.summary) event.tags.push(['summary', list.summary]);
    if (list.image) event.tags.push(['image', list.image]);
    if (!list.isDefault) event.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
    if (list.coverRecipeId) event.tags.push(['cover', list.coverRecipeId]);
    
    list.recipes.forEach(r => event.tags.push(['a', r]));
    
    return event;
  }

  /**
   * Deserialize cookbook data from IndexedDB back to CookbookList
   */
  function deserializeCookbook(offline: OfflineCookbook, ndkInstance: any): CookbookList {
    const data = offline.data;
    
    // Rebuild the NDKEvent from serialized data
    const event = new NDKEvent(ndkInstance);
    event.kind = 30001;
    event.tags = data.eventTags || [];
    event.pubkey = data.eventPubkey;
    event.created_at = data.eventCreatedAt;
    if (data.eventId) {
      event.id = data.eventId;
    }
    if (typeof data.eventContent === 'string') event.content = data.eventContent;
    
    return {
      id: data.id,
      naddr: data.naddr,
      title: data.title,
      summary: data.summary,
      image: data.image,
      coverRecipeId: data.coverRecipeId,
      recipeCount: data.recipeCount,
      recipes: data.recipes,
      createdAt: data.createdAt,
      isDefault: data.isDefault,
      event,
      pendingSync: offline.pendingChanges,
      // Records from before content was stored can't be an edit base.
      contentUnknown: typeof data.eventContent !== 'string'
    };
  }

  /**
   * Save to local storage and optionally queue for sync
   */
  async function persistLocally(
    list: CookbookList, 
    pubkey: string, 
    synced: boolean = false
  ): Promise<void> {
    await offlineStorage.saveCookbook(list, pubkey, synced);
    
    if (!synced) {
      update(s => ({ 
        ...s, 
        syncStatus: 'pending',
        lists: s.lists.map(l => 
          l.id === list.id ? { ...l, pendingSync: true } : l
        )
      }));
    }
  }

  /**
   * Fetch cookbook lists from relays and reconcile into the store.
   * Only call via refreshFromNostr() (single-flight wrapper).
   */
  async function doRefreshFromNostr(): Promise<void> {
    const pubkey = get(userPublickey);
    const ndkInstance = get(ndk);

    if (!pubkey || !ndkInstance) return;
    ensureAccount(pubkey);
    const gen = generation;

    // The Saved list is read per relay alongside the subscription below
    // (see savedRead). Not awaited: the other lists render at EOSE, and the
    // Saved list lands in the store when its read finds it.
    void readSavedList(pubkey, true);

    // Wait for relay readiness before subscribing. Without this, a
    // cold-session subscribe races the connecting pool, EOSEs early against
    // the connected subset, and caches an empty list set
    // (docs/ndk-readiness-discovery.md §4a).
    //
    // Lists are read from exactly the relays they are written to
    // (listRelayUrls), so My Kitchen can never miss a relay a save reached.
    const [, relaySet] = await Promise.all([
      ensureNdkConnected().catch(() => {
        // ensureNdkConnected resolves rather than rejects by construction;
        // tolerate anyway and let the fetch (+ timeout below) decide.
      }),
      import('$lib/nip65Routing')
        .then((m) => m.listRelaySet(ndkInstance, pubkey))
        .catch(() => undefined)
    ]);

    // Clean up existing subscription
    if (subscription) {
      subscription.stop();
      subscription = null;
    }

    const lists: CookbookList[] = [];
    const seenIds = new Set<string>();

    // Fetch all kind 30001 lists: recipe lists + bookmarks
    const filters: NDKFilter[] = [
      {
        authors: [pubkey],
        kinds: [30001],
        '#t': RECIPE_TAGS,
        limit: 256
      },
      {
        authors: [pubkey],
        kinds: [30001],
        '#d': [DEFAULT_LIST_ID],
        limit: 1
      }
    ];

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      // Now that load() can await this promise, an EOSE that never arrives
      // must not hang callers.
      const eoseTimeout = setTimeout(() => {
        console.warn('[CookbookStore] Refresh timed out waiting for EOSE, keeping current lists');
        if (stillCurrent(gen, pubkey)) update(s => ({ ...s, loading: false, initialized: true }));
        finish();
      }, REFRESH_EOSE_TIMEOUT_MS);

      subscription = ndkInstance.subscribe(filters, { closeOnEose: true }, relaySet);

      subscription.on('event', (event: NDKEvent) => {
        if (event.pubkey && event.pubkey !== pubkey) return;
        const dTag = event.tags.find(t => t[0] === 'd')?.[1];
        if (!dTag || seenIds.has(dTag)) return;
        seenIds.add(dTag);

        const list = eventToList(event, pubkey);
        if (list) {
          lists.push(list);
        }
      });

      subscription.on('eose', async () => {
        clearTimeout(eoseTimeout);
        // Signed in as someone else (or the store was reset) meanwhile:
        // these lists aren't the current account's.
        if (!stillCurrent(gen, pubkey)) {
          finish();
          return;
        }

        // Final deduplication by id (in case of race conditions)
        const uniqueLists = lists.filter((list, index, self) =>
          index === self.findIndex(l => l.id === list.id)
        );

        // Sort: default list first, then by most recent
        uniqueLists.sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          return b.createdAt - a.createdAt;
        });

        // Merge with local state. A local copy wins when it has pending
        // changes or is a NEWER published version than the relays returned:
        // a refresh that started before a save finished must not put the
        // older list back (or make the saved recipe disappear).
        const currentState = get({ subscribe });
        const newerLocally = (local: CookbookList | undefined, remote: CookbookList) =>
          !!local &&
          !local.localOnly &&
          (local.event?.created_at ?? 0) > (remote.event?.created_at ?? 0);
        const mergedLists = uniqueLists.map(remoteList => {
          const localList = currentState.lists.find(l => l.id === remoteList.id);
          if (localList?.pendingSync || newerLocally(localList, remoteList)) return localList!;
          return remoteList;
        });

        // Keep local lists the relays didn't return: created offline
        // (pending), published this session (a relay may not have it yet),
        // or the Saved list (cached copy or placeholder) — whether it exists
        // is the per-relay read's call, not this subscription's.
        currentState.lists.forEach(localList => {
          if (mergedLists.find(l => l.id === localList.id)) return;
          if (
            localList.id === DEFAULT_LIST_ID ||
            localList.pendingSync ||
            localList.localOnly ||
            lastPublishedAt.has(publishedKey(pubkey, localList.id))
          ) {
            mergedLists.push(localList);
          }
        });

        // Save all to offline storage (never the unpublished placeholder)
        for (const list of mergedLists) {
          if (!list.localOnly) await offlineStorage.saveCookbook(list, pubkey, !list.pendingSync);
        }
        if (!stillCurrent(gen, pubkey)) {
          finish();
          return;
        }

        // Re-sort after merge
        mergedLists.sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          return b.createdAt - a.createdAt;
        });

        const pendingOps = await offlineStorage.getPendingOperations();

        set({
          lists: mergedLists,
          loading: false,
          initialized: true,
          error: null,
          syncStatus: pendingOps.length > 0 ? 'pending' : 'synced',
          pendingOperations: pendingOps.length
        });

        // Process any pending sync operations
        if (pendingOps.length > 0) {
          syncPendingChanges();
        }

        finish();
      });
    });
  }

  return {
    subscribe,
    update, // Expose update method for direct state updates
    set,    // Expose set method for direct state updates
    
    /**
     * Load all cookbook lists for the current user
     * OFFLINE-FIRST: Loads from IndexedDB first, then refreshes from Nostr
     */
    async load(): Promise<void> {
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!pubkey || !ndkInstance) {
        update(s => ({ ...s, error: 'Not logged in', loading: false }));
        return;
      }
      ensureAccount(pubkey);
      const gen = generation;

      update(s => ({ ...s, loading: true, error: null }));

      // STEP 1: Load from IndexedDB first (instant)
      let hasOfflineData = false;
      try {
        const offlineCookbooks = await offlineStorage.getAllCookbooks(pubkey);
        // A sign-out or account switch happened while reading: not theirs.
        if (!stillCurrent(gen, pubkey)) return;

        if (offlineCookbooks.length > 0) {
          hasOfflineData = true;
          console.log(`[CookbookStore] Loaded ${offlineCookbooks.length} cookbooks from offline storage`);
          
          // Deserialize the cookbooks (rebuild NDKEvent objects)
          const lists = offlineCookbooks.map(oc => deserializeCookbook(oc, ndkInstance));
          
          // Sort: default list first, then by most recent
          lists.sort((a, b) => {
            if (a.isDefault) return -1;
            if (b.isDefault) return 1;
            return b.createdAt - a.createdAt;
          });

          const pendingOps = await offlineStorage.getPendingOperations();
          if (!stillCurrent(gen, pubkey)) return;

          // A list already in the store with a newer event (e.g. a save that
          // finished while IndexedDB was being read) beats the cached copy.
          const inStore = get({ subscribe }).lists;
          const cachedIds = new Set(lists.map(l => l.id));
          const mergedCached = [
            ...lists.map(cached => {
              const current = inStore.find(l => l.id === cached.id);
              return current &&
                !current.localOnly &&
                (current.event?.created_at ?? 0) > (cached.event?.created_at ?? 0)
                ? current
                : cached;
            }),
            ...inStore.filter(l => !cachedIds.has(l.id))
          ];

          update(s => ({
            ...s,
            lists: mergedCached,
            loading: false,
            initialized: true,
            syncStatus: pendingOps.length > 0 ? 'pending' : 'synced',
            pendingOperations: pendingOps.length
          }));
        }
      } catch (error) {
        console.warn('[CookbookStore] Failed to load from offline storage:', error);
      }

      // STEP 2: If online, refresh from Nostr
      if (isCurrentlyOnline()) {
        if (hasOfflineData) {
          // Warm cache already rendered — reconcile in the background
          // (the EOSE handler's set() updates subscribers when it lands).
          this.refreshFromNostr();
        } else {
          // Cold cache: nothing rendered yet. Await the refresh so consumers
          // never observe initialized:true with an empty, never-fetched list
          // set — that's the My Kitchen "Start Your Kitchen" flash
          // (docs/ndk-readiness-discovery.md §4a).
          await this.refreshFromNostr();
        }
      } else {
        update(s => ({ ...s, syncStatus: 'offline', loading: false, initialized: true }));
      }
    },

    /**
     * load() once per account: concurrent and later callers share it. For
     * components that only need the lists present (save buttons), not a
     * fresh reload.
     */
    async ensureLoaded(): Promise<void> {
      const pubkey = get(userPublickey);
      if (!pubkey) return;
      if (loadedFor === pubkey && storePubkey === pubkey && get({ subscribe }).initialized) return;
      if (inflightLoad?.pubkey === pubkey) return inflightLoad.promise;
      const promise = this.load()
        .then(() => {
          if (get(userPublickey) === pubkey) loadedFor = pubkey;
        })
        .finally(() => {
          if (inflightLoad?.promise === promise) inflightLoad = null;
        });
      inflightLoad = { pubkey, promise };
      return promise;
    },

    /**
     * Refresh cookbook data from Nostr relays.
     * Single-flight: concurrent calls await the same in-flight refresh.
     */
    async refreshFromNostr(): Promise<void> {
      if (inflightRefresh) return inflightRefresh;
      const refresh = doRefreshFromNostr().finally(() => {
        if (inflightRefresh === refresh) inflightRefresh = null;
      });
      inflightRefresh = refresh;
      return refresh;
    },

    /**
     * Create a new cookbook list
     */
    async createList(title: string, summary?: string, image?: string): Promise<string | null> {
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!pubkey || !ndkInstance) return null;

      const identifier = title.toLowerCase().replaceAll(' ', '-').replaceAll(/[^a-z0-9-]/g, '');
      
      const naddr = nip19.naddrEncode({
        identifier,
        kind: 30001,
        pubkey
      });

      // Create local event placeholder
      const event = new NDKEvent(ndkInstance);
      event.kind = 30001;
      event.tags = [
        ['d', identifier],
        ['title', title],
        ['t', RECIPE_TAG_PREFIX_NEW]
      ];
      if (summary) event.tags.push(['summary', summary]);
      if (image) event.tags.push(['image', image]);

      const newList: CookbookList = {
        id: identifier,
        naddr,
        title,
        summary,
        image,
        recipeCount: 0,
        recipes: [],
        createdAt: Math.floor(Date.now() / 1000),
        isDefault: false,
        event,
        pendingSync: !isCurrentlyOnline()
      };

      // Add to local state immediately
      update(s => ({
        ...s,
        lists: [newList, ...s.lists]
      }));

      // Persist locally
      await persistLocally(newList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          stampCreatedAt(event, undefined, pubkey, identifier);
          await event.publish(await outboxRelaySet(event, 'list'));
          
          // Mark as synced
          await offlineStorage.markCookbookSynced(identifier, pubkey);
          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === identifier ? { ...l, pendingSync: false } : l
            )
          }));
        } catch (error) {
          console.error('[CookbookStore] Failed to publish new list:', error);
          // Queue for later sync
          await offlineStorage.queueOperation('create_list', identifier, {
            identifier, title, summary, image
          });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        // Queue for sync when online
        await offlineStorage.queueOperation('create_list', identifier, {
          identifier, title, summary, image
        });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return naddr;
    },

    /**
     * Ensure the default "Saved" list exists IN THE STORE.
     *
     * Returns the real list when the store has it (fetched or restored from
     * IndexedDB) or the per-relay read finds it. Otherwise, only when that
     * read PROVED absence (listAbsenceProven), returns an on-screen
     * placeholder that is never published, persisted, or used as an edit
     * base: the list is created on relays only by the first save, as ONE
     * event that already holds the recipe, after editDefaultList's quorum
     * read. Returns null when absence couldn't be proven.
     */
    async ensureDefaultList(): Promise<CookbookList | null> {
      const findDefault = () => get({ subscribe }).lists.find(l => l.isDefault);

      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      if (!pubkey || !ndkInstance) return null;
      ensureAccount(pubkey);

      const existingDefault = findDefault();
      if (existingDefault) return existingDefault;

      const gen = generation;
      await readSavedList(pubkey);
      if (!stillCurrent(gen, pubkey)) return null;
      const fetchedDefault = findDefault();
      if (fetchedDefault) return fetchedDefault;

      if (!savedAbsenceProven) {
        console.warn('[CookbookStore] No Saved list placeholder: absence not proven by the relays');
        return null;
      }

      const event = new NDKEvent(ndkInstance);
      event.kind = 30001;
      event.pubkey = pubkey;
      event.tags = [
        ['d', DEFAULT_LIST_ID],
        ['title', DEFAULT_LIST_TITLE]
      ];

      const placeholder: CookbookList = {
        id: DEFAULT_LIST_ID,
        naddr: nip19.naddrEncode({ identifier: DEFAULT_LIST_ID, kind: 30001, pubkey }),
        title: DEFAULT_LIST_TITLE,
        image: undefined,
        recipeCount: 0,
        recipes: [],
        createdAt: nowSeconds(),
        isDefault: true,
        event,
        pendingSync: false,
        localOnly: true
      };

      update(s => (s.lists.some(l => l.id === DEFAULT_LIST_ID) ? s : { ...s, lists: [placeholder, ...s.lists] }));
      return findDefault() || placeholder;
    },

    /**
     * The member's own Saved list for display (see SavedListView). Never
     * depends on the write quorum: the best available copy is shown
     * (relays, else this device's), an empty list only when the relays
     * proved there is none, and otherwise 'unavailable'.
     */
    async resolveSavedList(): Promise<SavedListView> {
      const pubkey = get(userPublickey);
      if (!pubkey || !get(ndk)) return { status: 'unavailable' };
      ensureAccount(pubkey);
      await this.ensureLoaded();
      const gen = generation;
      const outcome = await readSavedList(pubkey);
      if (!stillCurrent(gen, pubkey)) return { status: 'unavailable' };

      const list = get({ subscribe }).lists.find(l => l.id === DEFAULT_LIST_ID && !l.localOnly);
      if (list) {
        const confirmed =
          outcome === 'found' || lastPublishedAt.has(publishedKey(pubkey, DEFAULT_LIST_ID));
        return { status: 'found', list, confirmed };
      }
      if (outcome === 'absent') {
        const placeholder = await this.ensureDefaultList();
        if (placeholder?.localOnly) return { status: 'absent', list: placeholder };
        if (placeholder) return { status: 'found', list: placeholder, confirmed: true };
      }
      return { status: 'unavailable' };
    },

    /**
     * Save a recipe to the default "Saved" list (the one-tap bookmark —
     * SaveButton, signed in or resuming after sign-in). Never unsaves.
     */
    async saveToDefaultList(recipeEvent: NDKEvent): Promise<SavedListResult> {
      return editDefaultList({ add: [aTagOf(recipeEvent)] });
    },

    /** Remove a recipe from the default "Saved" list. */
    async removeFromDefaultList(recipeATag: string): Promise<SavedListResult> {
      return editDefaultList({ remove: [recipeATag] });
    },

    /**
     * Any other change to the Saved list (My Kitchen's list page: details,
     * cover, Manage Recipes order/removals) — through the same guarded edit.
     */
    async editSavedList(change: SavedListChange): Promise<SavedListResult> {
      return editDefaultList(change);
    },

    /**
     * Add a recipe to a list (quick save to default, or specific list)
     */
    async addRecipeToList(
      listId: string,
      recipeEvent: NDKEvent
    ): Promise<boolean> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (listId === DEFAULT_LIST_ID) {
        return (await editDefaultList({ add: [aTagOf(recipeEvent)] })).ok;
      }
      if (!list || !pubkey || !ndkInstance) return false;

      const aTag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`;
      
      // Check if already in list
      if (list.recipes.includes(aTag)) return true;

      // Update local state immediately (optimistic update)
      const isFirstRecipe = list.recipes.length === 0;
      const updatedList: CookbookList = {
        ...list,
        recipes: [...list.recipes, aTag],
        recipeCount: list.recipeCount + 1,
        coverRecipeId: isFirstRecipe && !list.coverRecipeId ? aTag : list.coverRecipeId,
        pendingSync: true
      };

      update(s => ({
        ...s,
        lists: s.lists.map(l => l.id === listId ? updatedList : l)
      }));

      // Persist locally
      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          // Create updated event
          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;
          
          const tagsToKeep = ['d', 'title', 'summary', 'image', 't', 'cover'];
          list.event.tags.forEach(tag => {
            if (tagsToKeep.includes(tag[0])) {
              event.tags.push([...tag]);
            }
          });
          
          if (isFirstRecipe && !list.coverRecipeId) {
            event.tags.push(['cover', aTag]);
          } else if (list.coverRecipeId) {
            event.tags.push(['cover', list.coverRecipeId]);
          }
          
          list.recipes.forEach(r => event.tags.push(['a', r]));
          event.tags.push(['a', aTag]);

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          stampCreatedAt(event, list, pubkey, listId);
          await event.publish(await outboxRelaySet(event, 'list'));

          // Update with synced event
          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error) {
          console.error('[CookbookStore] Failed to publish add recipe:', error);
          await offlineStorage.queueOperation('add_recipe', listId, { aTag });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        await offlineStorage.queueOperation('add_recipe', listId, { aTag });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return true;
    },

    /**
     * Remove a recipe from a list
     */
    async removeRecipeFromList(
      listId: string,
      recipeATag: string
    ): Promise<boolean> {
      if (listId === DEFAULT_LIST_ID) {
        return (await editDefaultList({ remove: [recipeATag] })).ok;
      }
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!list || !pubkey || !ndkInstance) return false;

      const remainingRecipes = list.recipes.filter(r => r !== recipeATag);
      const wasCover = list.coverRecipeId === recipeATag;
      
      const updatedList: CookbookList = {
        ...list,
        recipes: remainingRecipes,
        recipeCount: Math.max(0, list.recipeCount - 1),
        coverRecipeId: wasCover && remainingRecipes.length > 0 
          ? remainingRecipes[0] 
          : wasCover ? undefined : list.coverRecipeId,
        pendingSync: true
      };

      // Update local state immediately
      update(s => ({
        ...s,
        lists: s.lists.map(l => l.id === listId ? updatedList : l)
      }));

      // Persist locally
      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;
          
          const tagsToKeep = ['d', 'title', 'summary', 'image', 't'];
          list.event.tags.forEach(tag => {
            if (tagsToKeep.includes(tag[0])) {
              event.tags.push([...tag]);
            }
          });
          
          if (wasCover && remainingRecipes.length > 0) {
            event.tags.push(['cover', remainingRecipes[0]]);
          } else if (list.coverRecipeId && !wasCover) {
            event.tags.push(['cover', list.coverRecipeId]);
          }
          
          remainingRecipes.forEach(r => event.tags.push(['a', r]));

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          stampCreatedAt(event, list, pubkey, listId);
          await event.publish(await outboxRelaySet(event, 'list'));

          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error) {
          console.error('[CookbookStore] Failed to publish remove recipe:', error);
          await offlineStorage.queueOperation('remove_recipe', listId, { recipeATag });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        await offlineStorage.queueOperation('remove_recipe', listId, { recipeATag });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return true;
    },

    /**
     * Bulk add many recipes to a list with a single Nostr publish.
     *
     * Returns counts so callers can show "Added X, skipped Y already saved".
     * Skips a-tags already present in the list. Persists locally first
     * so partial failures still leave the cookbook in a usable state.
     */
    async bulkAddRecipesToList(
      listId: string,
      recipeEvents: NDKEvent[]
    ): Promise<{ added: number; skipped: number; failed: number }> {
      // Saved: every requested recipe goes to the guarded edit, and "added"
      // / "skipped" are counted against the list it freshly read — the
      // cached store may be missing recipes or still list removed ones.
      if (listId === DEFAULT_LIST_ID) {
        const requested: string[] = [];
        for (const ev of recipeEvents) {
          if (!ev) continue;
          const dTag = ev.replaceableDTag?.() || ev.tags?.find(t => t[0] === 'd')?.[1] || '';
          if (!dTag || !ev.kind || !ev.pubkey) continue;
          const aTag = `${ev.kind}:${ev.pubkey}:${dTag}`;
          if (!requested.includes(aTag)) requested.push(aTag);
        }
        if (requested.length === 0) return { added: 0, skipped: 0, failed: 0 };
        const result = await editDefaultList({ add: requested });
        return result.ok
          ? { added: result.added, skipped: requested.length - result.added, failed: 0 }
          : { added: 0, skipped: 0, failed: requested.length };
      }

      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);

      if (!list || !pubkey || !ndkInstance) {
        return { added: 0, skipped: 0, failed: recipeEvents.length };
      }

      const existing = new Set(list.recipes);
      const toAdd: string[] = [];
      let skipped = 0;
      for (const ev of recipeEvents) {
        if (!ev) continue;
        const dTag = ev.replaceableDTag?.() || ev.tags?.find(t => t[0] === 'd')?.[1] || '';
        if (!dTag || !ev.kind || !ev.pubkey) continue;
        const aTag = `${ev.kind}:${ev.pubkey}:${dTag}`;
        if (existing.has(aTag)) { skipped++; continue; }
        if (toAdd.includes(aTag)) { skipped++; continue; }
        toAdd.push(aTag);
      }

      if (toAdd.length === 0) {
        return { added: 0, skipped, failed: 0 };
      }

      const mergedRecipes = [...list.recipes, ...toAdd];
      const isFirstBatch = list.recipes.length === 0;
      const updatedList: CookbookList = {
        ...list,
        recipes: mergedRecipes,
        recipeCount: mergedRecipes.length,
        coverRecipeId: isFirstBatch && !list.coverRecipeId ? toAdd[0] : list.coverRecipeId,
        pendingSync: true
      };

      update(s => ({
        ...s,
        lists: s.lists.map(l => (l.id === listId ? updatedList : l))
      }));

      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;

          const tagsToKeep = ['d', 'title', 'summary', 'image', 't'];
          list.event.tags.forEach(tag => {
            if (tagsToKeep.includes(tag[0])) {
              event.tags.push([...tag]);
            }
          });

          // Preserve cover (or seed it from first added recipe)
          const coverId = updatedList.coverRecipeId;
          if (coverId) event.tags.push(['cover', coverId]);

          mergedRecipes.forEach(r => event.tags.push(['a', r]));

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          stampCreatedAt(event, list, pubkey, listId);
          await event.publish(await outboxRelaySet(event, 'list'));

          update(s => ({
            ...s,
            lists: s.lists.map(l =>
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error) {
          console.error('[CookbookStore] bulkAddRecipesToList publish failed:', error);
          // Queue each as a separate add_recipe op so retry logic stays simple.
          for (const aTag of toAdd) {
            await offlineStorage.queueOperation('add_recipe', listId, { aTag });
          }
          update(s => ({
            ...s,
            syncStatus: 'pending',
            pendingOperations: s.pendingOperations + toAdd.length
          }));
        }
      } else {
        for (const aTag of toAdd) {
          await offlineStorage.queueOperation('add_recipe', listId, { aTag });
        }
        update(s => ({
          ...s,
          syncStatus: 'pending',
          pendingOperations: s.pendingOperations + toAdd.length
        }));
      }

      return { added: toAdd.length, skipped, failed: 0 };
    },

    /**
     * Quick save to default list (one-tap bookmark)
     */
    async quickSave(recipeEvent: NDKEvent): Promise<boolean> {
      return (await editDefaultList({ add: [aTagOf(recipeEvent)] })).ok;
    },

    /**
     * Check if a recipe is saved in any list
     */
    isRecipeSaved(recipeEvent: NDKEvent): boolean {
      const state = get({ subscribe });
      const aTag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`;
      
      return state.lists.some(list => list.recipes.includes(aTag));
    },

    /**
     * Get lists containing a specific recipe
     */
    getListsContainingRecipe(recipeEvent: NDKEvent): CookbookList[] {
      const state = get({ subscribe });
      const aTag = `${recipeEvent.kind}:${recipeEvent.pubkey}:${recipeEvent.replaceableDTag()}`;
      
      return state.lists.filter(list => list.recipes.includes(aTag));
    },

    /**
     * Set which recipe's image to use as cookbook cover
     */
    async setCoverRecipe(
      listId: string,
      recipeATag: string
    ): Promise<boolean> {
      if (listId === DEFAULT_LIST_ID) {
        const result = await editDefaultList({ cover: recipeATag });
        if (!result.ok) throw new Error(result.message);
        return true;
      }
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!list || !pubkey || !ndkInstance) {
        throw new Error('List not found or not logged in');
      }

      if (!list.recipes.includes(recipeATag)) {
        throw new Error('Recipe not found in this collection');
      }

      const updatedList: CookbookList = {
        ...list,
        coverRecipeId: recipeATag,
        pendingSync: true
      };

      // Update local state immediately
      update(s => ({
        ...s,
        lists: s.lists.map(l => l.id === listId ? updatedList : l)
      }));

      // Persist locally
      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          if (!ndkInstance.signer) {
            throw new Error('Not authenticated. Please sign in again.');
          }

          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;
          
          const metaTags = ['d', 'title', 'summary', 'image', 't'];
          list.event.tags.forEach(tag => {
            if (metaTags.includes(tag[0])) {
              event.tags.push([...tag]);
            }
          });
          
          event.tags.push(['cover', recipeATag]);
          list.recipes.forEach(r => event.tags.push(['a', r]));

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);

          stampCreatedAt(event, list, pubkey, listId);
          if (!event.sig) await event.sign();

          const publishPromise = event.publish(await outboxRelaySet(event, 'list'));
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Publish timeout after 10 seconds')), 10000)
          );
          
          await Promise.race([publishPromise, timeoutPromise]);

          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error: any) {
          console.error('[CookbookStore] Failed to publish cover change:', error);
          await offlineStorage.queueOperation('set_cover', listId, { recipeATag });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
          
          if (!error?.message?.includes('timeout')) {
            throw error;
          }
        }
      } else {
        await offlineStorage.queueOperation('set_cover', listId, { recipeATag });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return true;
    },

    /**
     * Update list metadata (title, summary, image)
     */
    async updateList(
      listId: string, 
      updates: { title?: string; summary?: string; image?: string }
    ): Promise<boolean> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!list || !pubkey || !ndkInstance) return false;

      const updatedList: CookbookList = {
        ...list,
        title: updates.title || list.title,
        summary: updates.summary !== undefined ? updates.summary : list.summary,
        image: updates.image !== undefined ? updates.image : list.image,
        pendingSync: true
      };

      // Update local state immediately
      update(s => ({
        ...s,
        lists: s.lists.map(l => l.id === listId ? updatedList : l)
      }));

      // Persist locally
      await persistLocally(updatedList, pubkey, false);

      if (isCurrentlyOnline()) {
        try {
          const event = new NDKEvent(ndkInstance);
          event.kind = 30001;
          event.tags = [['d', listId]];
          
          event.tags.push(['title', updates.title || list.title]);
          
          if (updates.summary !== undefined) {
            if (updates.summary) event.tags.push(['summary', updates.summary]);
          } else if (list.summary) {
            event.tags.push(['summary', list.summary]);
          }
          
          if (updates.image !== undefined) {
            if (updates.image) event.tags.push(['image', updates.image]);
          } else if (list.image) {
            event.tags.push(['image', list.image]);
          }
          
          if (!list.isDefault) event.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
          if (list.coverRecipeId) event.tags.push(['cover', list.coverRecipeId]);
          
          list.recipes.forEach(r => event.tags.push(['a', r]));

          const { addClientTagToEvent } = await import('$lib/nip89');
          addClientTagToEvent(event);
          stampCreatedAt(event, list, pubkey, listId);
          await event.publish(await outboxRelaySet(event, 'list'));

          update(s => ({
            ...s,
            lists: s.lists.map(l => 
              l.id === listId ? { ...updatedList, event, pendingSync: false } : l
            )
          }));
          await offlineStorage.markCookbookSynced(listId, pubkey);
        } catch (error) {
          console.error('[CookbookStore] Failed to publish list update:', error);
          await offlineStorage.queueOperation('update_list', listId, updates);
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        await offlineStorage.queueOperation('update_list', listId, updates);
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return true;
    },

    /**
     * Delete a list (not the default one)
     */
    async deleteList(listId: string): Promise<boolean> {
      const state = get({ subscribe });
      const list = state.lists.find(l => l.id === listId);
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!list || list.isDefault || !pubkey || !ndkInstance) return false;

      // Remove from local state immediately
      update(s => ({
        ...s,
        lists: s.lists.filter(l => l.id !== listId)
      }));

      // Remove from offline storage
      await offlineStorage.deleteCookbook(listId, pubkey);
      // Clean up any queued sync operations related to this cookbook
      await offlineStorage.deleteCookbookOperations(listId, pubkey);

      if (isCurrentlyOnline()) {
        try {
          const deleteEvent = new NDKEvent(ndkInstance);
          deleteEvent.kind = 5;
          deleteEvent.tags = [
            ['e', list.event.id],
            ['a', `30001:${list.event.pubkey}:${listId}`]
          ];
          await deleteEvent.publish(await outboxRelaySet(deleteEvent, 'list'));
        } catch (error) {
          console.error('[CookbookStore] Failed to publish delete:', error);
          await offlineStorage.queueOperation('delete_list', listId, { eventId: list.event.id });
          update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
        }
      } else {
        await offlineStorage.queueOperation('delete_list', listId, { eventId: list.event.id });
        update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + 1 }));
      }

      return true;
    },

    /**
     * Manually trigger sync of pending changes
     */
    async syncNow(): Promise<void> {
      if (!isCurrentlyOnline()) {
        console.log('[CookbookStore] Cannot sync - offline');
        return;
      }
      await syncPendingChanges();
    },

    /**
     * Get sync status information
     */
    async getSyncStatus(): Promise<{ pending: number; failed: number }> {
      return offlineStorage.getQueueStatus();
    },

    /**
     * Reset store state
     */
    reset() {
      resetState();
      storePubkey = '';
      loadedFor = '';
      inflightLoad = null;
    },

    /** Test seam: the per-relay reader default-list edits use. */
    __setSavedListQueryForTests(query: QueryList | undefined) {
      savedListQuery = query;
    }
  };
}

/**
 * Convert an NDKEvent to a CookbookList
 */
function eventToList(event: NDKEvent, userPubkey: string): CookbookList | null {
  const dTag = event.tags.find(t => t[0] === 'd')?.[1];
  if (!dTag) return null;

  const title = event.tags.find(t => t[0] === 'title')?.[1] || dTag;
  const summary = event.tags.find(t => t[0] === 'summary')?.[1];
  const imageTag = event.tags.find(t => t[0] === 'image')?.[1];
  const coverRecipeId = event.tags.find(t => t[0] === 'cover')?.[1];
  const recipes = event.tags
    .filter(t => t[0] === 'a')
    .map(t => t[1])
    .filter(a => !isHiddenRecipeATag(a));
  const isDefault = dTag === DEFAULT_LIST_ID;
  
  const image = imageTag;

  const naddr = nip19.naddrEncode({
    identifier: dTag,
    kind: 30001,
    pubkey: userPubkey
  });

  return {
    id: dTag,
    naddr,
    title: isDefault ? DEFAULT_LIST_TITLE : title,
    summary,
    image,
    coverRecipeId,
    recipeCount: recipes.length,
    recipes,
    createdAt: event.created_at || 0,
    isDefault,
    event,
    pendingSync: false
  };
}

/**
 * Helper function to get the actual cover image URL from a cookbook list
 */
export async function getCookbookCoverImage(
  list: CookbookList,
  ndkInstance: any,
  forceRefresh: boolean = false
): Promise<string | undefined> {
  if (list.coverRecipeId) {
    const parsed = parseATag(list.coverRecipeId);
    if (parsed) {
      const { kind, pubkey, identifier } = parsed;
      try {
        const recipeEvent = await ndkInstance.fetchEvent({
          kinds: [Number(kind)],
          '#d': [identifier],
          authors: [pubkey]
        }, { groupable: false });
        
        if (recipeEvent) {
          const image = recipeEvent.tags.find((t: string[]) => t[0] === 'image')?.[1];
          if (image) {
            return forceRefresh ? `${image}?t=${Date.now()}` : image;
          }
        }
      } catch (error) {
        console.warn('Failed to fetch cover recipe:', error);
      }
    }
  }
  
  if (list.recipes.length > 0) {
    const firstRecipeATag = list.recipes[0];
    const parsed = parseATag(firstRecipeATag);
    if (parsed) {
      const { kind, pubkey, identifier } = parsed;
      try {
        const recipeEvent = await ndkInstance.fetchEvent({
          kinds: [Number(kind)],
          '#d': [identifier],
          authors: [pubkey]
        });
        if (recipeEvent) {
          const image = recipeEvent.tags.find((t: string[]) => t[0] === 'image')?.[1];
          if (image) {
            return forceRefresh ? `${image}?t=${Date.now()}` : image;
          }
        }
      } catch (error) {
        console.warn('Failed to fetch first recipe:', error);
      }
    }
  }
  
  if (list.image) {
    return forceRefresh ? `${list.image}?t=${Date.now()}` : list.image;
  }
  
  return undefined;
}

// Export singleton store
export const cookbookStore = createCookbookStore();

// Derived stores for convenience
export const cookbookLists = derived(cookbookStore, $store => $store.lists);
export const cookbookLoading = derived(cookbookStore, $store => $store.loading);
export const cookbookSyncStatus = derived(cookbookStore, $store => $store.syncStatus);
export const cookbookPendingOps = derived(cookbookStore, $store => $store.pendingOperations);
export const defaultCookbookList = derived(cookbookStore, $store => 
  $store.lists.find(l => l.isDefault)
);
