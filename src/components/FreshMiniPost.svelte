<script lang="ts">
  /**
   * A compact post for special cards: photo (when it has one), a few lines
   * or its title, the author and "Shared … ago". The whole tile links to
   * the post (or the recipe / article page).
   */
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { optimizeImageUrl, getOptimalFormat } from '$lib/imageOptimizer';
  import { eventToArticleData } from '$lib/articleUtils';
  import { stripQuotedNoteReferences } from '$lib/feed/noteContent';
  import type { RelayEvent } from '$lib/freshFeed/relay';
  import {
    contentWithoutMedia,
    isImageUrl,
    mediaUrls,
    noteHref,
    postKind
  } from '$lib/freshFeed/posts';
  import { sharedAgo } from '$lib/freshFeed/recipeBoxCard';
  import Avatar from './Avatar.svelte';
  import AuthorName from './AuthorName.svelte';

  export let raw: RelayEvent;
  export let event: NDKEvent;
  /** A wider tile (memory cards) shows more text. */
  export let wide = false;

  $: kind = postKind(raw);
  $: tag = (k: string) => raw.tags.find((t) => t[0] === k)?.[1]?.trim() || '';
  $: image = tag('image') || mediaUrls(raw.content || '').find((u) => isImageUrl(u)) || '';
  $: title = kind === 'recipe' || kind === 'article' ? tag('title') : '';
  $: text = title ? tag('summary') : snippet(raw.content || '');
  $: href = link(raw, kind);
  let imageFailed = false;

  function snippet(content: string): string {
    let c = content;
    try {
      c = stripQuotedNoteReferences(c);
    } catch {
      // keep it as is
    }
    return contentWithoutMedia(c)
      .replace(/nostr:(npub|nprofile|note|nevent|naddr)1[0-9a-z]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function link(e: RelayEvent, k: string): string | null {
    if (k === 'recipe') {
      const d = e.tags.find((t) => t[0] === 'd')?.[1];
      if (d === undefined) return null;
      try {
        return `/recipe/${nip19.naddrEncode({ identifier: d, kind: e.kind, pubkey: e.pubkey })}`;
      } catch {
        return null;
      }
    }
    if (k === 'article') return eventToArticleData(event, true)?.articleUrl ?? null;
    return noteHref(e.id);
  }
</script>

<a href={href ?? undefined} class="mini" class:wide>
  {#if image && !imageFailed}
    <span class="mini-photo">
      <img
        src={optimizeImageUrl(image, { width: 480, quality: 80, format: getOptimalFormat() })}
        alt=""
        loading="lazy"
        decoding="async"
        on:error={() => (imageFailed = true)}
      />
    </span>
  {/if}
  <span class="mini-body">
    {#if title}<span class="mini-title">{title}</span>{/if}
    {#if text}<span class="mini-text" class:clamp-more={!image || imageFailed}>{text}</span>{/if}
    <span class="mini-meta">
      <Avatar pubkey={raw.pubkey} size={20} showRing={false} interactive={false} />
      <AuthorName {event} className="mini-author" interactive={false} />
      <span class="mini-age">· {sharedAgo(raw.created_at)}</span>
    </span>
  </span>
</a>

<style>
  .mini {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    border-radius: 0.75rem;
    background: var(--color-bg-primary);
    border: 1px solid var(--box-edge);
    color: var(--color-text-primary);
    transition: transform 0.2s;
  }

  .mini:hover {
    transform: translateY(-1px);
  }

  /* The frame sets the size (4:3); a tall photo can't stretch the tile. */
  .mini-photo {
    position: relative;
    display: block;
    flex-shrink: 0;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    background: var(--box-chip);
  }

  .mini-photo img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mini-body {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.625rem 0.75rem 0.75rem;
    flex: 1;
    min-width: 0;
  }

  .mini-title {
    font-weight: 700;
    font-size: 0.9rem;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .mini-text {
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--color-text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .mini-text.clamp-more {
    -webkit-line-clamp: 5;
    line-clamp: 5;
  }

  .wide .mini-text {
    -webkit-line-clamp: 4;
    line-clamp: 4;
  }

  .mini-meta {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: auto;
    font-size: 0.75rem;
    color: var(--color-caption);
    min-width: 0;
  }

  .mini-meta :global(.mini-author) {
    font-weight: 600;
    font-size: 0.75rem;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .mini-age {
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
