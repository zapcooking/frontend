<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import FeedComment from './FeedComment.svelte';

  export let event: NDKEvent;
  let events: NDKEvent[] = [];
  let commentText = '';
  let processedEvents = new Set();
  let subscribed = false;
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

  // Create subscription once when ndk is ready
  $: if ($ndk && !subscribed && showComments) {
    subscribed = true;
    console.log('FeedComments: Subscribing to #e:', event.id);

    const sub = $ndk.subscribe({
      kinds: [1],
      '#e': [event.id]
    }, { closeOnEose: false });

    sub.on('event', (e) => {
      console.log('FeedComments: Received event:', e.id);
      // Prevent adding the same event multiple times
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);

      events.push(e);
      events = events;
    });

    sub.on('eose', () => {
      console.log('FeedComments: EOSE - total events:', events.length);
    });
  }

  // Dummy refresh function for FeedComment component - not needed since subscription stays open
  function refresh() {
    // No-op: the subscription will automatically receive new events
  }

  async function postComment() {
    if (!commentText.trim()) return;

    const ev = new NDKEvent($ndk);
    ev.kind = 1;
    ev.content = commentText;
    ev.tags = [
      ['e', event.id, '', 'reply'],
      ['p', event.pubkey]
    ];

    await ev.publish();
    commentText = '';
  }

  function toggleComments() {
    showComments = !showComments;
  }

  // Filter top-level comments (only direct replies to the main event)
  $: topLevelComments = events.filter((e) => {
    const eTags = e.getMatchingTags('e');
    // Only include comments that reference the main event directly
    return eTags.length === 1 && eTags[0][1] === event.id;
  });
</script>

<div class="inline-comments" data-event-id={event.id}>
  {#if showComments}
    <div class="mt-3 space-y-4 pt-3" style="border-top: 1px solid var(--color-input-border)">
      <!-- Comments List -->
      <div class="space-y-4">
        {#if topLevelComments.length === 0}
          <p class="text-sm text-caption">No comments yet. Be the first to comment!</p>
        {:else}
          {#each topLevelComments as comment}
            <FeedComment event={comment} replies={events} {refresh} mainEventId={event.id} />
          {/each}
        {/if}
      </div>

      <!-- Add Comment Form -->
      {#if $userPublickey}
        <div class="space-y-2 pt-2" style="border-top: 1px solid var(--color-input-border)">
          <textarea
            bind:value={commentText}
            placeholder="Add a comment..."
            class="w-full px-3 py-2 text-sm rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent bg-input"
            style="border: 1px solid var(--color-input-border); color: var(--color-text-primary)"
            rows="2"
          />
          <div class="flex justify-end">
            <Button on:click={postComment} disabled={!commentText.trim()} class="text-sm px-4 py-2">
              Post Comment
            </Button>
          </div>
        </div>
      {:else}
        <div class="text-sm text-caption pt-2" style="border-top: 1px solid var(--color-input-border)">
          <a href="/login" class="text-primary hover:underline">Log in</a> to comment
        </div>
      {/if}
    </div>
  {/if}
</div>
