/**
 * Comment Subscription Factory
 *
 * Wraps `ndk.subscribe(createCommentFilter(root), ...)` with:
 *  - deduplication by event id
 *  - chronological sorting (ascending by `created_at`)
 *  - optional mute-filter that reacts live to mute-list changes
 *  - idempotent cleanup
 *
 * Design principle: the factory owns its own "subscribed" state. Callers
 * hold the returned reference and check `!sub` before creating a new one.
 * Nulling the reference in `onDestroy` is how reconnection re-subscribes
 * — no external flag to forget to reset.
 *
 * Usage:
 *   let sub: CommentSubscription | null = null;
 *
 *   $: if ($ndk && !sub) {
 *     sub = createCommentSubscription($ndk, event, { applyMuteFilter: true });
 *   }
 *
 *   onDestroy(() => {
 *     sub?.stop();
 *     sub = null;
 *   });
 *
 *   // Template reads:
 *   //   {#each $sub.events as comment (comment.id)}...{/each}
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import { writable, derived, type Readable, type Writable } from 'svelte/store';
import { mutedPubkeys } from '$lib/muteListStore';
import { createCommentFilter } from '$lib/commentFilters';

export interface CommentSubscriptionOptions {
  /**
   * If true, stop the subscription after the initial EOSE. Default false
   * (live stream — new comments arriving after EOSE continue to be delivered).
   */
  closeOnEose?: boolean;

  /**
   * If true, events from pubkeys in $mutedPubkeys are filtered out of the
   * `events` store reactively (re-evaluated whenever the mute list changes).
   * If false, all events pass through. Default false.
   */
  applyMuteFilter?: boolean;
}

export interface CommentSubscription {
  /**
   * Reactive list of deduplicated comment events, sorted chronologically
   * ascending by `created_at`. Reflects the current mute list when
   * `applyMuteFilter` was enabled at creation time.
   */
  readonly events: Readable<NDKEvent[]>;

  /**
   * Whether the initial EOSE (end-of-stored-events) signal has arrived.
   * Useful for distinguishing "loading" from "empty thread."
   */
  readonly eosed: Readable<boolean>;

  /**
   * Add an event to the local store immediately (optimistic UI). Deduped
   * against subsequent subscription arrivals by event id. Safe to call
   * with an event that later arrives via relay — only the first add wins.
   */
  addLocal(event: NDKEvent): void;

  /**
   * Stop the NDK subscription and release resources. Idempotent.
   */
  stop(): void;
}

function sortChronological(events: NDKEvent[]): NDKEvent[] {
  return [...events].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
}

export function createCommentSubscription(
  ndk: NDK,
  root: NDKEvent,
  options: CommentSubscriptionOptions = {}
): CommentSubscription {
  const closeOnEose = options.closeOnEose ?? false;
  const applyMuteFilter = options.applyMuteFilter ?? false;

  const rawEvents: Writable<NDKEvent[]> = writable([]);
  const eosedStore: Writable<boolean> = writable(false);
  const processedIds = new Set<string>();
  let stopped = false;

  const filter = createCommentFilter(root);
  const subscription: NDKSubscription = ndk.subscribe(filter, { closeOnEose });

  // Buffer arrivals so a busy thread's initial EOSE burst (or a burst of
  // realtime replies) applies as ONE store update + sort instead of a
  // growing-array copy + sort per event.
  const BUFFER_FLUSH_MS = 200;
  const pendingEvents: NDKEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushPending() {
    flushTimer = null;
    if (pendingEvents.length === 0) return;
    const batch = pendingEvents.splice(0, pendingEvents.length);
    rawEvents.update((list) => sortChronological([...list, ...batch]));
  }

  subscription.on('event', (ev: NDKEvent) => {
    if (processedIds.has(ev.id)) return;
    processedIds.add(ev.id);
    pendingEvents.push(ev);
    if (flushTimer === null) {
      flushTimer = setTimeout(flushPending, BUFFER_FLUSH_MS);
    }
  });

  subscription.on('eose', () => {
    // Apply everything that arrived during the initial burst before
    // flagging EOSE, so "eosed" implies the full history is in the store.
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushPending();
    }
    eosedStore.set(true);
  });

  const events: Readable<NDKEvent[]> = applyMuteFilter
    ? derived([rawEvents, mutedPubkeys], ([$raw, $muted]) =>
        $raw.filter((e) => {
          const authorKey = e.author?.hexpubkey || e.pubkey;
          return !authorKey || !$muted.has(authorKey);
        })
      )
    : { subscribe: rawEvents.subscribe };

  function addLocal(ev: NDKEvent): void {
    if (!ev.id || processedIds.has(ev.id)) return;
    processedIds.add(ev.id);
    // Optimistic UI: applied immediately rather than buffered.
    rawEvents.update((list) => sortChronological([...list, ev]));
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    try {
      subscription.stop();
    } catch {
      // NDK subscriptions can throw on repeated stop; swallow.
    }
    // Don't drop events that were still queued for a flush.
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushPending();
    }
  }

  return {
    events,
    eosed: { subscribe: eosedStore.subscribe },
    addLocal,
    stop
  };
}
