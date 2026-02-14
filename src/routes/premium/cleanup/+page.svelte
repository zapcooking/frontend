<script lang="ts">
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { NDKEvent as NDKEventClass } from '@nostr-dev-kit/ndk';
  import { onMount, onDestroy } from 'svelte';
  import { GATED_RECIPE_KIND } from '$lib/consts';
  import { goto } from '$app/navigation';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import WarningIcon from 'phosphor-svelte/lib/Warning';

  let events: NDKEvent[] = [];
  let loaded = false;
  let subscription: NDKSubscription | null = null;
  let deletingIds = new Set<string>();
  let deletedIds = new Set<string>();
  let deleteAllInProgress = false;
  let statusMessage = '';

  // Today at midnight (UTC) — events before this are "old"
  const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);

  $: oldEvents = events
    .filter(e => (e.created_at || 0) < todayStart)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  $: newEvents = events
    .filter(e => (e.created_at || 0) >= todayStart)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  function formatDate(ts: number): string {
    return new Date(ts * 1000).toLocaleString();
  }

  function getTitle(event: NDKEvent): string {
    return event.tagValue('title') || event.tagValue('d') || 'Untitled';
  }

  function getDTag(event: NDKEvent): string {
    return event.tagValue('d') || '';
  }

  onMount(() => {
    if (!$userPublickey) {
      goto('/login');
      return;
    }
    fetchEvents();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
  });

  function fetchEvents() {
    if (!$ndk) return;

    if (subscription) {
      subscription.stop();
    }

    events = [];
    loaded = false;

    const filter: NDKFilter = {
      kinds: [GATED_RECIPE_KIND as number],
      authors: [$userPublickey],
      limit: 200
    };

    subscription = $ndk.subscribe(filter);

    subscription.on('event', (event: NDKEvent) => {
      if (!events.find(e => e.id === event.id)) {
        events = [...events, event];
      }
    });

    subscription.on('eose', () => {
      loaded = true;
    });

    setTimeout(() => {
      if (!loaded) loaded = true;
    }, 8000);
  }

  async function deleteEvent(event: NDKEvent) {
    if (deletingIds.has(event.id) || deletedIds.has(event.id)) return;

    deletingIds = new Set([...deletingIds, event.id]);
    const dTag = getDTag(event);

    try {
      // 1. Publish a replacement with empty content (addressable events)
      const replaceEvent = new NDKEventClass($ndk);
      replaceEvent.kind = GATED_RECIPE_KIND;
      replaceEvent.content = '';
      if (dTag) {
        replaceEvent.tags.push(['d', dTag]);
      }
      replaceEvent.tags.push(['deleted', 'true']);
      replaceEvent.tags.push(['title', '[Deleted]']);
      await replaceEvent.publish();

      // 2. Publish a kind 5 deletion request
      const deletionRequest = new NDKEventClass($ndk);
      deletionRequest.kind = 5;
      deletionRequest.content = 'Deleted old gated recipe';
      deletionRequest.tags.push(['e', event.id]);
      if (dTag) {
        deletionRequest.tags.push(['a', `${GATED_RECIPE_KIND}:${event.pubkey}:${dTag}`]);
      }
      deletionRequest.tags.push(['k', String(GATED_RECIPE_KIND)]);
      await deletionRequest.publish();

      deletedIds = new Set([...deletedIds, event.id]);
    } catch (err) {
      console.error('Failed to delete event:', event.id, err);
      statusMessage = `Failed to delete "${getTitle(event)}": ${err}`;
    } finally {
      deletingIds = new Set([...deletingIds].filter(id => id !== event.id));
    }
  }

  async function deleteAllOld() {
    if (deleteAllInProgress || oldEvents.length === 0) return;
    deleteAllInProgress = true;
    statusMessage = `Deleting ${oldEvents.length} old events...`;

    let deleted = 0;
    let failed = 0;

    for (const event of oldEvents) {
      if (deletedIds.has(event.id)) {
        deleted++;
        continue;
      }
      try {
        await deleteEvent(event);
        deleted++;
        statusMessage = `Deleted ${deleted}/${oldEvents.length}...`;
      } catch {
        failed++;
      }
    }

    statusMessage = `Done! Deleted ${deleted} events${failed > 0 ? `, ${failed} failed` : ''}.`;
    deleteAllInProgress = false;
  }
