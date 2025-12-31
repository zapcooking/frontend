<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { ndk, userPublickey } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import CustomAvatar from './CustomAvatar.svelte';
  import NoteContent from './NoteContent.svelte';
  import ZapModal from './ZapModal.svelte';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import { formatAmount } from '$lib/utils';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { addClientTagToEvent } from '$lib/nip89';
  import { onMount, onDestroy } from 'svelte';
  import { decode } from '@gandlaf21/bolt11-decode';

  export let event: NDKEvent;
  export let allComments: NDKEvent[] = []; // All comments for finding parent
  export let refresh: () => void;
  export let mainEventId: string;

  // Display state
  let displayName = '';
  let isLoading = true;

  // Parent comment state (for embedded quote)
  let parentComment: NDKEvent | null = null;
  let parentDisplayName = '';
  let parentLoading = true;

  // Reply box state
  let showReplyBox = false;
  let replyText = '';
  let postingReply = false;

  // Like state
  let liked = false;
  let likeCount = 0;
  let likesLoading = true;
  let processedLikes = new Set();

  // Zap state
  let zapModalOpen = false;
  let totalZapAmount = 0;
  let hasUserZapped = false;
  let processedZaps = new Set<string>();
  let zapSubscription: any = null;

  // Find parent comment ID (if replying to a comment, not the main post)
  function getParentCommentId(): string | null {
    const eTags = event.getMatchingTags('e');
    // Look for a 'reply' tag that points to something other than mainEventId
    const replyTag = eTags.find(tag => tag[3] === 'reply' && tag[1] !== mainEventId);
    if (replyTag) return replyTag[1];
    
    // If no explicit reply tag, check if there are multiple e tags
    // The last one (before root) might be the parent comment
    const nonRootTags = eTags.filter(tag => tag[3] !== 'root' && tag[1] !== mainEventId);
    if (nonRootTags.length > 0) {
      return nonRootTags[nonRootTags.length - 1][1];
    }
    
    return null;
  }

  // Load zaps for this comment
  function loadZaps() {
    if (!event?.id || !$ndk) return;
    
    totalZapAmount = 0;
    processedZaps.clear();
    hasUserZapped = false;

    zapSubscription = $ndk.subscribe({
      kinds: [9735],
      '#e': [event.id]
    });

    zapSubscription.on('event', (zapEvent: NDKEvent) => {
      if (!zapEvent.sig || processedZaps.has(zapEvent.sig)) return;

      const bolt11 = zapEvent.tags.find((tag) => tag[0] === 'bolt11')?.[1];
      if (!bolt11) return;

      try {
        const decoded = decode(bolt11);
        const amountSection = decoded.sections.find((section: any) => section.name === 'amount');

        if (amountSection && amountSection.value) {
          const amount = Number(amountSection.value);
          if (!isNaN(amount) && amount > 0) {
            totalZapAmount += amount;
            processedZaps.add(zapEvent.sig);

            if (zapEvent.tags.some((tag) => tag[0] === 'P' && tag[1] === $userPublickey)) {
              hasUserZapped = true;
            }
          }
        }
      } catch (error) {
        console.debug('Error decoding bolt11:', error);
      }
    });
  }

  // Load profile and parent comment
  onMount(async () => {
    // Load author profile
    if (event.pubkey && $ndk) {
      try {
        const profile = await resolveProfileByPubkey(event.pubkey, $ndk);
        displayName = formatDisplayName(profile);
      } catch (error) {
        displayName = '@Anonymous';
      } finally {
        isLoading = false;
      }
    }

    // Load parent comment if this is a reply to another comment
    const parentId = getParentCommentId();
    if (parentId) {
      // First check in allComments
      parentComment = allComments.find(c => c.id === parentId) || null;
      
      // If not found locally, fetch it
      if (!parentComment && $ndk) {
        try {
          parentComment = await $ndk.fetchEvent({
            kinds: [1],
            ids: [parentId]
          });
        } catch (e) {
          console.debug('Failed to fetch parent comment:', e);
        }
      }
      
      // Load parent author name
      if (parentComment?.pubkey) {
        try {
          const profile = await resolveProfileByPubkey(parentComment.pubkey, $ndk);
          parentDisplayName = formatDisplayName(profile);
        } catch {
          parentDisplayName = '@Anonymous';
        }
      }
      parentLoading = false;
    } else {
      parentLoading = false;
    }

    // Load likes
    const likeSub = $ndk.subscribe({
      kinds: [7],
      '#e': [event.id]
    });

    likeSub.on('event', (e) => {
      if (processedLikes.has(e.id)) return;
      processedLikes.add(e.id);
      if (e.pubkey === $userPublickey) liked = true;
      likeCount++;
      likesLoading = false;
    });

    likeSub.on('eose', () => {
      likesLoading = false;
    });

    // Load zaps
    loadZaps();
  });

  onDestroy(() => {
    if (zapSubscription) {
      zapSubscription.stop();
    }
  });

  // Like comment
  async function toggleLike() {
    if (liked || !$userPublickey) return;

    try {
      const reactionEvent = new NDKEvent($ndk);
      reactionEvent.kind = 7;
      reactionEvent.content = '+';
      reactionEvent.tags = [
        ['e', event.id, '', 'reply'],
        ['p', event.pubkey]
      ];
      addClientTagToEvent(reactionEvent);
      await reactionEvent.publish();
      liked = true;
      likeCount++;
    } catch {
      // Failed to like
    }
  }

  // Post reply
  async function postReply() {
    if (!replyText.trim() || postingReply) return;

    postingReply = true;
    try {
      const ev = new NDKEvent($ndk);
      ev.kind = 1;
      ev.content = replyText.trim();
      ev.tags = [
        ['e', mainEventId, '', 'root'],
        ['e', event.id, '', 'reply'],
        ['p', event.pubkey]
      ];
      addClientTagToEvent(ev);
      await ev.publish();
      replyText = '';
      showReplyBox = false;
      refresh();
    } catch {
      // Failed to post reply
    } finally {
      postingReply = false;
    }
  }

  // Open zap modal
  function openZapModal() {
    zapModalOpen = true;
  }

  // Truncate content for parent quote
  function truncateContent(content: string, maxLength: number = 100): string {
    const cleaned = content
      .replace(/https?:\/\/[^\s]+/g, '[link]')
      .replace(/nostr:[^\s]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength).trim() + '...';
  }
