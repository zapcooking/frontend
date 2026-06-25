<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import CommentIcon from 'phosphor-svelte/lib/ChatTeardropText';
  import { getEngagementStore, fetchEngagement } from '$lib/engagementCache';
  import { goto } from '$app/navigation';
  import { nip19 } from 'nostr-tools';

  export let event: NDKEvent;

  const store = getEngagementStore(event.id);

  onMount(() => {
    // Always fetch engagement data - fetchEngagement will check cache freshness
    // Batch fetch may be in progress, but individual fetch ensures counts load
    fetchEngagement($ndk, event.id, $userPublickey);
  });

  function handleCommentClick() {
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
    const relayUrl = (event as any).relay?.url ?? (event as any).onRelays?.[0]?.url;
    try {
      goto('/' + nip19.neventEncode({ id: event.id, relays: relayUrl ? [relayUrl] : [], kind: event.kind ?? 1 }));
    } catch {
      goto('/' + nip19.noteEncode(event.id));
    }
  }
</script>

<button
  class="flex items-center gap-1.5 hover:bg-input rounded px-0.5 transition duration-300 cursor-pointer"
  style="color: var(--color-text-primary)"
  on:click={handleCommentClick}
  title="View comments"
>
  <CommentIcon size={24} class="text-caption" />
  <span class="text-caption">
    {#if $store.loading}<span class="opacity-0">0</span>{:else}{$store.comments.count}{/if}
  </span>
</button>
