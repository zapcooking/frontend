<script lang="ts">
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
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
    console.log('postComment called, commentText:', commentText);
    console.log('NDK signer available:', !!$ndk?.signer);
    
    if (!commentText.trim()) {
      console.log('Comment text is empty, returning early');
      return;
    }
    
    if (!$ndk?.signer) {
      console.error('No signer available - user must be logged in');
      alert('Please log in to post comments');
      return;
    }
    
    console.log('Creating comment event...');
    console.log('Signer type:', $ndk.signer?.constructor?.name);
    
    // Check if NIP-07 extension is available
    if (typeof window !== 'undefined' && window.nostr) {
      console.log('NIP-07 extension found:', typeof window.nostr);
      try {
        const pubkey = await window.nostr.getPublicKey();
        console.log('Extension pubkey:', pubkey);
      } catch (e) {
        console.warn('Could not get pubkey from extension:', e);
      }
    } else {
      console.warn('NIP-07 extension not found (window.nostr is not available)');
    }
    
    const ev = new NDKEvent($ndk);
    // Recipe replies should be kind 1111, not kind 1
    const isRecipe = event.kind === 30023;
    ev.kind = isRecipe ? 1111 : 1;
    ev.content = commentText.trim();
    
    // Use shared utility to build NIP-22 or NIP-10 tags
    ev.tags = buildNip22CommentTags({
      kind: event.kind,
      pubkey: event.author?.pubkey || event.pubkey,
      id: event.id,
      tags: event.tags
    });
    
    // Add NIP-89 client tag
    addClientTagToEvent(ev);

    try {
      // Ensure created_at is set before signing
      if (!ev.created_at) {
        ev.created_at = Math.floor(Date.now() / 1000);
      }
      
      console.log('Signing event...');
      console.log('Event before sign:', {
        kind: ev.kind,
        content: ev.content,
        tags: ev.tags,
        pubkey: ev.pubkey,
        created_at: ev.created_at
      });
      
      // Sign the event - NIP-07 extension should prompt user
      // Don't timeout signing - let the extension handle it naturally
      // Users may need time to approve in their extension
      console.log('Calling ev.sign() - extension should prompt for approval...');
      await ev.sign();
      
      console.log('Event signed successfully, ID:', ev.id);
      console.log('Event after sign:', {
        id: ev.id,
        sig: ev.sig ? ev.sig.substring(0, 20) + '...' : 'none',
        pubkey: ev.pubkey
      });
      
      if (!ev.id) {
        throw new Error('Event was not signed - no ID generated');
      }
      
      console.log('Publishing event...');
      // Publish the event with a reasonable timeout
      await Promise.race([
        ev.publish(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Publishing timeout after 30 seconds')), 30000)
        )
      ]);
      
      console.log('Event published successfully');
      
      // Immediately add to local events array so it appears right away
      if (!processedEvents.has(ev.id)) {
        processedEvents.add(ev.id);
        events.push(ev);
        events = events; // Trigger reactivity
        console.log('Added event to local array, total events:', events.length);
      }
      
      // Clear the comment text
      commentText = '';
      console.log('Comment posted successfully!');
    } catch (error) {
      console.error('Error posting comment:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
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
        console.log('Button clicked!');
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
