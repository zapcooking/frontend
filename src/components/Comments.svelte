<script lang="ts">
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import Comment from './Comment.svelte';

  export let event: NDKEvent;
  let events = [];
  let commentText = '';
  let processedEvents = new Set();
  let subscribed = false;

  // Create subscription once when ndk is ready
  $: if ($ndk && !subscribed) {
    subscribed = true;
    const filterTag = `${event.kind}:${event.author.pubkey}:${event.tags.find((e) => e[0] == 'd')?.[1]}`;

    const sub = $ndk.subscribe({
      kinds: [1],
      '#a': [filterTag]
    }, { closeOnEose: false });

    sub.on('event', (e) => {
      console.log('Comments: Received event:', e.id);
      // Prevent adding the same event multiple times
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);

      events.push(e);
      events = events;
    });

    sub.on('eose', () => {
      console.log('Comments: EOSE - total events:', events.length);
    });
  }

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

  // Filter top-level comments (no 'e' tags)
  $: topLevelComments = events.filter((e) => e.getMatchingTags('e').length === 0);
</script>

<div id="comments-section" class="space-y-6">
  <h2 class="text-2xl font-bold">Comments</h2>

  <!-- Comments List -->
  <div class="space-y-4">
    {#if topLevelComments.length === 0}
      <p class="text-gray-500">No comments yet. Be the first to comment!</p>
    {:else}
      {#each topLevelComments as comment}
        <Comment event={comment} replies={events} refresh={refresh} />
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
      class="w-full px-4 py-3 text-base border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent"
      rows="4"
    />
    <Button on:click={postComment} disabled={!commentText.trim()}>
      Post Comment
    </Button>
  </div>
</div>
