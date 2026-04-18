<script lang="ts">
  /**
   * CommentCard — unified renderer for a single comment in a thread.
   *
   * Consolidates the pre-Stage-4 Comment.svelte (recipe context) and
   * FeedComment.svelte (feed context). `variant` drives sizing, typography,
   * the avatar component, the root-level mute filter, and anon reply-button
   * gating. Everything else — likes, zaps, parent-quote rendering, and
   * ReplyComposer wiring — is shared.
   *
   * Pure structural consolidation: Stage 4 has no bug fixes of its own.
   * Tag-building unification landed in Stage 2 (buildNip22CommentTags
   * handles both P/p); posting-state reset landed in Stage 3 (ReplyComposer's
   * try/finally). Stage 4 is structural consolidation on top of a foundation
   * that's already spec-compliant.
   */
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { page } from '$app/stores';
  import { ndk, userPublickey } from '$lib/nostr';
  import { mutedPubkeys } from '$lib/muteListStore';
  import { nip19 } from 'nostr-tools';
  import { format as formatDate } from 'timeago.js';
  import Avatar from '../Avatar.svelte';
  import CustomAvatar from '../CustomAvatar.svelte';
  import NoteContent from '../NoteContent.svelte';
  import ZapModal from '../ZapModal.svelte';
  import ReplyComposer from './ReplyComposer.svelte';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import { formatAmount } from '$lib/utils';
  import { addClientTagToEvent } from '$lib/nip89';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { onMount, onDestroy } from 'svelte';
  import { extractZapAmountSats } from '$lib/zapAmount';

  /** The comment event rendered by this card. */
  export let event: NDKEvent;

  /**
   * Visual + behavioral variant.
   *   - 'recipe': 40px avatar with membership-ring (Avatar component),
   *     1rem body font, no mute filter, Reply button always shown.
   *   - 'feed':   32px avatar (CustomAvatar, no membership badge),
   *     0.875rem body, mute-filter hides whole card when author is muted,
   *     Reply button only shown to logged-in users.
   */
  export let variant: 'recipe' | 'feed';

  /**
   * Root event of the thread (recipe or feed post). Passed to ReplyComposer
   * as `parentEvent` so nested-reply tag-building carries the correct
   * root scope, and used for parent-detection to distinguish nested
   * replies from top-level comments.
   */
  export let rootEvent: NDKEvent;

  /**
   * All sibling comments in the thread. Used when this comment's e-tags
   * indicate a nested reply, to resolve the parent comment's id to an
   * actual event without a network fetch when possible.
   */
  export let allComments: NDKEvent[] = [];

  // Variant-indexed scalar props (passed as JS numbers, not CSS).
  const sizes = {
    recipe: { avatar: 40, parentQuoteAvatar: 16, actionIcon: 16 },
    feed: { avatar: 32, parentQuoteAvatar: 16, actionIcon: 14 }
  } as const;
  const s = sizes[variant];

  // Avatar / CustomAvatar both accept the pubkey/size/className subset
  // we need, so we swap the component rather than branch with {#if}.
  const AvatarComp = variant === 'recipe' ? Avatar : CustomAvatar;

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

  /**
   * Unified parent-comment detection. Merges the pre-Stage-4 strategies:
   *  - Prefer an explicit 'reply'-markered e-tag that doesn't point at the root.
   *  - Fallback: e-tags that aren't root-markered AND aren't the root itself.
   *  - Among fallback candidates, prefer one whose id matches a currently
   *    visible comment (avoids a network fetch and disambiguates broken
   *    tag orderings); else take the last one (NIP-10 positional convention).
   */
  function getParentCommentId(): string | null {
    const rootId = rootEvent.id;
    const eTags = event.getMatchingTags('e');

    const replyMarker = eTags.find((t) => t[3] === 'reply' && t[1] !== rootId);
    if (replyMarker) return replyMarker[1];

    const candidates = eTags.filter((t) => t[3] !== 'root' && t[1] !== rootId);
    if (candidates.length === 0) return null;

    const matchInVisible = candidates.find((t) =>
      allComments.some((c) => c.id === t[1])
    );
    if (matchInVisible) return matchInVisible[1];

    return candidates[candidates.length - 1][1];
  }

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

  onMount(async () => {
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

    const parentId = getParentCommentId();
    if (parentId) {
      parentComment = allComments.find((c) => c.id === parentId) || null;

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

    // Likes subscription — default closeOnEose per pre-Stage-4 behaviour.
    // (Live-count staleness is tracked as a FOLLOWUPS item.)
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

    loadZaps();
  });

  onDestroy(() => {
    if (likeSubscription) likeSubscription.stop();
    if (zapSubscription) zapSubscription.stop();
  });

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
      // Failed to like — swallow. Reactions never surface errors to the user
      // in this app; only comment-post errors do (via ReplyComposer's toast).
    }
  }

  function handleReplyPosted() {
    showReplyBox = false;
  }

  // Anon users see a "Sign in to reply" link styled as the Reply button.
  // Preserves redirect-to-thread post-login.
  $: loginRedirectHref = `/login?redirect=${encodeURIComponent($page.url.pathname)}`;

  function openZapModal() {
    zapModalOpen = true;
  }

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

