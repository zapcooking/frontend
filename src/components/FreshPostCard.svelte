<script lang="ts">
  /**
   * One Fresh post with OnlyFood's card chrome (parity table rows 1–22):
   * header, "…" menu, reply/quote context, content, media + lightbox, the
   * Cheffy photo wrapper, reaction and zap pills, like / comment / repost /
   * zap, the "who zapped / liked" drawer and the inline comment thread.
   * Recipes and articles get the same header, menu and engagement row
   * around their cards (decision C); recipes add "Save to cookbook".
   *
   * Engagement components mount only once the post is near the screen
   * (`visible`), as in OnlyFood. Everything here reads and writes through
   * $ndk — the reader's own relays — not the feed relay.
   */
  import { createEventDispatcher } from 'svelte';
  import { goto } from '$app/navigation';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import { isReply, getParentNoteId, fetchReplyContext } from '$lib/replyContext';
  import { stripQuotedNoteReferences } from '$lib/feed/noteContent';
  import { eventToArticleData } from '$lib/articleUtils';
  import { optimizeImageUrl, getOptimalFormat } from '$lib/imageOptimizer';
  import { imetaAltByUrl } from '$lib/feed/imeta';
  import type { RelayEvent } from '$lib/freshFeed/relay';
  import type { EngagementData as ShareEngagementData } from '$lib/shareNoteImage';
  import {
    postKind,
    formatTimeAgo,
    mediaUrls,
    contentWithoutMedia,
    isImageUrl,
    getQuotedNoteId,
    noteHref
  } from '$lib/freshFeed/posts';
  import Avatar from './Avatar.svelte';
  import AuthorName from './AuthorName.svelte';
  import ClientAttribution from './ClientAttribution.svelte';
  import PowBadge from './PowBadge.svelte';
  import PostActionsMenu from './PostActionsMenu.svelte';
  import FreshMenuItems from './FreshMenuItems.svelte';
  import NoteContent from './NoteContent.svelte';
  import MediaCarousel from './MediaCarousel.svelte';
  import CheffyMediaReview from './CheffyMediaReview.svelte';
  import PollDisplay from './PollDisplay.svelte';
  import RecipeCard from './RecipeCard.svelte';
  import ArticleCard from './ArticleCard.svelte';
  import SaveButton from './SaveButton.svelte';
  import NoteReactionPills from './NoteReactionPills.svelte';
  import NoteTotalZaps from './NoteTotalZaps.svelte';
  import NoteTotalLikes from './NoteTotalLikes.svelte';
  import NoteTotalComments from './NoteTotalComments.svelte';
  import NoteRepost from './NoteRepost.svelte';
  import PostEngagementToggle from './PostEngagementToggle.svelte';
  import PostEngagementDrawer from './PostEngagementDrawer.svelte';
  import CommentThread from './comments/CommentThread.svelte';

  export let raw: RelayEvent;
  export let event: NDKEvent;
  /** Near the screen: mount engagement. */
  export let visible = false;
  export let expanded = false;
  /** A line above the card ("From the recipe box"). */
  export let label: string | null = null;
  /** Registers this card for lazy engagement loading (the feed's observer). */
  export let lazy: (node: HTMLElement, id: string) => { destroy(): void };

  const dispatch = createEventDispatcher<{
    zap: NDKEvent;
    share: { url: string; event: NDKEvent };
    downloadImage: { event: NDKEvent; engagementData: ShareEngagementData };
    openImage: { images: { url: string; alt: string }[]; index: number };
    toggleEngagement: string;
    report: RelayEvent;
    error: string;
  }>();

  $: kind = postKind(raw);
  $: media = kind === 'note' ? mediaUrls(raw.content) : [];
  $: alts = imetaAltByUrl(event);
  $: reply = kind === 'note' && isReply(event);
  $: parentId = reply ? getParentNoteId(event) : null;
  $: quotedId = kind === 'note' && !reply ? getQuotedNoteId(raw) : null;
  $: text =
    kind === 'note' ? contentWithoutMedia(quotedId ? safeStrip(raw.content) : raw.content) : '';
  $: article = kind === 'article' ? eventToArticleData(event, true) : null;

  function safeStrip(content: string): string {
    try {
      return stripQuotedNoteReferences(content);
    } catch {
      return content || '';
    }
  }

  function optimized(url: string): string {
    return optimizeImageUrl(url, { width: 640, quality: 85, format: getOptimalFormat() });
  }

  function openMedia(url: string) {
    const images = media.filter((u) => isImageUrl(u));
    const index = images.indexOf(url);
    dispatch('openImage', {
      images: images.map((u) => ({ url: u, alt: alts.get(u) || '' })),
      index: index >= 0 ? index : 0
    });
  }

  // From FoodstrFeedOptimized: open the note unless a control was clicked
  // or text is being selected. Recipe and article cards link on their own.
  function gotoNote(e: MouseEvent) {
    if (kind === 'recipe' || kind === 'article') return;
    if (
      e.target instanceof Element &&
      e.target.closest('a, button, input, textarea, [role="button"], [data-stop-card-navigation]')
    ) {
      return;
    }
    if (window.getSelection()?.toString()) return;
    const href = noteHref(raw.id);
    if (href) goto(href);
  }

  function displayName(name: string): string {
    return name.startsWith('npub') ? name.substring(0, 12) + '...' : name;
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-to-interactive-role a11y-no-noninteractive-tabindex -->
<article
  class="fresh-post w-full {kind === 'note' || kind === 'poll' ? 'cursor-pointer' : ''}"
  on:click={gotoNote}
  role={kind === 'note' || kind === 'poll' ? 'link' : undefined}
  tabindex={kind === 'note' || kind === 'poll' ? 0 : undefined}
  on:keydown|self={(e) => {
    if (e.key === 'Enter' && (kind === 'note' || kind === 'poll')) {
      const href = noteHref(raw.id);
      if (href) goto(href);
    }
  }}
>
  {#if label}
    <p class="text-xs font-medium mb-3" style="color: var(--color-caption)">{label}</p>
  {/if}
  <div class="flex items-center justify-between mb-3">
    <div class="flex items-center space-x-3 flex-1 min-w-0">
      <a href="/user/{nip19.npubEncode(raw.pubkey)}" class="flex-shrink-0">
        <Avatar pubkey={raw.pubkey} size={40} />
      </a>
      <div class="flex items-center space-x-2 flex-wrap min-w-0">
        <AuthorName {event} className="font-semibold text-sm truncate min-w-0" />
        <span class="text-sm flex-shrink-0" style="color: var(--color-caption)">·</span>
        <span class="text-sm whitespace-nowrap flex-shrink-0" style="color: var(--color-caption)">
          {formatTimeAgo(raw.created_at)}
        </span>
        <ClientAttribution tags={raw.tags} enableEnrichment={false} />
        <PowBadge id={raw.id} tags={raw.tags} />
      </div>
    </div>
    <div class="flex-shrink-0 ml-2">
      <PostActionsMenu
        {event}
        on:share={(e) => dispatch('share', { url: e.detail.url, event })}
        on:downloadImage={(e) => dispatch('downloadImage', e.detail)}
      >
        <svelte:fragment slot="extra" let:close>
          <FreshMenuItems
            post={raw}
            canBookmark={kind !== 'recipe'}
            {close}
            on:report={(e) => dispatch('report', e.detail)}
            on:error={(e) => dispatch('error', e.detail)}
          />
        </svelte:fragment>
      </PostActionsMenu>
    </div>
  </div>

  {#if kind === 'recipe'}
    <div class="mb-3">
      <RecipeCard {event} />
    </div>
  {:else if kind === 'article'}
    {#if article}
      <div class="mb-3">
        <ArticleCard
          {event}
          imageUrl={article.imageUrl}
          title={article.title}
          preview={article.preview}
          readTime={article.readTimeMinutes}
          tags={article.tags}
          articleUrl={article.articleUrl}
          showBookmark={false}
        />
      </div>
    {/if}
  {:else}
    {#if parentId}
      {@const href = noteHref(parentId)}
      {#if href}
        {#await fetchReplyContext($ndk, parentId)}
          <div class="parent-quote-embed mb-3">
            <div class="parent-quote-loading">
              <div class="w-4 h-4 bg-accent-gray rounded-full animate-pulse"></div>
              <div class="h-3 bg-accent-gray rounded w-20 animate-pulse"></div>
            </div>
          </div>
        {:then context}
          <a
            {href}
            class="parent-quote-embed mb-3 block hover:opacity-90 transition-opacity"
            on:click|stopPropagation
          >
            <div class="parent-quote-header">
              {#if context.authorPubkey}
                <Avatar pubkey={context.authorPubkey} size={16} />
              {/if}
              <span class="parent-quote-author">
                {#if context.error === 'deleted'}
                  <span class="italic">deleted note</span>
                {:else if context.error}
                  a note
                {:else}
                  {displayName(context.authorName)}
                {/if}
              </span>
            </div>
            {#if context.notePreview && !context.error}
              <p class="parent-quote-content">{context.notePreview}</p>
            {/if}
            <span class="parent-quote-link"> View full thread → </span>
          </a>
        {:catch}
          <a {href} class="parent-quote-embed mb-3 block">
            <div class="parent-quote-header">
              <span class="parent-quote-author">Replying to a note</span>
            </div>
          </a>
        {/await}
      {/if}
    {/if}

    {#if kind === 'poll'}
      <PollDisplay {event} />
    {:else if text}
      <div class="text-sm leading-relaxed mb-3" style="color: var(--color-text-primary)">
        <NoteContent content={text} />
      </div>
    {/if}

    {#if quotedId}
      {@const href = noteHref(quotedId)}
      {#if href}
        {#await fetchReplyContext($ndk, quotedId)}
          <div class="parent-quote-embed mb-3">
            <div class="parent-quote-loading">
              <div class="w-4 h-4 bg-accent-gray rounded-full animate-pulse"></div>
              <div class="h-3 bg-accent-gray rounded w-20 animate-pulse"></div>
            </div>
          </div>
        {:then context}
          <a
            {href}
            class="parent-quote-embed mb-3 block hover:opacity-90 transition-opacity"
            on:click|stopPropagation
          >
            <div class="parent-quote-header">
              {#if context.authorPubkey}
                <Avatar pubkey={context.authorPubkey} size={16} />
              {/if}
              <span class="parent-quote-author">
                {#if context.error === 'deleted'}
                  <span class="italic">deleted note</span>
                {:else if context.error}
                  a note
                {:else}
                  {displayName(context.authorName)}
                {/if}
              </span>
            </div>
            {#if context.notePreview && !context.error}
              <p class="parent-quote-content">{context.notePreview}</p>
            {/if}
            <span class="parent-quote-link"> View quoted note → </span>
          </a>
        {:catch}
          <a {href} class="parent-quote-embed mb-3 block">
            <div class="parent-quote-header">
              <span class="parent-quote-author">Quoting a note</span>
            </div>
          </a>
        {/await}
      {/if}
    {/if}

    {#if media.length > 0}
      <div class="mb-3">
        <CheffyMediaReview {event}>
          <MediaCarousel
            items={media}
            optimizeUrl={optimized}
            altByUrl={alts}
            onItemClick={(url) => openMedia(url)}
          />
        </CheffyMediaReview>
      </div>
    {/if}
  {/if}

  {#if visible}
    <NoteReactionPills {event} />
    <NoteTotalZaps
      {event}
      onZapClick={() => dispatch('zap', event)}
      showPills={true}
      onlyPills={true}
      maxPills={10}
    />
  {/if}

  <div class="flex items-center justify-between flex-wrap gap-2 py-1" use:lazy={raw.id}>
    <div class="flex items-center space-x-1 flex-shrink-0">
      {#if visible}
        <div class="hover:bg-accent-gray rounded-full p-1.5 transition-colors">
          <NoteTotalLikes {event} />
        </div>
        <div class="hover:bg-accent-gray rounded-full p-1.5 transition-colors">
          <NoteTotalComments {event} />
        </div>
        <div class="hover:bg-accent-gray rounded-full p-1.5 transition-colors">
          <NoteRepost {event} />
        </div>
        <div class="hover:bg-amber-50/50 rounded-full p-1 transition-colors">
          <NoteTotalZaps {event} onZapClick={() => dispatch('zap', event)} showPills={false} />
        </div>
        {#if kind === 'recipe'}
          <SaveButton {event} size="sm" variant="ghost" />
        {/if}
      {:else}
        <span class="text-caption p-1.5 opacity-40">♡</span>
        <span class="text-caption p-1.5 opacity-40">💬</span>
        <span class="text-caption p-1.5 opacity-40">🔁</span>
        <span class="text-caption p-1.5 opacity-40">⚡</span>
      {/if}
    </div>
    {#if visible}
      <div class="ml-auto flex items-center gap-0.5">
        <PostEngagementToggle {expanded} on:toggle={() => dispatch('toggleEngagement', raw.id)} />
      </div>
    {/if}
  </div>

  {#if visible}
    <PostEngagementDrawer {event} open={expanded} />
    <CommentThread variant="feed" {event} />
  {/if}
</article>

<style>
  /* From FoodstrFeedOptimized: each post on a sunken card. */
  .fresh-post {
    padding: 1.125rem 1.25rem;
    background-color: var(--color-card-sunken);
    border-radius: 1rem;
    --media-bleed-x: 1.25rem;
  }

  .parent-quote-embed {
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
    font-size: 0.9375rem;
    color: var(--color-text-primary);
    line-height: 1.5;
    margin: 0 0 0.375rem 0;
    overflow-wrap: anywhere;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .parent-quote-link {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    opacity: 0.75;
  }

  .parent-quote-loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