</script>

<svelte:head>
  <title>Cleanup Gated Recipes - zap.cooking</title>
</svelte:head>

<div class="flex flex-col gap-6 max-w-3xl mx-auto p-4">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold" style="color: var(--color-text-primary)">Cleanup Kind {GATED_RECIPE_KIND} Events</h1>
      <p class="text-sm" style="color: var(--color-text-secondary)">
        Delete old gated recipe events from relays (before today)
      </p>
    </div>
    <a href="/premium" class="text-sm text-primary hover:underline">&larr; Back to Premium</a>
  </div>

  {#if !loaded}
    <div class="flex items-center gap-3 py-8">
      <div class="animate-spin rounded-full h-6 w-6 border-2 border-amber-500 border-t-transparent"></div>
      <span style="color: var(--color-text-secondary)">Fetching kind {GATED_RECIPE_KIND} events from relays...</span>
    </div>
  {:else}
    <div class="p-3 rounded-lg" style="background: var(--color-input-bg); color: var(--color-text-secondary)">
      Found <strong>{events.length}</strong> total kind {GATED_RECIPE_KIND} events by you.
      <strong>{oldEvents.length}</strong> are from before today.
      <strong>{newEvents.length}</strong> are from today or later.
    </div>

    {#if statusMessage}
      <div class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm" style="color: var(--color-text-primary)">
        {statusMessage}
      </div>
    {/if}

    <!-- Old events (to delete) -->
    {#if oldEvents.length > 0}
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold flex items-center gap-2" style="color: var(--color-text-primary)">
            <WarningIcon size={20} class="text-red-500" />
            Old Events ({oldEvents.length})
          </h2>
          <button
            on:click={deleteAllOld}
            disabled={deleteAllInProgress}
            class="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            <TrashIcon size={16} weight="bold" />
            {deleteAllInProgress ? 'Deleting...' : `Delete All ${oldEvents.length} Old Events`}
          </button>
        </div>

        {#each oldEvents as event (event.id)}
          <div
            class="flex items-center justify-between p-3 rounded-lg border"
            style="background: var(--color-card-bg); border-color: var(--color-input-border)"
            class:opacity-50={deletedIds.has(event.id)}
          >
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="font-medium truncate" style="color: var(--color-text-primary)">
                {getTitle(event)}
              </span>
              <span class="text-xs" style="color: var(--color-text-secondary)">
                {formatDate(event.created_at || 0)} &middot; d={getDTag(event)} &middot; {event.id.substring(0, 12)}...
              </span>
            </div>
            <div class="flex-shrink-0 ml-3">
              {#if deletedIds.has(event.id)}
                <span class="text-green-500 text-sm font-medium">Deleted</span>
              {:else if deletingIds.has(event.id)}
                <div class="animate-spin rounded-full h-5 w-5 border-2 border-red-500 border-t-transparent"></div>
              {:else}
                <button
                  on:click={() => deleteEvent(event)}
                  class="p-2 rounded-lg hover:bg-red-500/10 transition-colors text-red-500"
                  title="Delete this event"
                >
                  <TrashIcon size={18} />
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="py-4 text-center" style="color: var(--color-text-secondary)">
        No old events to delete.
      </div>
    {/if}

    <!-- New events (keep) -->
    {#if newEvents.length > 0}
      <div class="flex flex-col gap-3">
        <h2 class="text-lg font-semibold" style="color: var(--color-text-primary)">
          Today's Events ({newEvents.length}) — Keeping
        </h2>

        {#each newEvents as event (event.id)}
          <div
            class="flex items-center justify-between p-3 rounded-lg border"
            style="background: var(--color-card-bg); border-color: var(--color-input-border)"
          >
            <div class="flex flex-col gap-1 min-w-0 flex-1">
              <span class="font-medium truncate" style="color: var(--color-text-primary)">
                {getTitle(event)}
              </span>
              <span class="text-xs" style="color: var(--color-text-secondary)">
                {formatDate(event.created_at || 0)} &middot; d={getDTag(event)} &middot; {event.id.substring(0, 12)}...
              </span>
            </div>
            <span class="text-green-500 text-sm font-medium flex-shrink-0 ml-3">Keep</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
