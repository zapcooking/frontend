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
import { parseCoordinate } from '$lib/coordinate';
import { recordNudgeMoment } from '$lib/accountNudge';
import {
  buildSavedListEdit,
  decideSavedListBase,
  LIST_PUBLISH_OK_TIMEOUT_MS,
  listAbsenceProven,
  newestList,
  type ListEvent,
  type SavedListChange
} from '$lib/savedListSafety';
import {
  getListSeen,
  isFreshAccount,
  noteListSeen,
  publishUntilAcked,
  readListFromRelays,
  signWithin,
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
  | {
      ok: false;
      message: string;
      /**
       * The edit was sent but couldn't be confirmed: it may be saved. Offer
       * Refresh, never Retry-as-if-nothing-happened.
       */
      uncertain?: true;
    };

export const SAVED_LIST_UNCONFIRMED_MESSAGE =
  "Couldn't load your Saved list, so nothing was changed. Please try again in a moment.";
export const SAVED_LIST_PUBLISH_FAILED_MESSAGE =
  "Couldn't update your Saved list, so nothing was changed. Please try again.";
export const LIST_UNCONFIRMED_MESSAGE =
  "Couldn't load this collection, so nothing was changed. Please try again in a moment.";
export const LIST_PUBLISH_FAILED_MESSAGE =
  "Couldn't update this collection, so nothing was changed. Please try again.";
export const LIST_NOT_FOUND_MESSAGE =
  "This collection couldn't be found on your relays, so nothing was changed.";
export const LIST_EXISTS_MESSAGE = 'You already have a collection with that name.';
/** A publish went out but no relay confirmed it: never "nothing was changed". */
export const LIST_SAVE_UNCONFIRMED_MESSAGE = "Couldn't confirm the save. Refresh to check.";
export const SIGNER_TIMEOUT_MESSAGE =
  "Your signer didn't respond, so nothing was changed. Please try again.";
export const SIGN_FAILED_MESSAGE = "The change wasn't signed, so nothing was changed.";

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
  // half its relays answered, so "no Saved list at EOSE" can mean "the relay
  // holding it hadn't answered yet" (it did when purplepag.es / nostr.wine,
  // which never hold lists, were in the set). One read per account and
  // generation, shared.
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

  // List edits run one at a time: two quick saves would otherwise both
  // build on the same base and one would drop the other's recipe.
  let listEditQueue: Promise<unknown> = Promise.resolve();

  // Test seam: the per-relay reader used by list edits.
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
    const promise = doReadSavedList(pubkey, gen).catch((error): SavedReadOutcome => {
      console.warn('[CookbookStore] Saved list read failed:', error);
      return 'unknown';
    });
    savedRead = { gen, pubkey, promise };
    // An inconclusive read isn't kept: the next caller asks the relays again.
    promise.then(outcome => {
      if (outcome === 'unknown' && savedRead?.promise === promise) savedRead = null;
    });
    return promise;
  }

  /**
   * Put the default list's newest event into the store and IndexedDB. The
   * IndexedDB copy is best-effort: the list is already in the store, and a
   * full or failing disk must not hide it.
   */
  async function adoptDefaultList(event: NDKEvent, pubkey: string): Promise<void> {
    return adoptList(event, pubkey);
  }

  /** adoptDefaultList for any list: Saved goes first, a custom list keeps its place. */
  async function adoptList(event: NDKEvent, pubkey: string): Promise<void> {
    if (storePubkey !== pubkey || get(userPublickey) !== pubkey) return;
    const list = eventToList(event, pubkey);
    if (!list) return;
    update(s => {
      if (list.id === DEFAULT_LIST_ID) {
        return { ...s, lists: [list, ...s.lists.filter(l => l.id !== DEFAULT_LIST_ID)] };
      }
      const at = s.lists.findIndex(l => l.id === list.id);
      if (at < 0) return { ...s, lists: [list, ...s.lists] };
      const lists = [...s.lists];
      lists[at] = list;
      return { ...s, lists };
    });
    await cacheList(list, pubkey, true);
  }

  /** Copy a list to IndexedDB; a failure is logged, never thrown. */
  async function cacheList(list: CookbookList, pubkey: string, synced: boolean): Promise<void> {
    try {
      await offlineStorage.saveCookbook(list, pubkey, synced);
    } catch (error) {
      console.warn('[CookbookStore] Could not cache list on this device:', list.id, error);
    }
  }

  /**
   * Whether the Saved list `a` should replace `b`: a published copy beats
   * the placeholder, then the newer event wins (a tie keeps `a`).
   */
  function preferDefault(a: CookbookList, b: CookbookList | undefined): boolean {
    if (!b) return true;
    if (a.localOnly !== b.localOnly) return !a.localOnly;
    return (a.event?.created_at ?? 0) >= (b.event?.created_at ?? 0);
  }

  /**
   * The one way a recipe list (Saved or a custom collection) is changed
   * ($lib/savedListSafety has the rules): read it from the relays it lives
   * on, refuse unless the read reaches the quorum, build ONE event on the
   * newest copy — every tag but the recipes kept verbatim — and publish it,
   * to exactly the relays that were read, strictly newer than anything
   * before it. Nothing is published, and the store is untouched, when any
   * step fails. `pubkey` is the account that asked for the edit: it is
   * refused if a different account is signed in by the time it runs.
   *
   * A custom list must exist (an edit never recreates a list it can't
   * find); `create` makes a new one and must find none.
   */
  async function doEditList(
    listId: string,
    change: SavedListChange,
    pubkey: string,
    create?: { title: string }
  ): Promise<SavedListResult> {
    const isDefault = listId === DEFAULT_LIST_ID;
    const unconfirmed = isDefault ? SAVED_LIST_UNCONFIRMED_MESSAGE : LIST_UNCONFIRMED_MESSAGE;
    const publishFailed = isDefault ? SAVED_LIST_PUBLISH_FAILED_MESSAGE : LIST_PUBLISH_FAILED_MESSAGE;
    const ndkInstance = get(ndk);
    if (!pubkey || !ndkInstance) return { ok: false, message: 'Sign in to save recipes.' };
    if (get(userPublickey) !== pubkey) return { ok: false, message: unconfirmed };
    ensureAccount(pubkey);

    const current = get({ subscribe }).lists.find(l => l.id === listId);
    const local = listEventOf(current, pubkey);
    const fresh = isFreshAccount(pubkey);
    let answers: Awaited<ReturnType<typeof readListFromRelays>>['answers'] = [];
    let ownWrite: string[] = [];
    let urls: string[] = [];
    try {
      if (fresh) {
        const { listRelayUrls } = await import('$lib/nip65Routing');
        urls = await listRelayUrls(pubkey);
      } else {
        const read = await readListFromRelays(pubkey, listId, savedListQuery, { early: true });
        if (read.discovery === 'unknown') {
          console.warn("[CookbookStore] List edit refused: couldn't establish the member's write relays", listId);
          return { ok: false, message: unconfirmed };
        }
        ({ answers, ownWrite, urls } = read);
      }
    } catch (error) {
      console.error('[CookbookStore] List read failed:', listId, error);
      return { ok: false, message: unconfirmed };
    }
    const decision = decideSavedListBase({
      answers,
      ownWrite,
      local,
      seen: getListSeen(pubkey, listId),
      fresh
    });
    if (!decision.ok) {
      console.warn('[CookbookStore] List edit refused: read incomplete', listId, answers.map(a => `${a.url}:${a.ok ? 'eose' : 'silent'}`));
      return { ok: false, message: unconfirmed };
    }
    // Signed in as someone else while reading: this base isn't theirs.
    if (get(userPublickey) !== pubkey) return { ok: false, message: unconfirmed };
    if (create && decision.base) return { ok: false, message: LIST_EXISTS_MESSAGE };
    if (!isDefault && !create && !decision.base) return { ok: false, message: LIST_NOT_FOUND_MESSAGE };
    noteListSeen(pubkey, listId, decision.base);

    const k = publishedKey(pubkey, listId);
    const next = buildSavedListEdit(decision.base, change, {
      dTag: listId,
      title: isDefault ? DEFAULT_LIST_TITLE : (create?.title ?? current?.title ?? listId),
      now: nowSeconds(),
      floor: lastPublishedAt.get(k) ?? 0,
      initialTags: isDefault ? [] : [['t', RECIPE_TAG_PREFIX_NEW]]
    });

    if (!next.changed && !create) {
      // Nothing to publish (already saved / already gone) — but show the
      // newest copy the read found.
      if (decision.base?.id) {
        await adoptList(new NDKEvent(ndkInstance, { ...decision.base, kind: 30001, pubkey } as never), pubkey);
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
    // Signed before publishing, within the signer's bound: a remote signer
    // that never answers refuses the edit (and frees the queue) instead of
    // holding it forever. Nothing has gone out yet, so nothing changed.
    const signed = await signWithin(event, ndkInstance.signer);
    if (signed !== 'signed') {
      console.warn('[CookbookStore] List edit refused: signer', signed, listId);
      return { ok: false, message: signed === 'timeout' ? SIGNER_TIMEOUT_MESSAGE : SIGN_FAILED_MESSAGE };
    }
    // Signed as someone else (the signer changed under us): not theirs to publish.
    if (event.pubkey !== pubkey || get(userPublickey) !== pubkey) return { ok: false, message: unconfirmed };
    let relaySet: Awaited<ReturnType<typeof import('$lib/nip65Routing').relaySetForUrls>>;
    try {
      const { relaySetForUrls } = await import('$lib/nip65Routing');
      relaySet = await relaySetForUrls(ndkInstance, urls);
    } catch (error) {
      // Nothing has gone out yet, so nothing changed.
      console.error('[CookbookStore] List publish failed before sending:', listId, error);
      return { ok: false, message: publishFailed };
    }
    try {
      await publishUntilAcked(event, relaySet, LIST_PUBLISH_OK_TIMEOUT_MS);
    } catch (error) {
      // The event went out, but no relay acknowledged it in time: it may
      // well be stored. The next edit must stay strictly newer than it either
      // way; one fresh read decides what to tell the member.
      console.warn('[CookbookStore] List publish unacknowledged, checking the relays:', listId, error);
      lastPublishedAt.set(k, event.created_at!);
      const stored = await findPublishedEdit(pubkey, listId, event, change, next.created_at);
      if (!stored) return { ok: false, uncertain: true, message: LIST_SAVE_UNCONFIRMED_MESSAGE };
      noteListSeen(pubkey, listId, stored);
      await adoptList(
        stored.id === event.id ? event : new NDKEvent(ndkInstance, { ...stored, kind: 30001, pubkey } as never),
        pubkey
      );
      return { ok: true, changed: true, added: next.added };
    }
    lastPublishedAt.set(k, event.created_at!);
    noteListSeen(pubkey, listId, {
      id: event.id,
      created_at: event.created_at!,
      tags: event.tags,
      content: event.content
    });
    await adoptList(event, pubkey);
    return { ok: true, changed: true, added: next.added };
  }

  /**
   * After an unacknowledged publish: the list as the relays now hold it, if
   * it shows the edit landed — our event itself, or a copy at least as new
   * that already contains the change (applying it again changes nothing).
   * Null when no relay shows either, or the read fails.
   */
  async function findPublishedEdit(
    pubkey: string,
    listId: string,
    event: NDKEvent,
    change: SavedListChange,
    createdAt: number
  ): Promise<ListEvent | null> {
    try {
      const read = await readListFromRelays(pubkey, listId, savedListQuery, { early: true });
      const lists = read.answers.map(a => a.list).filter((l): l is ListEvent => !!l);
      const ours = lists.find(l => l.id === event.id);
      if (ours) return ours;
      const newest = newestList(...lists);
      if (!newest || newest.created_at < createdAt) return null;
      const again = buildSavedListEdit(newest, change, {
        dTag: listId,
        title: listId,
        now: createdAt,
        floor: createdAt
      });
      return again.changed ? null : newest;
    } catch (error) {
      console.warn('[CookbookStore] Confirmation read failed:', listId, error);
      return null;
    }
  }

  /** Queue an edit for the account signed in NOW (see doEditList). */
  function editList(
    listId: string,
    change: SavedListChange,
    create?: { title: string }
  ): Promise<SavedListResult> {
    const pubkey = get(userPublickey);
    const run = listEditQueue
      .catch(() => {})
      .then(() => doEditList(listId, change, pubkey, create))
      .then((result) => {
        // The first saved recipe is a natural moment for the account nudge.
        if (result.ok && result.added > 0 && pubkey) recordNudgeMoment(pubkey, 'saved-recipe');
        return result;
      });
    listEditQueue = run.catch(() => {});
    return run;
  }

  function editDefaultList(change: SavedListChange): Promise<SavedListResult> {
    return editList(DEFAULT_LIST_ID, change);
  }

  type OfflineEdit = {
    list: CookbookList;
    ops: { type: SyncOperation['type']; payload: unknown }[];
  } | null;

  /**
   * A change to a list from its own screen. Online: the guarded edit.
   * Offline: `offline` gives the list as it will look (shown at once) and
   * the operations to queue — each replayed later as a guarded edit, never
   * as this local copy. null: nothing to do.
   */
  async function customEditResult(
    listId: string,
    change: SavedListChange,
    offline: (list: CookbookList) => OfflineEdit
  ): Promise<SavedListResult> {
    if (isCurrentlyOnline()) return editList(listId, change);
    const list = get({ subscribe }).lists.find(l => l.id === listId);
    const pubkey = get(userPublickey);
    if (!list || !pubkey) return { ok: false, message: LIST_UNCONFIRMED_MESSAGE };
    const next = offline(list);
    if (!next) return { ok: true, changed: false, added: 0 };
    await queueOffline(next.list, pubkey, next.ops);
    return { ok: true, changed: true, added: 0 };
  }

  async function customEdit(
    listId: string,
    change: SavedListChange,
    offline: (list: CookbookList) => OfflineEdit
  ): Promise<boolean> {
    return (await customEditResult(listId, change, offline)).ok;
  }

  /** Show an offline change and queue its operations for the next connection. */
  async function queueOffline(
    list: CookbookList,
    pubkey: string,
    ops: { type: SyncOperation['type']; payload: unknown }[]
  ): Promise<void> {
    const pending = { ...list, pendingSync: true };
    update(s => ({ ...s, lists: s.lists.map(l => (l.id === list.id ? pending : l)) }));
    await persistLocally(pending, pubkey, false);
    for (const op of ops) await offlineStorage.queueOperation(op.type, list.id, op.payload);
    update(s => ({ ...s, syncStatus: 'pending', pendingOperations: s.pendingOperations + ops.length }));
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
   * Execute a single sync operation against Nostr. A queued change is never
   * replayed from local state: it becomes a fresh guarded edit (doEditList),
   * built on whatever the relays hold now.
   */
  async function executeSyncOperation(
    op: SyncOperation,
    ndkInstance: any,
    pubkey: string
  ): Promise<void> {
    if (op.type === 'delete_list') {
      const deleteEvent = new NDKEvent(ndkInstance);
      deleteEvent.kind = 5;
      deleteEvent.tags = [
        ['e', op.payload.eventId],
        ['a', `30001:${pubkey}:${op.listId}`]
      ];
      await deleteEvent.publish(await outboxRelaySet(deleteEvent, 'list'));
      return;
    }

    // The default list's old queued empty "create" is moot — its first
    // save creates it with the recipe in it.
    if (op.type === 'create_list' && op.listId === DEFAULT_LIST_ID) return;

    const change: SavedListChange | null =
      op.type === 'add_recipe' ? { add: [op.payload.aTag] }
      : op.type === 'remove_recipe' ? { remove: [op.payload.recipeATag] }
      : op.type === 'set_cover' ? { cover: op.payload.recipeATag }
      : op.type === 'update_list' ? { meta: op.payload }
      : op.type === 'create_list' ? { meta: { summary: op.payload.summary, image: op.payload.image } }
      : null;
    if (!change) return;
    const result = await editList(
      op.listId,
      change,
      op.type === 'create_list' ? { title: op.payload.title } : undefined
    );
    // A queued create whose list now exists (an earlier attempt landed) is done.
    if (!result.ok && !(op.type === 'create_list' && result.message === LIST_EXISTS_MESSAGE)) {
      throw new Error(result.message);
    }
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
          if (!list.localOnly) await cacheList(list, pubkey, !list.pendingSync);
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
        if (!stillCurrent(gen, pubkey)) {
          finish();
          return;
        }

        // The per-relay Saved read may have put a newer copy into the store
        // while this merge awaited IndexedDB: keep it, and put it back on
        // disk after the older copy cached above.
        const latestSaved = get({ subscribe }).lists.find(l => l.id === DEFAULT_LIST_ID);
        const mergedSavedAt = mergedLists.findIndex(l => l.id === DEFAULT_LIST_ID);
        const mergedSaved = mergedLists[mergedSavedAt];
        if (
          latestSaved &&
          latestSaved !== mergedSaved &&
          !mergedSaved?.pendingSync &&
          preferDefault(latestSaved, mergedSaved)
        ) {
          if (mergedSavedAt >= 0) mergedLists[mergedSavedAt] = latestSaved;
          else mergedLists.unshift(latestSaved);
          if (!latestSaved.localOnly) void cacheList(latestSaved, pubkey, !latestSaved.pendingSync);
        }

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
     * Create a new cookbook list. Online: a guarded create — the relays must
     * confirm no list has this identifier yet (a list with the same name
     * would otherwise be overwritten), and the first event carries the
     * details. Offline: shown at once and queued; the queued create is the
     * same guarded create when the connection returns. Throws the reason
     * when the create is refused.
     */
    async createList(title: string, summary?: string, image?: string): Promise<string | null> {
      const pubkey = get(userPublickey);
      const ndkInstance = get(ndk);
      
      if (!pubkey || !ndkInstance) return null;

      const identifier = title.toLowerCase().replaceAll(' ', '-').replaceAll(/[^a-z0-9-]/g, '');
      if (!identifier) throw new Error('Please use letters or numbers in the title.');
      if (get({ subscribe }).lists.some(l => l.id === identifier)) throw new Error(LIST_EXISTS_MESSAGE);
      
      const naddr = nip19.naddrEncode({
        identifier,
        kind: 30001,
        pubkey
      });

      if (isCurrentlyOnline()) {
        const result = await editList(identifier, { meta: { summary, image } }, { title });
        if (!result.ok) throw new Error(result.message);
        return naddr;
      }

      // Offline: a local placeholder until the queued create runs.
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
        createdAt: nowSeconds(),
        isDefault: false,
        event,
        pendingSync: true
      };
      update(s => ({ ...s, lists: [newList, ...s.lists] }));
      await queueOffline(newList, pubkey, [{ type: 'create_list', payload: { identifier, title, summary, image } }]);
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
      const savedCopy = () =>
        get({ subscribe }).lists.find(l => l.id === DEFAULT_LIST_ID && !l.localOnly);
      let outcome = await readSavedList(pubkey);
      // A kept 'found' whose list has since left the store: ask the relays
      // again rather than report it unavailable.
      if (outcome === 'found' && !savedCopy() && stillCurrent(gen, pubkey)) {
        outcome = await readSavedList(pubkey, true);
      }
      if (!stillCurrent(gen, pubkey)) return { status: 'unavailable' };

      const list = savedCopy();
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
     * Any change to a list, by id, through the guarded edit (doEditList).
     * My Kitchen's list page uses it for details, cover and Manage Recipes.
     */
    async editList(listId: string, change: SavedListChange): Promise<SavedListResult> {
      return editList(listId, change);
    },

    /**
     * Add a recipe to a list (quick save to default, or specific list)
     */
    async addRecipeToList(
      listId: string,
      recipeEvent: NDKEvent
    ): Promise<boolean> {
      return (await this.addRecipeToListResult(listId, recipeEvent)).ok;
    },

    /** addRecipeToList with the store's message when it refuses (for a toast with Retry). */
    async addRecipeToListResult(listId: string, recipeEvent: NDKEvent): Promise<SavedListResult> {
      const aTag = aTagOf(recipeEvent);
      if (listId === DEFAULT_LIST_ID) return editDefaultList({ add: [aTag] });
      return customEditResult(listId, { add: [aTag] }, list =>
        list.recipes.includes(aTag)
          ? null
          : {
              list: {
                ...list,
                recipes: [...list.recipes, aTag],
                recipeCount: list.recipeCount + 1,
                coverRecipeId: list.recipes.length === 0 && !list.coverRecipeId ? aTag : list.coverRecipeId
              },
              ops: [{ type: 'add_recipe', payload: { aTag } }]
            }
      );
    },

    /**
     * Remove a recipe from a list
     */
    async removeRecipeFromList(
      listId: string,
      recipeATag: string
    ): Promise<boolean> {
      return (await this.removeRecipeFromListResult(listId, recipeATag)).ok;
    },

    /** removeRecipeFromList with the store's message when it refuses. */
    async removeRecipeFromListResult(listId: string, recipeATag: string): Promise<SavedListResult> {
      if (listId === DEFAULT_LIST_ID) return editDefaultList({ remove: [recipeATag] });
      return customEditResult(listId, { remove: [recipeATag] }, list => {
        const remaining = list.recipes.filter(r => r !== recipeATag);
        const wasCover = list.coverRecipeId === recipeATag;
        return {
          list: {
            ...list,
            recipes: remaining,
            recipeCount: remaining.length,
            coverRecipeId: wasCover ? remaining[0] : list.coverRecipeId
          },
          ops: [{ type: 'remove_recipe', payload: { recipeATag } }]
        };
      });
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

      const list = get({ subscribe }).lists.find(l => l.id === listId);
      if (!list || !get(userPublickey) || !get(ndk)) {
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
        if (existing.has(aTag) || toAdd.includes(aTag)) { skipped++; continue; }
        toAdd.push(aTag);
      }
      if (toAdd.length === 0) return { added: 0, skipped, failed: 0 };

      if (!isCurrentlyOnline()) {
        const merged = [...list.recipes, ...toAdd];
        await queueOffline(
          {
            ...list,
            recipes: merged,
            recipeCount: merged.length,
            coverRecipeId: list.recipes.length === 0 && !list.coverRecipeId ? toAdd[0] : list.coverRecipeId
          },
          get(userPublickey),
          toAdd.map(aTag => ({ type: 'add_recipe' as const, payload: { aTag } }))
        );
        return { added: toAdd.length, skipped, failed: 0 };
      }

      // Counted against the list the edit freshly read, as for Saved.
      const result = await editList(listId, { add: toAdd });
      return result.ok
        ? { added: result.added, skipped: skipped + toAdd.length - result.added, failed: 0 }
        : { added: 0, skipped, failed: toAdd.length };
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
      const list = get({ subscribe }).lists.find(l => l.id === listId);
      if (!list || !get(userPublickey) || !get(ndk)) {
        throw new Error('List not found or not logged in');
      }

      if (!list.recipes.includes(recipeATag)) {
        throw new Error('Recipe not found in this collection');
      }

      const result = await customEditResult(listId, { cover: recipeATag }, l => ({
        list: { ...l, coverRecipeId: recipeATag },
        ops: [{ type: 'set_cover', payload: { recipeATag } }]
      }));
      if (!result.ok) throw new Error(result.message);
      return true;
    },

    /**
     * Update list metadata (title, summary, image). `undefined` leaves a
     * field as it is; an empty summary or image removes it. Throws the
     * reason when the edit is refused.
     */
    async updateList(
      listId: string, 
      updates: { title?: string; summary?: string; image?: string }
    ): Promise<boolean> {
      const meta = listId === DEFAULT_LIST_ID ? { ...updates, title: undefined } : updates;
      const result = await customEditResult(listId, { meta }, list => ({
        list: {
          ...list,
          title: (listId !== DEFAULT_LIST_ID && updates.title) || list.title,
          summary: updates.summary !== undefined ? updates.summary || undefined : list.summary,
          image: updates.image !== undefined ? updates.image || undefined : list.image
        },
        ops: [{ type: 'update_list', payload: meta }]
      }));
      if (!result.ok) throw new Error(result.message);
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
    const parsed = parseCoordinate(list.coverRecipeId);
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
    const parsed = parseCoordinate(firstRecipeATag);
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
