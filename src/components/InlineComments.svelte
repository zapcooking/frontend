<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { Avatar, Name } from '@nostr-dev-kit/ndk-svelte-components';
  import { nip19 } from 'nostr-tools';
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

  // Load comments for this event
  async function loadComments() {
    if (loading) return;
    
    loading = true;
    comments = [];
    commentCount = 0;
    
    try {
      // Use fetchEvents for more reliable comment loading
      const commentEvents = await $ndk.fetchEvents({
        kinds: [1],
        '#e': [event.id] // Comments that reference this event
      });

      if (commentEvents.size > 0) {
        comments = Array.from(commentEvents);
        commentCount = comments.length;
        comments = [...comments]; // Trigger reactivity
      }
      
      loading = false;
    } catch (error) {
      console.error('Error loading comments:', error);
      loading = false;
    }
  }

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
      commentEvent.kind = 1;
      commentEvent.content = commentText.trim();
      commentEvent.tags = [
        ['e', event.id, '', 'reply'], // Reference the original event
        ['p', event.pubkey] // Reference the original author
      ];

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
          newCommentEvent.kind = 1;
          newCommentEvent.content = commentText.trim();
          newCommentEvent.tags = [
            ['e', event.id, '', 'reply'],
            ['p', event.pubkey]
          ];
          
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
