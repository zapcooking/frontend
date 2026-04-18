<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import CommentCard from './comments/CommentCard.svelte';
  import ReplyComposer from './comments/ReplyComposer.svelte';
  import { writable, type Readable } from 'svelte/store';
  import {
    createCommentSubscription,
    type CommentSubscription
  } from '$lib/comments/subscription';

  export let event: NDKEvent;
  let sub: CommentSubscription | null = null;
  let showComments = false;

  // Listen for toggle event from NoteTotalComments
  onMount(() => {
    const handleToggleEvent = () => {
      toggleComments();
    };

    const element = document.querySelector(`[data-event-id="${event.id}"]`);
    if (element) {
      element.addEventListener('toggleComments', handleToggleEvent);

      // Cleanup
      return () => {
        element.removeEventListener('toggleComments', handleToggleEvent);
      };
    }
  });

  onDestroy(() => {
    sub?.stop();
    sub = null;
  });

  // Lazy subscription — only when the comments panel is open. `sub` is nulled
  // in onDestroy so reconnect paths re-subscribe correctly.
  let events: Readable<NDKEvent[]> = writable([]);
  $: if ($ndk && !sub && showComments) {
    sub = createCommentSubscription($ndk, event, {
      closeOnEose: false,
      applyMuteFilter: true
    });
    events = sub.events;
  }

  // Refresh hook passed to child FeedComment components. No-op: the
  // subscription stays open and delivers new events automatically.
  function refresh() {
    // intentionally empty
  }

  function toggleComments() {
    showComments = !showComments;
  }
</script>

<div class="inline-comments" data-event-id={event.id}>
  {#if showComments}
    <div class="mt-3 space-y-4 pt-3" style="border-top: 1px solid var(--color-input-border)">
      <!-- Comments List - flat list with embedded parent quotes -->
      <div class="comments-list">
        {#if $events.length === 0}
          <p class="text-sm text-caption">No comments yet. {#if !$userPublickey}<a href="/login?redirect={encodeURIComponent($page.url.pathname)}" class="underline hover:opacity-80">Sign in</a> to comment!{:else}Be the first to comment!{/if}</p>
        {:else}
          {#each $events as comment (comment.id)}
            <CommentCard
              variant="feed"
              event={comment}
              allComments={$events}
              rootEvent={event}
              {refresh}
            />
          {/each}
        {/if}
      </div>

      <!-- Add Comment Form -->
      {#if $userPublickey}
        <div class="space-y-2 pt-2" style="border-top: 1px solid var(--color-input-border)">
          <ReplyComposer
            parentEvent={event}
            placeholder="Add a comment..."
            submitLabel="Post Comment"
            signingStrategy="implicit"
            onErrorStrategy="silent"
            compact
          />
        </div>
      {:else}
        <div
          class="text-sm text-caption pt-2"
          style="border-top: 1px solid var(--color-input-border)"
        >
          <a href="/login" class="text-primary hover:underline">Log in</a> to comment
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Comments list - flat layout with spacing */
  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