</script>

<div class="comment-card">
  <!-- Embedded parent quote (if replying to another comment) -->
  {#if !parentLoading && parentComment}
    <div class="parent-quote">
      <div class="parent-quote-header">
        <CustomAvatar pubkey={parentComment.pubkey} size={16} />
        <span class="parent-quote-author">{parentDisplayName || 'Loading...'}</span>
      </div>
      <p class="parent-quote-content">{truncateContent(parentComment.content)}</p>
    </div>
  {/if}

  <!-- Main comment row -->
  <div class="comment-row">
    <!-- Avatar -->
    <a href="/user/{nip19.npubEncode(event.pubkey)}" class="comment-avatar">
      <CustomAvatar className="rounded-full" pubkey={event.pubkey} size={32} />
    </a>

    <!-- Content -->
    <div class="comment-content">
      <!-- Name + Time -->
      <div class="comment-header">
        <a href="/user/{nip19.npubEncode(event.pubkey)}" class="comment-author">
          {#if isLoading}
            <span class="animate-pulse">Loading...</span>
          {:else}
            {displayName}
          {/if}
        </a>
        <span class="comment-time">
          {formatDate(new Date((event.created_at || 0) * 1000))}
        </span>
      </div>

      <!-- Comment Text -->
      <div class="comment-body">
        <NoteContent content={event.content} />
      </div>

      <!-- Actions -->
      <div class="comment-actions">
        <!-- Like Button -->
        <button
          on:click={toggleLike}
          class="action-btn"
          class:text-red-500={liked}
          disabled={!$userPublickey}
        >
          <HeartIcon size={14} weight={liked ? 'fill' : 'regular'} />
          {#if !likesLoading && likeCount > 0}
            <span>{likeCount}</span>
          {/if}
        </button>

        <!-- Zap Button -->
        {#if $userPublickey}
          <button
            on:click={openZapModal}
            class="action-btn zap-btn"
            class:text-yellow-500={hasUserZapped}
          >
            <LightningIcon size={14} weight={hasUserZapped ? 'fill' : 'regular'} />
            {#if totalZapAmount > 0}
              <span>{formatAmount(totalZapAmount / 1000)}</span>
            {/if}
          </button>
        {:else}
          <span class="action-btn zap-display">
            <LightningIcon size={14} class={totalZapAmount > 0 ? 'text-yellow-500' : ''} />
            {#if totalZapAmount > 0}
              <span>{formatAmount(totalZapAmount / 1000)}</span>
            {/if}
          </span>
        {/if}

        <!-- Reply Button -->
        {#if $userPublickey}
          <button
            on:click={() => (showReplyBox = !showReplyBox)}
            class="action-btn action-btn-text"
          >
            {showReplyBox ? 'Cancel' : 'Reply'}
          </button>
        {/if}
      </div>

      <!-- Inline Reply Box -->
      {#if showReplyBox}
        <div class="reply-form">
          <textarea
            bind:value={replyText}
            placeholder="Add a reply..."
            class="reply-textarea"
            rows="2"
          />
          <div class="reply-buttons">
            <button
              on:click={postReply}
              disabled={!replyText.trim() || postingReply}
              class="btn-post"
            >
              {postingReply ? 'Posting...' : 'Post'}
            </button>
            <button
              on:click={() => {
                showReplyBox = false;
                replyText = '';
              }}
              class="btn-cancel"
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Zap Modal -->
{#if zapModalOpen}
  <ZapModal bind:open={zapModalOpen} {event} />
{/if}

<style>
  /* Comment card - full width, no nesting */
  .comment-card {
    width: 100%;
  }

  /* Parent quote embed */
  .parent-quote {
    margin-bottom: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--color-input);
    border-left: 3px solid var(--color-primary, #f97316);
    border-radius: 0.375rem;
  }

  .parent-quote-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    margin-bottom: 0.25rem;
  }

  .parent-quote-author {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .parent-quote-content {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    line-height: 1.4;
    margin: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Comment row - 2 column flex layout */
  .comment-row {
    display: flex;
    gap: 0.5rem;
  }

  @media (min-width: 640px) {
    .comment-row {
      gap: 0.75rem;
    }
  }

  /* Avatar - fixed width */
  .comment-avatar {
    flex: 0 0 auto;
    width: 32px;
  }

  /* Content - takes remaining width */
  .comment-content {
    flex: 1 1 0%;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Header - wraps on mobile */
  .comment-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    margin-bottom: 0.25rem;
  }

  .comment-author {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .comment-author:hover {
    text-decoration: underline;
  }

  .comment-time {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* Body text */
  .comment-body {
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Actions */
  .comment-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.75rem;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--color-text-primary);
    transition: color 0.15s;
  }

  .action-btn:hover {
    color: var(--color-primary);
  }

  .action-btn-text {
    font-weight: 500;
  }

  .zap-btn:hover {
    color: #eab308; /* yellow-500 */
  }

  .zap-display {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--color-text-secondary);
  }

  /* Reply form */
  .reply-form {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .reply-textarea {
    width: 100%;
    padding: 0.375rem 0.5rem;
    font-size: 0.875rem;
    border-radius: 0.5rem;
    resize: none;
    background: var(--color-input);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
  }

  .reply-textarea:focus {
    outline: none;
    ring: 2px;
    ring-color: var(--color-primary);
  }

  .reply-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .btn-post {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: white;
    background: var(--color-primary);
    border-radius: 0.5rem;
  }

  .btn-post:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-cancel {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-primary);
    background: var(--color-input);
    border-radius: 0.5rem;
  }

  .btn-cancel:hover {
    opacity: 0.8;
  }
</style>
