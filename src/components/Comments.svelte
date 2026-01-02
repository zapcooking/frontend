<script lang="ts">
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import Comment from './Comment.svelte';
  import { onDestroy } from 'svelte';

  export let event: NDKEvent;
  let events = [];
  let commentText = '';
  let processedEvents = new Set();
  let subscribed = false;
  let commentSubscription: any = null;

  // Create subscription once when ndk is ready
  $: if ($ndk && !subscribed) {
    subscribed = true;
    const filterTag = `${event.kind}:${event.author.pubkey}:${event.tags.find((e) => e[0] == 'd')?.[1]}`;

    commentSubscription = $ndk.subscribe({
      kinds: [1],
      '#a': [filterTag]
    }, { closeOnEose: false });

    commentSubscription.on('event', (e) => {
      console.log('Comments: Received event:', e.id);
      // Prevent adding the same event multiple times
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);

      events.push(e);
      events = events;
    });

    commentSubscription.on('eose', () => {
      console.log('Comments: EOSE - total events:', events.length);
    });
  }

  onDestroy(() => {
    if (commentSubscription) {
      commentSubscription.stop();
    }
  });

  // Dummy refresh function for Comment component - not needed since subscription stays open
  function refresh() {
    // No-op: the subscription will automatically receive new events
  }

  async function postComment() {
    const ev = new NDKEvent($ndk);
    ev.kind = 1;
    ev.content = commentText;
    ev.tags = [
      ['a', `${event.kind}:${event.author.pubkey}:${event.tags.find((e) => e[0] == 'd')?.[1]}`]
    ];
    
    // Add NIP-89 client tag
    addClientTagToEvent(ev);

    await ev.publish();
    commentText = '';
  }

  // Sort all comments chronologically (oldest first)
  $: sortedComments = [...events].sort((a, b) => 
    (a.created_at || 0) - (b.created_at || 0)
  );
</script>

<div id="comments-section" class="space-y-6">
  <h2 class="text-2xl font-bold">Comments</h2>

  <!-- Comments List - flat with embedded parent quotes -->
  <div class="comments-list">
    {#if sortedComments.length === 0}
      <p class="text-caption">No comments yet. Be the first to comment!</p>
    {:else}
      {#each sortedComments as comment (comment.id)}
        <Comment event={comment} allReplies={events} refresh={refresh} />
      {/each}
    {/if}
  </div>

  <!-- Add Comment Form -->
  <div class="space-y-3 pt-4 border-t">
    <h3 class="text-lg font-semibold">Add a comment</h3>
    <textarea
      id="comment-input"
      bind:value={commentText}
      placeholder="Share your thoughts..."
      class="w-full px-4 py-3 text-base input rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent"
      rows="4"
    />
    <Button on:click={postComment} disabled={!commentText.trim()}>
      Post Comment
    </Button>
  </div>
</div>

<style>
  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
