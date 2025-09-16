<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { Avatar, Name } from '@nostr-dev-kit/ndk-svelte-components';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import Button from './Button.svelte';
  import CommentIcon from 'phosphor-svelte/lib/ChatTeardropText';

  export let event: NDKEvent;
  
  let showComments = false;
  let comments: NDKEvent[] = [];
  let loading = false;
  let commentText = '';
  let postingComment = false;
  let commentCount = 0;

  // Load comments for this event
  async function loadComments() {
    if (loading) return;
    
    loading = true;
    comments = [];
    commentCount = 0;
    
    try {
      // Subscribe to comments for this event
      const sub = $ndk.subscribe({
        kinds: [1],
        '#e': [event.id] // Comments that reference this event
      }, { closeOnEose: false });

      sub.on('event', (commentEvent) => {
        comments.push(commentEvent);
        commentCount++;
        comments = [...comments];
      });

      sub.on('eose', () => {
        loading = false;
      });
    } catch (error) {
      console.error('Error loading comments:', error);
      loading = false;
    }
  }

  // Post a new comment
  async function postComment() {
    if (!commentText.trim() || postingComment) return;
    
    postingComment = true;
    
    try {
      const commentEvent = new NDKEvent($ndk);
      commentEvent.kind = 1;
      commentEvent.content = commentText.trim();
      commentEvent.tags = [
        ['e', event.id, '', 'reply'], // Reference the original event
        ['p', event.pubkey] // Reference the original author
      ];

      await commentEvent.publish();
      
      // Clear the comment text
      commentText = '';
      
      // Reload comments to show the new one
      await loadComments();
    } catch (error) {
      console.error('Error posting comment:', error);
    } finally {
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
  });
</script>

<div class="mt-3">
  <!-- Comment Button -->
  <button 
    on:click={toggleComments}
    class="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
  >
    <CommentIcon size={16} />
    <span>
      {#if loading}
        ...
      {:else if commentCount > 0}
        {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
      {:else}
        Comment
      {/if}
    </span>
  </button>

  <!-- Comments Section -->
  {#if showComments}
    <div class="mt-3 space-y-3 border-t border-gray-100 pt-3">
      <!-- Comment Form -->
      <div class="space-y-2">
        <textarea
          bind:value={commentText}
          placeholder="Add a comment..."
          class="w-full p-3 text-sm border border-gray-200 rounded-lg resize-none focus:ring-2 focus:ring-primary focus:border-transparent"
          rows="2"
        />
        <div class="flex justify-end">
          <Button 
            on:click={postComment}
            disabled={!commentText.trim() || postingComment}
            class="px-4 py-2 text-sm"
          >
            {postingComment ? 'Posting...' : 'Post Comment'}
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
            <div class="flex gap-3">
              <Avatar
                class="h-8 w-8 rounded-full flex-shrink-0"
                ndk={$ndk}
                pubkey={comment.pubkey}
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="font-medium text-sm text-gray-900">
                    <Name ndk={$ndk} pubkey={comment.pubkey} />
                  </span>
                  <span class="text-xs text-gray-500">
                    {formatDate(new Date((comment.created_at || 0) * 1000))}
                  </span>
                </div>
                <p class="text-sm text-gray-700 leading-relaxed">
                  {comment.content}
                </p>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
