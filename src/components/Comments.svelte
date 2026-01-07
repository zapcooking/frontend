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
    
    // For longform (kind 30023), use NIP-22 #A filter
    // For kind 1, use NIP-10 #e filter
    if (event.kind === 30023) {
      const dTag = event.tags.find((e) => e[0] == 'd')?.[1];
      if (dTag) {
        const addressTag = `${event.kind}:${event.author.pubkey}:${dTag}`;
        commentSubscription = $ndk.subscribe({
          kinds: [1111],
          '#A': [addressTag]  // NIP-22: filter by root address
        }, { closeOnEose: false });
      } else {
        // Fallback if no d tag
        commentSubscription = $ndk.subscribe({
          kinds: [1, 1111],
          '#e': [event.id]
        }, { closeOnEose: false });
      }
    } else {
      // NIP-10 for kind 1 notes
      commentSubscription = $ndk.subscribe({
        kinds: [1],
        '#e': [event.id]
      }, { closeOnEose: false });
    }

    commentSubscription.on('event', (e) => {
      // Prevent adding the same event multiple times
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);

      events.push(e);
      events = events;
    });

    commentSubscription.on('eose', () => {
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
    if (!commentText.trim()) {
      return;
    }
    
    if (!$ndk?.signer) {
      console.error('No signer available - user must be logged in');
      alert('Please log in to post comments');
      return;
    }
    
    const ev = new NDKEvent($ndk);
    // Recipe replies should be kind 1111, not kind 1
    const isRecipe = event.kind === 30023;
    ev.kind = isRecipe ? 1111 : 1;
    ev.content = commentText.trim();
    
    if (isRecipe) {
      // NIP-22 structure for longform comments
      const dTag = event.tags.find((e) => e[0] == 'd')?.[1];
      if (dTag) {
        const addressTag = `${event.kind}:${event.author.pubkey}:${dTag}`;
        const relayHint = event.tags.find((t) => t[0] === 'relay')?.[1] || '';
        
        ev.tags = [
          // Root scope (uppercase)
          ['A', addressTag, relayHint, event.author.pubkey],
          ['K', String(event.kind)],
          ['P', event.author.pubkey],
          // Parent scope (lowercase) - same as root for top-level comment
          ['a', addressTag, relayHint, event.author.pubkey],
          ['e', event.id, relayHint, event.author.pubkey],
          ['k', String(event.kind)],
          ['p', event.author.pubkey]
        ];
      } else {
        // Fallback if no d tag
        ev.tags = [
          ['e', event.id, '', event.author.pubkey],
          ['p', event.author.pubkey]
        ];
      }
    } else {
      // NIP-10 structure for kind 1 replies
      ev.tags = [
        ['e', event.id, '', 'root'],
        ['p', event.pubkey]
      ];
    }
    
    // Add NIP-89 client tag
    addClientTagToEvent(ev);

    try {
      // Ensure created_at is set before signing
      if (!ev.created_at) {
        ev.created_at = Math.floor(Date.now() / 1000);
      }
      
      // Sign the event - NIP-07 extension should prompt user
      // Don't timeout signing - let the extension handle it naturally
      // Users may need time to approve in their extension
      await ev.sign();
      
      if (!ev.id) {
        throw new Error('Event was not signed - no ID generated');
      }
      
      // Publish the event with a reasonable timeout
      await Promise.race([
        ev.publish(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Publishing timeout after 30 seconds')), 30000)
        )
      ]);
      
      // Immediately add to local events array so it appears right away
      if (!processedEvents.has(ev.id)) {
        processedEvents.add(ev.id);
        events.push(ev);
        events = events; // Trigger reactivity
      }
      
      // Clear the comment text
      commentText = '';
    } catch (error) {
      console.error('Error posting comment:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      alert('Error posting comment: ' + errorMsg);
    }
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
    <Button 
      on:click={(e) => {
        e.preventDefault?.();
        postComment();
      }} 
      disabled={!commentText.trim()}
    >
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
