<script lang="ts">
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import Comment from './Comment.svelte';
  import ReplyComposer from './comments/ReplyComposer.svelte';
  import { onDestroy } from 'svelte';
  import { writable, type Readable } from 'svelte/store';
  import {
    createCommentSubscription,
    type CommentSubscription
  } from '$lib/comments/subscription';

  export let event: NDKEvent;
  let sub: CommentSubscription | null = null;

  // Create subscription once ndk is ready. `sub` is nulled in onDestroy so
  // reconnection paths (if $ndk ever becomes null → non-null) re-subscribe.
  let events: Readable<NDKEvent[]> = writable([]);
  $: if ($ndk && !sub) {
    sub = createCommentSubscription($ndk, event, {
      closeOnEose: false,
      applyMuteFilter: false
    });
    events = sub.events;
  }

  onDestroy(() => {
    sub?.stop();
    sub = null;
  });

  // Refresh hook passed to child Comment components. No-op: the subscription
  // stays open and automatically delivers new events (including replies posted
  // from within a Comment's inline composer).
  function refresh() {
    // intentionally empty
  }

  function handlePosted(posted: NDKEvent) {
    // Optimistic add — recipe comments want the new entry visible immediately
    // rather than waiting for the subscription round-trip.
    sub?.addLocal(posted);
  }
</script>

<div id="comments-section" class="space-y-6">
  <h2 class="text-2xl font-bold">Comments</h2>

  <!-- Comments List - flat with embedded parent quotes -->
  <div class="comments-list">
    {#if $events.length === 0}
      <p class="text-caption">No comments yet. Be the first to comment!</p>
    {:else}
      {#each $events as comment (comment.id)}
        <Comment event={comment} allReplies={$events} {refresh} rootEvent={event} />
      {/each}
    {/if}
  </div>

  <!-- Add Comment Form -->
  <div class="space-y-3 pt-4 border-t">
    <h3 class="text-lg font-semibold">Add a comment</h3>
    {#if $ndk?.signer}
      <ReplyComposer
        parentEvent={event}
        placeholder="Share your thoughts..."
        submitLabel="Post Comment"
        signingStrategy="explicit-with-timeout"
        onErrorStrategy="alert"
        onPosted={handlePosted}
      >
        <Button
          slot="submit"
          let:submit
          let:disabled
          on:click={(e) => {
            e.preventDefault?.();
            submit();
          }}
          {disabled}
        >
          Post Comment
        </Button>
      </ReplyComposer>
    {:else}
      <p class="text-sm text-caption">Sign in to comment.</p>
      <a href="/login" class="text-sm underline hover:opacity-80">Sign in</a>
    {/if}
  </div>
</div>

<style>
  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
