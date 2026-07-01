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
  import ClientAttribution from '../ClientAttribution.svelte';
  import NoteContent from '../NoteContent.svelte';
  import ReplyComposer from './ReplyComposer.svelte';
  import ThreadCommentActions from '../ThreadCommentActions.svelte';
  import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';
  import { resolveProfileByPubkey, formatDisplayName } from '$lib/profileResolver';
  import { getAnonChefName } from '$lib/anonName';
  import { onMount, createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

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

  // Variant-indexed avatar sizes (CSS font sizes are now unified across variants).
  const sizes = {
    recipe: { avatar: 40 },
    feed: { avatar: 32 }
  } as const;
  const s = sizes[variant];

  // True when any sibling comment is a direct reply to this one — drives
  // the vertical thread line below this card's avatar.
  $: hasReplies = allComments.some(
    (c) => c.id !== event.id && c.getMatchingTags('e').some((t) => t[1] === event.id)
  );

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

  onMount(async () => {
    if (event.pubkey && $ndk) {
      try {
        const profile = await resolveProfileByPubkey(event.pubkey, $ndk);
        // formatDisplayName(null) returns the GENERIC 'Anon Chef' since
        // it has no pubkey to hash. We DO have event.pubkey here, so
        // short-circuit the null-profile case to get the stable
        // per-pubkey name (e.g. "Sat Chef") instead. Profiles with a
        // name field still flow through formatDisplayName.
        displayName = profile ? formatDisplayName(profile) : getAnonChefName(event.pubkey);
      } catch (error) {
        displayName = getAnonChefName(event.pubkey);
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
          // Same pubkey-aware short-circuit as the event-author branch
          // above — null profile → stable anon-chef name, not the
          // generic "Anon Chef".
          parentDisplayName = profile
            ? formatDisplayName(profile)
            : getAnonChefName(parentComment.pubkey);
        } catch {
          parentDisplayName = getAnonChefName(parentComment.pubkey);
        }
      }
      parentLoading = false;
    } else {
      parentLoading = false;
    }

  });


  function setReplyBox(open: boolean) {
    showReplyBox = open;
    dispatch(open ? 'replyopen' : 'replyclose');
  }

  function handleReplyPosted() {
    setReplyBox(false);
  }

  // Anon users see a "Sign in to reply" link styled as the Reply button.
  // Preserves redirect-to-thread post-login.
  let loginRedirectHref = '';
  $: loginRedirectHref = `/login?redirect=${encodeURIComponent($page.url.pathname)}`;

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
  <div class="comment-card comment-card--{variant}" class:nested={!parentLoading && parentComment !== null}>
    <!-- Replying-to indicator + indent for nested replies -->
    {#if !parentLoading && parentComment}
      <div class="reply-to-indicator">
        Replying to <a
          href="/user/{nip19.npubEncode(parentComment.pubkey)}"
          class="reply-to-name"
          on:click|stopPropagation
        >{parentDisplayName || '...'}</a>
      </div>
    {/if}

    <!-- Main comment row -->
    <div class="comment-row">
      <!-- Avatar column: avatar + optional thread line to children -->
      <div class="avatar-col">
        <a href="/user/{nip19.npubEncode(event.pubkey)}" class="comment-avatar">
          <svelte:component
            this={AvatarComp}
            className="rounded-full"
            pubkey={event.pubkey}
            size={s.avatar}
          />
        </a>
        {#if hasReplies}
          <div class="thread-line"></div>
        {/if}
      </div>

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
          <ClientAttribution tags={event.tags} enableEnrichment={false} />
        </div>

        <!-- Comment Text -->
        <div class="comment-body">
          <NoteContent content={event.content} />
        </div>

        <!-- Actions -->
        <div class="comment-actions">
          <ThreadCommentActions {event} compact={variant === 'feed'} showReplyButton={false} />

          <!-- Reply button (signed in) or sign-in link (anon) — both variants. -->
          {#if $userPublickey}
            <button
              type="button"
              on:click={() => setReplyBox(!showReplyBox)}
              class="reply-btn"
            >
              <ChatCircleIcon size={variant === 'feed' ? 16 : 18} weight="regular" />
              <span>{showReplyBox ? 'Cancel' : 'Reply'}</span>
            </button>
          {:else}
            <a href={loginRedirectHref} class="reply-btn">
              <ChatCircleIcon size={variant === 'feed' ? 16 : 18} weight="regular" />
              <span>Sign in to reply</span>
            </a>
          {/if}
        </div>

        <!-- Inline Reply Composer -->
        {#if showReplyBox}
          <div class="mt-2 p-3 rounded-lg" style="background-color: var(--color-bg-secondary)">
            <p class="text-xs text-caption mb-3">Replying to <span class="font-medium" style="color: var(--color-text-primary)">{displayName}</span></p>
            <div class="flex gap-3 items-start">
              <div class="flex-shrink-0">
                <CustomAvatar pubkey={$userPublickey} size={32} />
              </div>
              <div class="flex-1 min-w-0 -mt-3">
                <ReplyComposer
                  parentEvent={rootEvent}
                  replyTo={event}
                  placeholder="Write a reply..."
                  submitLabel="Reply"
                  showCancel
                  onPosted={handleReplyPosted}
                  on:cancel={() => setReplyBox(false)}
                />
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>

{/if}

<style>
  /* ── Layout (shared) ──────────────────────────────────────────────── */

  .comment-card {
    width: 100%;
    padding: 0.5rem 0;
  }

  /* Recipe comments render as sunken cards (a shade darker than the page),
     matching the note-thread reply treatment. */
  .comment-card--recipe {
    background-color: var(--color-card-sunken);
    border-radius: 0.5rem;
    padding: 0.875rem 1rem;
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

  /* Avatar column: stacks avatar above the optional thread line */
  .avatar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 0 0 auto;
  }

  .comment-avatar {
    flex: 0 0 auto;
  }

  /* Vertical thread line that runs from the parent avatar down to the
     bottom of its card, meeting the border-left of the first nested reply */
  .thread-line {
    flex: 1;
    width: 2px;
    background-color: var(--color-input-border);
    margin-top: 4px;
    border-radius: 1px;
    min-height: 0.5rem;
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
    font-size: 0.875rem;
    font-weight: 600;
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

  .comment-body {
    font-size: 1rem;
    line-height: 1.6;
    margin-bottom: 0.5rem;
    color: var(--color-text-primary);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .comment-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .reply-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    color: var(--color-caption);
    transition: background-color 0.15s, color 0.15s;
    cursor: pointer;
  }

  .reply-btn:hover {
    background-color: var(--color-input);
    color: var(--color-text-primary);
  }

  /* ── Nested reply indentation ───────────────────────────────────── */
  /* margin-left = avatar-center so border-left aligns with the thread */
  /* line drawn below the parent avatar, creating one continuous line. */
  /* padding-left bridges from the border to the content start.        */

  .comment-card--feed.nested {
    margin-left: 1rem;     /* 16px = center of 32px avatar */
    border-left: 2px solid var(--color-input-border);
    padding-left: 1.375rem; /* 22px → content at 16+2+22 = 40px = parent content start */
  }

  /* Nested recipe replies indent as sunken cards; the indent conveys nesting
     so no border-left thread line is needed inside the card. */
  .comment-card--recipe.nested {
    margin-left: 1.5rem;
    padding-left: 1rem;
  }
  .comment-card--recipe .thread-line {
    display: none;
  }

  /* ── Replying-to indicator ──────────────────────────────────────── */

  .reply-to-indicator {
    font-size: 0.75rem;
    color: var(--color-caption);
    margin-bottom: 0.25rem;
  }

  .reply-to-name {
    color: var(--color-primary, #f97316);
  }

  .reply-to-name:hover {
    text-decoration: underline;
  }

  /* ── Variant modifiers — avatar width only (typography is now unified) */

  .comment-card--recipe .comment-avatar {
    width: 40px;
  }
  .comment-card--feed .comment-avatar {
    width: 32px;
  }

</style>
