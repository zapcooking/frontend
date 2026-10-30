<script lang="ts">
  /**
   * CommentThread — unified thread container for comments on a root event.
   *
   * Final consolidation of Task 6: merges the pre-Stage-5 Comments.svelte
   * (recipe context) and FeedComments.svelte (feed context) into one
   * component with a variant prop. All shared infrastructure
   * (subscription, post publishing, card rendering, composer) already
   * lives in /lib/comments and sibling components from earlier stages.
   */
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { requireAuth, signedIn } from '$lib/auth/requireAuth';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { writable, type Readable } from 'svelte/store';
  import CommentCard from './CommentCard.svelte';
  import ReplyComposer from './ReplyComposer.svelte';
  import CustomAvatar from '../CustomAvatar.svelte';
  import {
    createCommentSubscription,
    type CommentSubscription
  } from '$lib/comments/subscription';
  import { isReply } from '$lib/replyContext';

  /**
   * The root event being commented on.
   *  - 'recipe' variant: expected kind 30023 addressable recipe.
   *  - 'feed' variant: expected kind 1 note (or kind 1068 poll).
   */
  export let event: NDKEvent;

  /**
   * Visual + behavioral variant:
   *
   *  - 'recipe': semantic <section> root with h2/h3 headings, eager
   *    subscription on mount, no mute filter, optimistic-add via
   *    onPosted, custom <Button> in the submit slot. No collapse.
   *
   *  - 'feed':   <div class="inline-comments" data-event-id> root
   *    (required by the NoteTotalComments DOM-event bridge),
   *    collapsed by default, lazy subscription opened when the bridge
   *    fires a `toggleComments` CustomEvent, mute filter applied, no
   *    optimistic add, compact composer.
   */
  export let variant: 'recipe' | 'feed';

  let sub: CommentSubscription | null = null;
  let events: Readable<NDKEvent[]> = writable([]);

  // Recipe opens immediately; feed stays collapsed until NoteTotalComments
  // fires the toggle CustomEvent.
  let showComments = variant === 'recipe';

  // Feed-only: NoteTotalComments bridge. The query selector pattern is
  // preserved verbatim from the pre-Stage-5 FeedComments.svelte —
  // NoteTotalComments' click handler uses the same selector + closest()
  // to locate this root and dispatches 'toggleComments' here. Do not
  // migrate the bridge to bind:this / props during this stage; that's a
  // separate scope.
  onMount(() => {
    if (variant !== 'feed') return;
    const handleToggleEvent = () => {
      showComments = !showComments;
    };
    const element = document.querySelector(`[data-event-id="${event.id}"]`);
    if (element) {
      element.addEventListener('toggleComments', handleToggleEvent);
      return () => {
        element.removeEventListener('toggleComments', handleToggleEvent);
      };
    }
  });

  onDestroy(() => {
    sub?.stop();
    sub = null;
  });

  // Recipe: eager (showComments is true from init). Feed: lazy
  // (showComments toggles from the bridge). `sub` nulled in onDestroy
  // so reconnect paths re-subscribe cleanly.
  $: if ($ndk && !sub && showComments) {
    sub = createCommentSubscription($ndk, event, {
      closeOnEose: false,
      applyMuteFilter: variant === 'feed'
    });
    events = sub.events;
  }

  function handlePosted(posted: NDKEvent) {
    // Optimistic add for recipe; feed relies on subscription round-trip.
    if (variant === 'recipe') sub?.addLocal(posted);
  }

  let openReplyCount = 0;
  $: anyReplyOpen = openReplyCount > 0;

  // Sign in over the page; the composer below appears once a session exists.
  const signInToComment = () => requireAuth({ kind: 'reply', reason: 'Sign in to comment' });
</script>

{#if variant === 'recipe'}
  <section id="comments-section" class="space-y-6">
    <h2 class="text-2xl font-bold">Comments</h2>

    <div class="comments-list comments-list--recipe">
      {#if $events.length === 0}
        <p class="text-caption">No comments yet. Be the first to comment!</p>
      {:else}
        {#each $events as comment (comment.id)}
          <CommentCard
            variant="recipe"
            event={comment}
            allComments={$events}
            rootEvent={event}
            on:replyopen={() => openReplyCount++}
            on:replyclose={() => openReplyCount = Math.max(0, openReplyCount - 1)}
          />
        {/each}
      {/if}
    </div>

    {#if !anyReplyOpen}
      <div class="space-y-3 pt-4 border-t">
        <h3 class="text-lg font-semibold">Add a comment</h3>
        {#if $signedIn}
          <div class="p-3 rounded-lg" style="background-color: var(--color-bg-secondary)">
            <div class="flex gap-3 items-start">
              <div class="flex-shrink-0">
                <CustomAvatar pubkey={$userPublickey} size={36} />
              </div>
              <div class="flex-1 min-w-0 -mt-3">
                <ReplyComposer
                  parentEvent={event}
                  placeholder="Write a comment..."
                  submitLabel="Comment"
                  onPosted={handlePosted}
                />
              </div>
            </div>
          </div>
        {:else}
          <p class="text-sm text-caption">Sign in to comment.</p>
          <button type="button" class="text-sm underline hover:opacity-80" on:click={signInToComment}>Sign in</button>
        {/if}
      </div>
    {/if}
  </section>
{:else}
  <div class="inline-comments" data-event-id={event.id}>
    {#if showComments}
      <div class="mt-3 space-y-4 pt-3" style="border-top: 1px solid var(--color-input-border)">
        <div class="comments-list">
          {#if $events.length === 0}
            {#if !isReply(event)}
              <!-- Top-level posts get the empty-state nudge; a reply's
                   inline thread stays quiet when it has no children. -->
              <p class="text-sm text-caption">
                No replies yet.
                {#if !$signedIn}
                  <button type="button" class="underline hover:opacity-80" on:click={signInToComment}>Sign in</button>
                  to reply!
                {:else}
                  Be the first to reply!
                {/if}
              </p>
            {/if}
          {:else}
            {#each $events as comment (comment.id)}
              <CommentCard
                variant="feed"
                event={comment}
                allComments={$events}
                rootEvent={event}
                on:replyopen={() => (anyReplyOpen = true)}
                on:replyclose={() => (anyReplyOpen = false)}
              />
            {/each}
          {/if}
        </div>

        {#if !anyReplyOpen}
          {#if $signedIn}
            <div>
              <div class="p-3 rounded-lg" style="background-color: var(--color-bg-secondary)">
                <div class="flex gap-3 items-start">
                  <div class="flex-shrink-0">
                    <CustomAvatar pubkey={$userPublickey} size={32} />
                  </div>
                  <div class="flex-1 min-w-0 -mt-3">
                    <ReplyComposer
                      parentEvent={event}
                      placeholder="Write a reply..."
                      submitLabel="Reply"
                    />
                  </div>
                </div>
              </div>
            </div>
          {:else}
            <div
              class="text-sm text-caption pt-2"
              style="border-top: 1px solid var(--color-input-border)"
            >
              <button type="button" class="text-primary hover:underline" on:click={signInToComment}>Log in</button> to reply
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Recipe comments are sunken cards — space them out. */
  .comments-list--recipe {
    gap: 0.75rem;
  }
</style>
