<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { format as formatDate } from 'timeago.js';
  import CustomAvatar from './CustomAvatar.svelte';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import CommentLikes from './CommentLikes.svelte';
  import CommentReplies from './CommentReplies.svelte';
  import { onMount } from 'svelte';

  export let event: NDKEvent;

  let displayName: string = '';
  let isLoading: boolean = true;

  onMount(async () => {
    if (event.pubkey && $ndk) {
      try {
        isLoading = true;
        const profile = await resolveProfileByPubkey(event.pubkey, $ndk);
        displayName = formatDisplayName(profile);
      } catch (error) {
        console.error('Failed to load profile:', error);
        displayName = '@Anonymous';
      } finally {
        isLoading = false;
      }
    }
  });
</script>

<div class="comment-row">
  <div class="comment-avatar">
    <CustomAvatar
      className="flex-shrink-0"
      pubkey={event.pubkey}
      size={32}
    />
  </div>
  <div class="comment-content">
    <div class="comment-header">
      <span class="comment-author">
        {#if isLoading}
          <span class="animate-pulse">Loading...</span>
        {:else}
          {displayName}
        {/if}
      </span>
      <span class="comment-time">
        {formatDate(new Date((event.created_at || 0) * 1000))}
      </span>
    </div>
    <p class="comment-body">
      {event.content}
    </p>
    
    <!-- Comment Actions -->
    <div class="flex items-center gap-3">
      <CommentLikes {event} />
      <CommentReplies parentComment={event} />
    </div>
  </div>
</div>

<style>
  /* Comment row - 2 column flex layout */
  .comment-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  
  @media (min-width: 640px) {
    .comment-row {
      gap: 0.75rem;
    }
  }
  
  /* Avatar gutter - fixed width, never shrinks */
  .comment-avatar {
    flex: 0 0 auto;
    width: 32px;
  }
  
  /* Content column - takes remaining width, CAN shrink */
  .comment-content {
    flex: 1 1 0%;
    min-width: 0; /* Critical: allows content to shrink below intrinsic width */
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  
  /* Name + Time header - wraps naturally on mobile */
  .comment-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.125rem 0.5rem;
    margin-bottom: 0.25rem;
  }
  
  .comment-author {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  
  .comment-time {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  
  /* Comment body text */
  .comment-body {
    font-size: 0.875rem;
    line-height: 1.625;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }
</style>

