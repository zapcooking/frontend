<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import CustomAvatar from './CustomAvatar.svelte';
  import CustomName from './CustomName.svelte';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import Button from './Button.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import CommentLikes from './CommentLikes.svelte';

  export let parentComment: NDKEvent;
  
  let showReplies = false;
  let replies: NDKEvent[] = [];
  let loading = false;
  let replyText = '';
  let postingReply = false;
  let replyCount = 0;
  let errorMessage = '';
  let successMessage = '';

  // Load replies for this comment
  async function loadReplies() {
    if (loading) return;
    
    loading = true;
    replies = [];
    replyCount = 0;
    
    try {
      // Use subscribe collection for more reliable reply loading
      const replyEvents = $ndk.subscribe({
        kinds: [1],
        '#e': [parentComment.id] // Replies that reference this comment
      });
      replyEvents.on("event", (ev) => {
        loading = false;
        replies.push(ev);
        replies = replies;
      });
    } catch (error) {
      console.error('Error loading replies:', error);
      loading = false;
    }
  }

  // Post a new reply
  async function postReply() {
    if (!replyText.trim() || postingReply || !$ndk.signer) return;
    
    postingReply = true;
    errorMessage = '';
    successMessage = '';
    
    try {
      const replyEvent = new NDKEvent($ndk);
      replyEvent.kind = 1;
      replyEvent.content = replyText.trim();
      replyEvent.tags = [
        ['e', parentComment.id, '', 'reply'], // Reference the parent comment
        ['p', parentComment.pubkey], // Reference the parent comment author
        ...parentComment.getMatchingTags('e') // Include any other event references from parent
      ];
      
      // Add NIP-89 client tag
      addClientTagToEvent(replyEvent);
      
      await replyEvent.publish();
      
      // Clear the form and show success
      replyText = '';
      successMessage = 'Reply posted successfully!';
      
      // Reload replies to show the new one
      await loadReplies();
      
      // Clear success message after a delay
      setTimeout(() => {
        successMessage = '';
      }, 3000);
      
    } catch (error) {
      console.error('Error posting reply:', error);
      errorMessage = 'Failed to post reply. Please try again.';
    } finally {
      postingReply = false;
    }
  }

  // Toggle replies visibility
  function toggleReplies() {
    showReplies = !showReplies;
    if (showReplies && replies.length === 0) {
      loadReplies();
    }
  }
</script>

<div class="comment-replies" data-comment-id={parentComment.id}>
  <!-- Reply Button -->
  <button
    on:click={toggleReplies}
    class="text-sm text-gray-600 hover:text-primary font-medium cursor-pointer transition duration-300 print:hidden"
  >
    {showReplies ? 'Hide replies' : 'Reply'} {replyCount > 0 ? `(${replyCount})` : ''}
  </button>

  <!-- Replies Section -->
  {#if showReplies}
    <div class="mt-3 space-y-3">
      <!-- Authentication Status -->
      {#if !$ndk.signer}
        <div class="text-xs text-amber-600 bg-amber-50 p-2 rounded">
          <strong>Please log in</strong> to reply to comments.
        </div>
      {/if}
      
      <!-- Error/Success Messages -->
      {#if errorMessage}
        <div class="text-xs text-red-600 bg-red-50 p-2 rounded print:hidden">
          {errorMessage}
        </div>
      {/if}
      
      {#if successMessage}
        <div class="text-xs text-green-600 bg-green-50 p-2 rounded print:hidden">
          {successMessage}
        </div>
      {/if}
      
      <!-- Reply Form -->
      <div class="space-y-1 print:hidden">
        <textarea
          bind:value={replyText}
          placeholder={$ndk.signer ? "Add a reply..." : "Log in to reply..."}
          disabled={!$ndk.signer}
          class="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl resize-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed transition duration-200"
          rows="3"
        />
        <div class="flex justify-end">
          <Button
            on:click={postReply}
            disabled={!replyText.trim() || postingReply || !$ndk.signer}
            class="px-4 py-2 text-sm"
          >
            {postingReply ? 'Posting...' : ($ndk.signer ? 'Post Reply' : 'Log in to reply')}
          </Button>
        </div>
      </div>

      <!-- Replies List -->
      <div class="space-y-2">
        {#if loading}
          <div class="py-2 text-sm text-gray-500">Loading replies...</div>
        {:else if replies.length === 0}
          <div class="text-center py-2 text-xs text-gray-500">No replies yet</div>
        {:else}
          {#each replies as reply}
            <div class="flex gap-2">
              <CustomAvatar
                className="flex-shrink-0"
                pubkey={reply.pubkey}
                size={24}
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="font-semibold text-sm text-gray-900">
                    <CustomName pubkey={reply.pubkey} />
                  </span>
                  <span class="text-xs text-gray-500">
                    {formatDate(new Date((reply.created_at || 0) * 1000))}
                  </span>
                </div>
                <p class="text-sm text-gray-700 leading-relaxed mb-2">
                  {reply.content}
                </p>
                <!-- Reply Actions -->
                <div class="flex items-center gap-2">
                  <CommentLikes event={reply} />
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

