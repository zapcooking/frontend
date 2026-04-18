<script lang="ts">
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { ndk, userPublickey } from '$lib/nostr';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import Avatar from './Avatar.svelte';
  import ZapModal from './ZapModal.svelte';
  import ReplyComposer from './comments/ReplyComposer.svelte';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import { formatAmount } from '$lib/utils';
  import { addClientTagToEvent } from '$lib/nip89';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import NoteContent from './NoteContent.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { extractZapAmountSats } from '$lib/zapAmount';

  export let event: NDKEvent;
  export let allReplies: NDKEvent[] = []; // All replies for finding parent
  export let refresh: () => void;
  /**
   * The root event (recipe) passed down from the Comments container. Used by
   * the inline reply composer to build NIP-22 tags with the correct root-scope.
   */
  export let rootEvent: NDKEvent;

  // Display state
  let displayName = '';
  let isLoading = true;

  // Parent comment state (for embedded quote)
  let parentComment: NDKEvent | null = null;
  let parentDisplayName = '';
  let parentLoading = true;

  // Reply box state — the composer itself owns everything inside the form.
  let showReplyBox = false;

  // Like state
  let liked = false;
  let likeCount = 0;
  let likesLoading = true;
  let processedLikes = new Set();
  let likeSubscription: any = null;

  // Zap state
  let zapModalOpen = false;
  let totalZapAmount = 0;
  let hasUserZapped = false;
  let processedZaps = new Set<string>();
  let zapSubscription: any = null;

  // Find parent comment ID (if replying to another comment)
  function getParentCommentId(): string | null {
    const eTags = event.getMatchingTags('e');
    // Look for a 'reply' tag
    const replyTag = eTags.find((tag) => tag[3] === 'reply');
    if (replyTag) {
      // Check if this reply tag points to another comment (not the root recipe)
      const parentEventTag = eTags.find((tag) => tag[3] !== 'reply' && tag[3] !== 'root');
      if (parentEventTag) return parentEventTag[1];

      // Check if the reply tag points to something we can find in allReplies
      if (allReplies.some((r) => r.id === replyTag[1])) {
        return replyTag[1];
      }
    }
    return null;
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
      // First check in allReplies
      parentComment = allReplies.find((c) => c.id === parentId) || null;

      // If not found locally, fetch it with timeout
      if (!parentComment && $ndk) {
        try {
          const fetchPromise = $ndk.fetchEvent({
            kinds: [1, 1111] as any,
            ids: [parentId]
          });
          const timeoutPromise = new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 5000)
          );
          parentComment = await Promise.race([fetchPromise, timeoutPromise]);
        } catch (e) {
          console.debug('Failed to fetch parent comment:', e);
        }
      }

      // Load parent author name (resolveProfileByPubkey already has timeout)
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
    likeSubscription = $ndk.subscribe({
      kinds: [7],
      '#e': [event.id]
    });

    likeSubscription.on('event', (e: NDKEvent) => {
      if (processedLikes.has(e.id)) return;
      processedLikes.add(e.id);
      if (e.pubkey === $userPublickey) liked = true;
      likeCount++;
      likesLoading = false;
    });

    likeSubscription.on('eose', () => {
      likesLoading = false;
    });

    // Load zaps
    loadZaps();
  });

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

      const { sats } = extractZapAmountSats(zapEvent);
      if (sats <= 0) return;

      totalZapAmount += sats;
      processedZaps.add(zapEvent.sig);

      if (zapEvent.tags.some((tag) => tag[0] === 'P' && tag[1] === $userPublickey)) {
        hasUserZapped = true;
      }
    });
  }

  // Like comment
  async function toggleLike() {
    if (liked || !$userPublickey) return;

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
  }

  function handleReplyPosted() {
    showReplyBox = false;
    refresh();
  }

  onDestroy(() => {
    if (likeSubscription) {
      likeSubscription.stop();
    }
    if (zapSubscription) {
      zapSubscription.stop();
    }
  });

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
        <Avatar pubkey={parentComment.pubkey} size={16} />
        <span class="parent-quote-author">{parentDisplayName || 'Loading...'}</span>
      </div>
      <p class="parent-quote-content">{truncateContent(parentComment.content)}</p>
    </div>
  {/if}

  <!-- Main comment row -->
  <div class="comment-row">
    <!-- Avatar -->
    <a href="/user/{nip19.npubEncode(event.pubkey)}" class="comment-avatar">
      <Avatar className="rounded-full" pubkey={event.pubkey} size={40} />
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
          <HeartIcon size={16} weight={liked ? 'fill' : 'regular'} />
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
            <LightningIcon size={16} weight={hasUserZapped ? 'fill' : 'regular'} />
            {#if totalZapAmount > 0}
              <span>{formatAmount(totalZapAmount)}</span>
            {/if}
          </button>
        {:else}
          <span class="action-btn zap-display">
            <LightningIcon size={16} class={totalZapAmount > 0 ? 'text-yellow-500' : ''} />
            {#if totalZapAmount > 0}
              <span>{formatAmount(totalZapAmount)}</span>
            {/if}
          </span>
        {/if}

        <!-- Reply Button -->
        <button on:click={() => (showReplyBox = !showReplyBox)} class="action-btn action-btn-text">
          {showReplyBox ? 'Cancel' : 'Reply'}
        </button>
      </div>

      <!-- Inline Reply Composer -->
      {#if showReplyBox}
        <ReplyComposer
          parentEvent={rootEvent}
          replyTo={event}
          placeholder="Add a reply..."
          signingStrategy="explicit-with-timeout"
          onErrorStrategy="alert"
          compact
          showCancel
          onPosted={handleReplyPosted}
          on:cancel={() => (showReplyBox = false)}
        />
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
    width: 40px;
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
    font-size: 1rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .comment-author:hover {
    text-decoration: underline;
  }

  .comment-time {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  /* Body text */
  .comment-body {
    font-size: 1rem;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Actions */
  .comment-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 0.875rem;
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
</style>
