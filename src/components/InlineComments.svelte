<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { nip19 } from 'nostr-tools';
  import { addClientTagToEvent } from '$lib/nip89';
  import { buildNip22CommentTags } from '$lib/tagUtils';
  import { format as formatDate } from 'timeago.js';
  import Button from './Button.svelte';
  import CommentWithActions from './CommentWithActions.svelte';

  export let event: NDKEvent;
  
  let showComments = false;
  let comments: NDKEvent[] = [];
  let loading = false;
  let commentText = '';
  let postingComment = false;
  let commentCount = 0;
  let errorMessage = '';
  let successMessage = '';
  let commentSubscription: any = null;

  // Load comments for this event
  async function loadComments() {
    if (loading) return;
    
    loading = true;
    comments = [];
    commentCount = 0;
    
    // Close previous subscription if exists
    if (commentSubscription) {
      commentSubscription.stop();
    }
    
    try {
      // For longform (kind 30023), use NIP-22 #A filter
      // For kind 1, use NIP-10 #e filter
      if (event.kind === 30023) {
        const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
        if (dTag) {
          const addressTag = `${event.kind}:${event.pubkey}:${dTag}`;
          commentSubscription = $ndk.subscribe({
            kinds: [1111],
            '#A': [addressTag]  // NIP-22: filter by root address
          }, { closeOnEose: true });
        } else {
          // Fallback if no d tag
          commentSubscription = $ndk.subscribe({
            kinds: [1, 1111],
            '#e': [event.id]
          }, { closeOnEose: true });
        }
      } else {
        // NIP-10 for kind 1 notes
        commentSubscription = $ndk.subscribe({
          kinds: [1],
          '#e': [event.id]
        }, { closeOnEose: true });
      }
      
      commentSubscription.on("event", (ev) => {
        loading = false;
        comments.push(ev);
        comments = comments;
      });
      
      commentSubscription.on("eose", () => {
        loading = false;
      });

    } catch (error) {
      console.error('Error loading comments:', error);
      loading = false;
    }
  }

  onDestroy(() => {
    if (commentSubscription) {
      commentSubscription.stop();
    }
  });

  // Post a new comment
  async function postComment() {
    if (!commentText.trim() || postingComment) return;
    
    // Check if user is authenticated
    if (!$ndk.signer) {
      errorMessage = 'Please log in to post comments';
      setTimeout(() => errorMessage = '', 3000);
      return;
    }
    
    // Ensure NDK is connected
    try {
      await $ndk.connect();
      console.log('NDK connected successfully');
    } catch (connectError) {
      console.error('Failed to connect NDK:', connectError);
      errorMessage = 'Failed to connect to relays. Please try again.';
      setTimeout(() => errorMessage = '', 5000);
      postingComment = false;
      return;
    }
    
    postingComment = true;
    errorMessage = '';
    successMessage = '';
    
    console.log('Starting comment post process...');
    console.log('Comment text:', commentText.trim());
    console.log('Event ID:', event.id);
    console.log('Event pubkey:', event.pubkey);
    
    try {
      const commentEvent = new NDKEvent($ndk);
      
      // Check if replying to a recipe (kind 30023)
      // Recipe replies should be kind 1111, not kind 1
      const isRecipe = event.kind === 30023;
      commentEvent.kind = isRecipe ? 1111 : 1;
      
      commentEvent.content = commentText.trim();
      
      // Use shared utility to build NIP-22 or NIP-10 tags
      commentEvent.tags = buildNip22CommentTags({
        kind: event.kind,
        pubkey: event.pubkey,
        id: event.id,
        tags: event.tags
      });
      
      // Add NIP-89 client tag
      addClientTagToEvent(commentEvent);

      console.log('Created comment event:', commentEvent);
      console.log('Comment event tags:', commentEvent.tags);
      
      // Debug NDK state before publishing
      console.log('NDK state:', {
        signer: !!$ndk.signer,
        signerType: $ndk.signer?.constructor.name
      });
      
      // Try a simple publish with detailed logging
      console.log('Attempting simple publish...');
      
      // Ensure the event is signed first
      await commentEvent.sign();
      console.log('Event signed successfully');
      
      // Try publishing with a reasonable timeout
      const publishPromise = commentEvent.publish();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Publish timeout after 8 seconds')), 8000)
      );
      
      try {
        await Promise.race([publishPromise, timeoutPromise]);
        console.log('Comment published successfully');
      } catch (publishError) {
        console.error('Publish failed:', publishError);
        
        // If it's a timeout, try one more time with a different approach
        if (publishError instanceof Error && publishError.message.includes('timeout')) {
          console.log('Publish timed out, trying alternative approach...');
          
          // Try creating a new event and publishing it
          const newCommentEvent = new NDKEvent($ndk);
          const isRecipe = event.kind === 30023;
          newCommentEvent.kind = isRecipe ? 1111 : 1;
          newCommentEvent.content = commentText.trim();
          
          // Use shared utility to build NIP-22 or NIP-10 tags
          newCommentEvent.tags = buildNip22CommentTags({
            kind: event.kind,
            pubkey: event.pubkey,
            id: event.id,
            tags: event.tags
          });
          
          // Add NIP-89 client tag
          addClientTagToEvent(newCommentEvent);
          
          await newCommentEvent.sign();
          console.log('New event signed, attempting publish...');
          
          const newPublishPromise = newCommentEvent.publish();
          const newTimeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('New event publish timeout after 5 seconds')), 5000)
          );
          
          await Promise.race([newPublishPromise, newTimeoutPromise]);
          console.log('New event published successfully');
        } else {
          throw publishError;
        }
      }
      
      console.log('Comment published successfully');
      successMessage = 'Comment posted successfully!';
      setTimeout(() => successMessage = '', 3000);
      
      // Clear the comment text
      commentText = '';
      
      // Reload comments to show the new one
      console.log('Reloading comments...');
      loadComments();
      
    } catch (error) {
      console.error('Error posting comment:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined
      });
      
      errorMessage = 'Error posting comment: ' + (error instanceof Error ? error.message : String(error));
      setTimeout(() => errorMessage = '', 5000);
    } finally {
      console.log('Comment posting process finished, setting postingComment to false');
      postingComment = false;
    }
  }

  // Toggle comments visibility
  function toggleComments() {
    showComments = !showComments;
    if (showComments && comments.length === 0) {
      loadComments();
    }
  }

  // Initialize comment count
  onMount(() => {
    loadComments();
    
    // Listen for custom toggle event from the center comment button
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
</script>

<div class="mt-3 inline-comments" data-event-id={event.id}>

  <!-- Comments Section -->
  {#if showComments}
    <div class="mt-3 space-y-3 border-t border-gray-100 pt-3 comments-section" data-event-id={event.id}>
      <!-- Authentication Status -->
      {#if !$ndk.signer}
        <div class="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
          <strong>Please log in</strong> to post comments. Use the login button in the navigation.
        </div>
      {/if}
      
      <!-- Error/Success Messages -->
      {#if errorMessage}
        <div class="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
          {errorMessage}
        </div>
      {/if}
      
      {#if successMessage}
        <div class="text-sm text-green-600 bg-green-50 p-3 rounded-lg">
          {successMessage}
        </div>
      {/if}
      
      <!-- Comment Form -->
      <div class="space-y-2">
        <textarea
          bind:value={commentText}
          placeholder={$ndk.signer ? "Add a comment..." : "Log in to comment..."}
          disabled={!$ndk.signer}
          class="w-full p-3 text-sm border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          rows="2"
        />
        <div class="flex justify-end">
          <Button 
            on:click={postComment}
            disabled={!commentText.trim() || postingComment || !$ndk.signer}
            class="px-4 py-2 text-sm"
          >
            {postingComment ? 'Posting...' : ($ndk.signer ? 'Post Comment' : 'Log in to comment')}
          </Button>
        </div>
      </div>

      <!-- Comments List -->
      <div class="space-y-3">
        {#if loading}
          <div class="text-center py-4 text-sm text-gray-500">Loading comments...</div>
        {:else if comments.length === 0}
          <div class="text-center py-4 text-sm text-gray-500">No comments yet</div>
        {:else}
          {#each comments as comment}
            <CommentWithActions event={comment} />
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
