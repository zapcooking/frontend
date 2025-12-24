<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
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

    const sub = $ndk.subscribe({
      kinds: [1],
      '#e': [event.id]
    }, { closeOnEose: false });

    sub.on('event', (e) => {
      if (processedEvents.has(e.id)) return;
      processedEvents.add(e.id);
      events.push(e);
      events = events;
    });

    sub.on('eose', () => {});
  }

  // Dummy refresh function for FeedComment component - not needed since subscription stays open
  function refresh() {
    // No-op: the subscription will automatically receive new events
  }

  async function postComment() {
    if (!commentText.trim()) return;

    try {
      const ev = new NDKEvent($ndk);
      ev.kind = 1;
      ev.content = commentText;
      ev.tags = [
        ['e', event.id, '', 'reply'],
        ['p', event.pubkey]
      ];
      
      // Add NIP-89 client tag
      addClientTagToEvent(ev);

      await ev.publish();
      commentText = '';
    } catch {
      // Failed to post comment
    }
  }

  function toggleComments() {
    showComments = !showComments;
  }

  // Filter top-level comments (direct replies to the main event)
  $: topLevelComments = events.filter((e) => {
    const eTags = e.getMatchingTags('e');
    
    // Check if this is a direct reply to the main event
    // A comment is a direct reply if:
    // 1. It has a 'reply' marker pointing to the main event, OR
    // 2. It has only one e tag pointing to the main event, OR
    // 3. It has the main event as 'root' and no other 'reply' marker
    
    const replyTag = eTags.find(tag => tag[3] === 'reply');
    const rootTag = eTags.find(tag => tag[3] === 'root');
    
    // If there's a specific reply marker, check if it points to main event
    if (replyTag) {
      return replyTag[1] === event.id;
    }
    
    // If only one e tag, it's a direct reply
    if (eTags.length === 1 && eTags[0][1] === event.id) {
      return true;
    }
    
    // If root is main event and no reply marker, it's a direct reply
    if (rootTag && rootTag[1] === event.id && !replyTag) {
      return true;
    }
    
    // Otherwise, check if any e tag (without markers) references main event
    // This handles older/simpler tagging conventions
    if (eTags.length > 0 && !replyTag && !rootTag) {
      return eTags.some(tag => tag[1] === event.id);
    }
    
    return false;
  });
</script>

<div class="inline-comments" data-event-id={event.id}>
  {#if showComments}
    <div class="mt-3 space-y-4 border-t border-gray-100 pt-3">
      <!-- Comments List -->
      <div class="space-y-4">
        {#if topLevelComments.length === 0}
          <p class="text-sm text-gray-500">No comments yet. Be the first to comment!</p>
        {:else}
          {#each topLevelComments as comment}
            <FeedComment event={comment} replies={events} {refresh} mainEventId={event.id} />
          {/each}
        {/if}
      </div>

      <!-- Add Comment Form -->
      {#if $userPublickey}
        <div class="space-y-2 pt-2 border-t border-gray-100">
          <textarea
            bind:value={commentText}
            placeholder="Add a comment..."
            class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent"
            rows="2"
          />
          <div class="flex justify-end">
            <Button on:click={postComment} disabled={!commentText.trim()} class="text-sm px-4 py-2">
              Post Comment
            </Button>
          </div>
        </div>
      {:else}
        <div class="text-sm text-gray-500 pt-2 border-t border-gray-100">
          <a href="/login" class="text-primary hover:underline">Log in</a> to comment
        </div>
      {/if}
    </div>
  {/if}
</div>
