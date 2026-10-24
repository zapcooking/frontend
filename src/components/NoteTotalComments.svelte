<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  // Rounded bubble with a tail — the iOS bar's bubble.right glyph
  // (ChatCircle reads as a tailless round bubble).
  import CommentIcon from 'phosphor-svelte/lib/Chat';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';
  import { goto } from '$app/navigation';
  import { eventPath } from '$lib/utils/eventUrl';

  export let event: NDKEvent;
  /** When set, the comment button invokes this (opens the reply modal)
   *  instead of toggling the feed's inline thread or navigating. */
  export let onComment: (() => void) | null = null;

  const store = getEngagementStore(event.id);

  onMount(() => {
    // Always fetch engagement data - fetchEngagement will check cache freshness
    // Batch fetch may be in progress, but individual fetch ensures counts load
    fetchEngagement($ndk, event, $userPublickey);
  });

  function handleCommentClick() {
    if (onComment) {
      onComment();
      return;
    }
    // In the feed, FeedComments.svelte renders with class="inline-comments" +
    // data-event-id and listens for 'toggleComments' — use that when available.
    const feedCommentsEl = document
      .querySelector(`[data-event-id="${event.id}"]`)
      ?.closest('.inline-comments');
    if (feedCommentsEl) {
      feedCommentsEl.dispatchEvent(new CustomEvent('toggleComments'));
      return;
    }
    // Anywhere else (thread page, profile page), navigate to the note thread.
    goto(eventPath(event));
  }
</script>

<button
  class="flex items-center gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
  style="color: var(--color-text-primary)"
  on:click={handleCommentClick}
  title="View comments"
>
  <CommentIcon size={20} class="text-caption" />
  <span class="text-caption">
    {#if $store.loading}<span class="opacity-0">0</span>{:else}{$store.comments.count}{/if}
  </span>
</button>