{#if variant !== 'feed' || !$mutedPubkeys.has(event.pubkey)}
  <div class="comment-card comment-card--{variant}">
    <!-- Embedded parent quote (if replying to another comment) -->
    {#if !parentLoading && parentComment}
      <div class="parent-quote">
        <div class="parent-quote-header">
          <svelte:component
            this={AvatarComp}
            pubkey={parentComment.pubkey}
            size={s.parentQuoteAvatar}
          />
          <span class="parent-quote-author">{parentDisplayName || 'Loading...'}</span>
        </div>
        <p class="parent-quote-content">{truncateContent(parentComment.content)}</p>
      </div>
    {/if}

    <!-- Main comment row -->
    <div class="comment-row">
      <!-- Avatar -->
      <a href="/user/{nip19.npubEncode(event.pubkey)}" class="comment-avatar">
        <svelte:component
          this={AvatarComp}
          className="rounded-full"
          pubkey={event.pubkey}
          size={s.avatar}
        />
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
            aria-label={liked ? 'Liked' : 'Like comment'}
          >
            <HeartIcon size={s.actionIcon} weight={liked ? 'fill' : 'regular'} />
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
              aria-label="Zap comment"
            >
              <LightningIcon size={s.actionIcon} weight={hasUserZapped ? 'fill' : 'regular'} />
              {#if totalZapAmount > 0}
                <span>{formatAmount(totalZapAmount)}</span>
              {/if}
            </button>
          {:else}
            <span class="action-btn zap-display">
              <LightningIcon
                size={s.actionIcon}
                class={totalZapAmount > 0 ? 'text-yellow-500' : ''}
              />
              {#if totalZapAmount > 0}
                <span>{formatAmount(totalZapAmount)}</span>
              {/if}
            </span>
          {/if}

          <!-- Reply button (signed in) or sign-in link (anon) — both variants. -->
          {#if $userPublickey}
            <button
              on:click={() => (showReplyBox = !showReplyBox)}
              class="action-btn action-btn-text"
            >
              {showReplyBox ? 'Cancel' : 'Reply'}
            </button>
          {:else}
            <a href={loginRedirectHref} class="action-btn action-btn-text">Sign in to reply</a>
          {/if}
        </div>

        <!-- Inline Reply Composer -->
        {#if showReplyBox}
          <ReplyComposer
            parentEvent={rootEvent}
            replyTo={event}
            placeholder="Add a reply..."
            compact
            showCancel
            onPosted={handleReplyPosted}
            on:cancel={() => (showReplyBox = false)}
          />
        {/if}
      </div>
    </div>
  </div>

  {#if zapModalOpen}
    <ZapModal bind:open={zapModalOpen} {event} />
  {/if}
{/if}

<style>
  /* ── Layout (shared) ──────────────────────────────────────────────── */

  .comment-card {
    width: 100%;
  }

  .comment-row {
    display: flex;
    gap: 0.5rem;
  }

  @media (min-width: 640px) {
    .comment-row {
      gap: 0.75rem;
    }
  }

  .comment-avatar {
    flex: 0 0 auto;
  }

  .comment-content {
    flex: 1 1 0%;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .comment-header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    margin-bottom: 0.25rem;
  }

  .comment-author {
    font-weight: 600;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .comment-author:hover {
    text-decoration: underline;
  }

  .comment-time {
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .comment-body {
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .comment-actions {
    display: flex;
    align-items: center;
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

  /* ── Parent-quote embed (shared sizing across variants) ─────────── */

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

  /* ── Variant modifiers — sizing & typography ─────────────────────── */

  .comment-card--recipe .comment-avatar {
    width: 40px;
  }
  .comment-card--feed .comment-avatar {
    width: 32px;
  }

  .comment-card--recipe .comment-author {
    font-size: 1rem;
  }
  .comment-card--feed .comment-author {
    font-size: 0.875rem;
  }

  .comment-card--recipe .comment-time {
    font-size: 0.875rem;
  }
  .comment-card--feed .comment-time {
    font-size: 0.75rem;
  }

  .comment-card--recipe .comment-body {
    font-size: 1rem;
  }
  .comment-card--feed .comment-body {
    font-size: 0.875rem;
  }

  .comment-card--recipe .comment-actions {
    gap: 1rem;
    font-size: 0.875rem;
  }
  .comment-card--feed .comment-actions {
    gap: 0.75rem;
    font-size: 0.75rem;
  }
</style>
