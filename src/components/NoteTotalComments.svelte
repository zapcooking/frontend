<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CommentIcon from 'phosphor-svelte/lib/ChatTeardropText';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';

  export let event: NDKEvent;

  const store = getEngagementStore(event.id);

  onMount(() => {
    // Always fetch engagement data - fetchEngagement will check cache freshness
    // Batch fetch may be in progress, but individual fetch ensures counts load
    fetchEngagement($ndk, event.id, $userPublickey);
  });

  // TEMP-INSTRUMENT fingerprint-5 — feed comment double-count investigation.
  // One log per reactive tick per mounted instance. Multiple lines for the
  // same event.id slice = multiple NoteTotalComments instances for the same
  // root event (F5-C fingerprint).
  $: console.log('[NTC-RENDER] event:', event.id.slice(0, 8), 'count:', $store?.comments?.count);
</script>

<button
  class="flex items-center gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
  style="color: var(--color-text-primary)"
  on:click={() => {
    // Find the FeedComments container for this event and trigger its toggle.
    // FeedComments.svelte roots render with class="inline-comments" + data-event-id;
    // it listens for a 'toggleComments' CustomEvent in its onMount.
    const feedCommentsEl = document
      .querySelector(`[data-event-id="${event.id}"]`)
      ?.closest('.inline-comments');
    if (feedCommentsEl) {
      feedCommentsEl.dispatchEvent(new CustomEvent('toggleComments'));
    }
  }}
  title="View comments"
>
  <CommentIcon size={24} class="text-caption" />
  <span class="text-caption">
    {#if $store.loading}<span class="opacity-0">0</span>{:else}{$store.comments.count}{/if}
  </span>
</button>
