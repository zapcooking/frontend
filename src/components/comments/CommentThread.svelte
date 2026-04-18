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
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { writable, type Readable } from 'svelte/store';
  import Button from '../Button.svelte';
  import CommentCard from './CommentCard.svelte';
  import ReplyComposer from './ReplyComposer.svelte';
  import {
    createCommentSubscription,
    type CommentSubscription
  } from '$lib/comments/subscription';

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

  let loginRedirectHref = '';
  $: loginRedirectHref = `/login?redirect=${encodeURIComponent($page.url.pathname)}`;
</script>

{#if variant === 'recipe'}
  <section id="comments-section" class="space-y-6">
    <h2 class="text-2xl font-bold">Comments</h2>

    <div class="comments-list">
      {#if $events.length === 0}
        <p class="text-caption">No comments yet. Be the first to comment!</p>
      {:else}
        {#each $events as comment (comment.id)}
          <CommentCard
            variant="recipe"
            event={comment}
            allComments={$events}
            rootEvent={event}
          />
        {/each}
      {/if}
    </div>

    <div class="space-y-3 pt-4 border-t">
      <h3 class="text-lg font-semibold">Add a comment</h3>
      {#if $ndk?.signer}
        <ReplyComposer
          parentEvent={event}
          placeholder="Share your thoughts..."
          submitLabel="Post Comment"
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
        <a href={loginRedirectHref} class="text-sm underline hover:opacity-80">Sign in</a>
      {/if}
    </div>
  </section>
{:else}
  <div class="inline-comments" data-event-id={event.id}>
    {#if showComments}
      <div class="mt-3 space-y-4 pt-3" style="border-top: 1px solid var(--color-input-border)">
        <div class="comments-list">
          {#if $events.length === 0}
            <p class="text-sm text-caption">
              No comments yet.
              {#if !$userPublickey}
                <a href={loginRedirectHref} class="underline hover:opacity-80">Sign in</a>
                to comment!
              {:else}
                Be the first to comment!
              {/if}
            </p>
          {:else}
            {#each $events as comment (comment.id)}
              <CommentCard
                variant="feed"
                event={comment}
                allComments={$events}
                rootEvent={event}
              />
            {/each}
          {/if}
        </div>

        {#if $userPublickey}
          <div class="space-y-2 pt-2" style="border-top: 1px solid var(--color-input-border)">
            <ReplyComposer
              parentEvent={event}
              placeholder="Add a comment..."
              submitLabel="Post Comment"
              compact
            />
          </div>
        {:else}
          <div
            class="text-sm text-caption pt-2"
            style="border-top: 1px solid var(--color-input-border)"
          >
            <a href={loginRedirectHref} class="text-primary hover:underline">Log in</a> to comment
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
