<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import ProfileLink from './ProfileLink.svelte';
  import NoteEmbed from './NoteEmbed.svelte';
  import NofferButton from './clink/NofferButton.svelte';
  import LinkPreview from './LinkPreview.svelte';
  import VideoPreview from './VideoPreview.svelte';
  import TwitterEmbed from './TwitterEmbed.svelte';
  import YouTubeEmbed from './YouTubeEmbed.svelte';
  import MediaCarousel from './MediaCarousel.svelte';
  import { processContentWithProfiles } from '$lib/contentProcessor';
  import MediaLightbox from './MediaLightbox.svelte';
  import LightningInvoiceCard from './LightningInvoiceCard.svelte';

  export let content: string;
  export let className: string = '';
  export let showLinkPreviews: boolean = true;
  export let showNostrEmbeds: boolean = true;
  export let embedDepth: number = 0; // Track nesting depth to prevent infinite recursion
  export let collapsible: boolean = true; // Enable collapsible long content
  export let maxLength: number = 500; // Character limit before collapse

  let isExpanded: boolean = false;

  // Image modal state — navigation, keyboard, and swipe live inside
  // MediaLightbox.
  let imageModalOpen = false;
  let allImageUrls: string[] = [];
  let selectedImageIndex = 0;

  function openImageModal(_imageUrl: string, index: number) {
    selectedImageIndex = index;
    imageModalOpen = true;
  }

  function closeImageModal() {
    imageModalOpen = false;
    selectedImageIndex = 0;
  }

  // Extract all image URLs from parsed content for navigation
  function extractImageUrls(parts: any[]): string[] {
    return parts
      .filter((part) => part.type === 'url' && part.url && isImageUrl(part.url))
      .map((part) => part.url);
  }

  // Update allImageUrls when content changes
  $: allImageUrls = extractImageUrls(finalParsedContent);

  // Image extensions to detect
  const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
  const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i;

  function isImageUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      // Check extension
      if (IMAGE_EXTENSIONS.test(urlObj.pathname)) return true;
      // Check common image hosting patterns
      if (urlObj.hostname.includes('image.nostr.build')) return true;
      if (urlObj.hostname.includes('nostr.build') && urlObj.pathname.includes('/i/')) return true;
      if (urlObj.hostname.includes('imgur.com')) return true;
      if (urlObj.hostname.includes('imgproxy')) return true;
      if (urlObj.hostname.includes('primal.b-cdn.net')) return true;
      if (urlObj.hostname.includes('media.tenor.com')) return true;
      if (urlObj.hostname.includes('i.ibb.co')) return true;
      return false;
    } catch {
      return false;
    }
  }

  function isVideoUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return VIDEO_EXTENSIONS.test(urlObj.pathname);
    } catch {
      return false;
    }
  }

  function handleImageError(e: Event) {
    const target = e.target as HTMLImageElement;
    if (target) target.style.display = 'none';
  }

  // x.com/USER/status/ID or twitter.com/USER/status/ID, tolerating a
  // trailing /photo/1, /video/1, or query string.
  const TWITTER_STATUS_RE =
    /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/\d+/i;
  const isTwitterStatus = (url?: string): boolean => !!url && TWITTER_STATUS_RE.test(url);

  // Parse a start-time token (?t= / &start=) into seconds. Accepts a bare
  // number ("90") or a duration ("1m30s", "1h2m3s").
  function parseYouTubeStart(t: string | null): number {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m || !m[0]) return 0;
    return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  }

  // Extract a YouTube video id (+ optional start offset) from the common URL
  // shapes: youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID,
  // /live/ID, /v/ID. Returns null for anything that isn't a YouTube video.
  function parseYouTube(url: string): { id: string; start: number } | null {
    let u: URL;
    try {
      // Notes sometimes carry HTML-escaped query separators (`&amp;t=`);
      // unescape them so searchParams sees `t`/`start` rather than `amp;t`.
      u = new URL(url.replace(/&amp;/g, '&'));
    } catch {
      return null;
    }
    const host = u.hostname.replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') {
      id = u.pathname.slice(1).split('/')[0];
    } else if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      if (u.pathname === '/watch') {
        id = u.searchParams.get('v') || '';
      } else {
        const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
        if (m) id = m[1];
      }
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return { id, start: parseYouTubeStart(u.searchParams.get('t') || u.searchParams.get('start')) };
  }

  const isYouTube = (url?: string): boolean => !!url && parseYouTube(url) !== null;

  function isMediaPart(part?: { type?: string; url?: string }): boolean {
    return Boolean(
      part?.type === 'url' && part.url && (isImageUrl(part.url) || isVideoUrl(part.url))
    );
  }

  // Collapse runs of consecutive media URLs (ignoring the whitespace
  // between them) into a single `media-gallery` part so they render as
  // a swipeable carousel instead of a vertical stack. Lone media items
  // keep their inline rendering.
  function groupMediaRuns(parts: any[]): any[] {
    const out: any[] = [];
    let i = 0;
    while (i < parts.length) {
      const part = parts[i];
      if (isMediaPart(part)) {
        const urls: string[] = [part.url];
        let j = i + 1;
        while (j < parts.length) {
          const next = parts[j];
          if (isMediaPart(next)) {
            urls.push(next.url);
            j++;
            continue;
          }
          // Swallow whitespace-only text that sits between two media
          // URLs (typically the newline separating pasted links).
          if (
            next.type === 'text' &&
            next.content.trim() === '' &&
            isMediaPart(parts[j + 1])
          ) {
            j++;
            continue;
          }
          break;
        }
        if (urls.length > 1) {
          out.push({ type: 'media-gallery', urls, key: `gallery-${part.key ?? i}` });
          i = j;
          continue;
        }
      }
      out.push(part);
      i++;
    }
    return out;
  }

  function isBlockPart(part?: { type?: string; prefix?: string; url?: string }) {
    if (!part?.type) return false;
    if (part.type === 'nostr') {
      // nevent1, note1, and naddr1 are all block-level embedded content
      return part.prefix === 'nevent1' || part.prefix === 'note1' || part.prefix === 'naddr1';
    }
    if (part.type === 'url') {
      if (!part.url) return false;
      return isImageUrl(part.url) || isVideoUrl(part.url) || isYouTube(part.url) || showLinkPreviews;
    }
    return false;
  }

  // Parse content and create clickable links for URLs, hashtags, and nostr references
  function parseContent(text: string) {
    // Include naddr1 for addressable events (recipes, long-form content).
    // noffer1 (CLINK static offers) is detected both as a bare token and with
    // the optional `nostr:` prefix — when present we render an inline "⚡ Pay"
    // pill (NofferButton) instead of treating it as plain text.
    const urlRegex =
      /(https?:\/\/[^\s]+)|nostr:(nevent1|note1|npub1|nprofile1|naddr1|noffer1)([023456789acdefghjklmnpqrstuvwxyz]+)|\b(noffer1)([023456789acdefghjklmnpqrstuvwxyz]{6,})/g;
    const hashtagRegex = /#[\w]+/g;

    const parts = [];
    let lastIndex = 0;
    let match;
    let keyCounter = 0;

    // First find URLs and nostr references
    const urlMatches: Array<{
      index: number;
      content: string;
      type: 'url' | 'nostr';
      url?: string;
      prefix?: string;
      data?: string;
    }> = [];
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(text)) !== null) {
      const [fullMatch, url, nostrPrefix, nostrData, bareNofferPrefix, bareNofferData] = match;
      if (url) {
        urlMatches.push({
          index: match.index,
          content: fullMatch,
          type: 'url',
          url: url
        });
      } else if (nostrPrefix && nostrData) {
        urlMatches.push({
          index: match.index,
          content: fullMatch,
          type: 'nostr',
          prefix: nostrPrefix,
          data: nostrData
        });
      } else if (bareNofferPrefix && bareNofferData) {
        // Bare `noffer1…` (no `nostr:` prefix) — treat the same as a
        // nostr:noffer1 reference so the downstream renderer surfaces a
        // Pay button.
        urlMatches.push({
          index: match.index,
          content: fullMatch,
          type: 'nostr',
          prefix: bareNofferPrefix,
          data: bareNofferData
        });
      }
    }

    // Helper to check if index is inside a URL/nostr reference
    function isInUrl(index: number): boolean {
      return urlMatches.some((m) => index >= m.index && index < m.index + m.content.length);
    }

    // Find all hashtags (excluding those inside URLs)
    const hashtagMatches: Array<{ index: number; content: string }> = [];
    hashtagRegex.lastIndex = 0;
    while ((match = hashtagRegex.exec(text)) !== null) {
      // Only include hashtag if it's not inside a URL
      if (!isInUrl(match.index)) {
        hashtagMatches.push({
          index: match.index,
          content: match[0]
        });
      }
    }

    // Combine and sort all matches by index
    const allMatches = [
      ...hashtagMatches.map((m) => ({ ...m, type: 'hashtag' as const })),
      ...urlMatches
    ].sort((a, b) => a.index - b.index);

    // Process matches in order
    for (const match of allMatches) {
      // Add text before this match
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: text.substring(lastIndex, match.index),
          key: `text-${keyCounter++}`
        });
      }

      if (match.type === 'hashtag') {
        parts.push({
          type: 'hashtag',
          content: match.content,
          key: `hashtag-${keyCounter++}`
        });
      } else if (match.type === 'url') {
        parts.push({
          type: 'url',
          content: match.content,
          url: match.url,
          key: `url-${keyCounter++}`
        });
      } else if (match.type === 'nostr') {
        parts.push({
          type: 'nostr',
          content: match.content,
          prefix: match.prefix,
          data: match.data,
          key: `nostr-${keyCounter++}`
        });
      }

      lastIndex = match.index + match.content.length;
    }

    // Add any remaining text
    if (lastIndex < text.length) {
      parts.push({
        type: 'text',
        content: text.substring(lastIndex),
        key: `text-${keyCounter++}`
      });
    }

    // If no matches, return the whole text as a single part
    if (parts.length === 0) {
      parts.push({
        type: 'text',
        content: text,
        key: `text-${keyCounter++}`
      });
    }

    return parts;
  }

  function handleHashtagClick(hashtag: string) {
    // Navigate to tag page (remove #)
    const tag = hashtag.slice(1);
    goto(`/tag/${tag}`);
  }

  function handleNostrClick(nostrId: string) {
    // Navigate to the nostr reference
    goto(`/${nostrId}`);
  }

  $: parsedContent = parseContent(content);

  // Check if content should be collapsed
  $: shouldCollapse = collapsible && content.length > maxLength;
  // Truncate the preview at a word boundary so we never slice through a word.
  // If a URL straddles the limit, extend to include the whole URL instead, so
  // its file extension survives and isImageUrl() classifies it correctly.
  function truncateAtUrlBoundary(text: string, limit: number): string {
    const urlRegex = /https?:\/\/[^\s]+/g;
    let m;
    while ((m = urlRegex.exec(text)) !== null) {
      if (m.index < limit && m.index + m[0].length > limit) {
        return text.substring(0, m.index + m[0].length);
      }
    }
    // Back up to the last whitespace before the limit so the cut lands between
    // words, not mid-word.
    const cut = text.substring(0, limit);
    const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
    return (boundary > 0 ? cut.substring(0, boundary) : cut).trimEnd();
  }
  $: displayContent = shouldCollapse && !isExpanded ? truncateAtUrlBoundary(content, maxLength) : content;
  $: finalParsedContent = splitLightningInvoices(parseContent(displayContent));
  $: renderParts = groupMediaRuns(finalParsedContent);

  const LIGHTNING_REGEX = /(?:(?:lightning|nostr):)?((lnbc|lntb|lnbcrt)[a-z0-9]{50,})/gi;

  function splitLightningInvoices(parts: any[]): any[] {
    const out: any[] = [];
    let keyCounter = 0;
    for (const part of parts) {
      if (part.type !== 'text') { out.push(part); continue; }
      LIGHTNING_REGEX.lastIndex = 0;
      const text: string = part.content;
      let last = 0;
      let m;
      while ((m = LIGHTNING_REGEX.exec(text)) !== null) {
        if (m.index > last) {
          out.push({ type: 'text', content: text.slice(last, m.index), key: `text-ln-${keyCounter++}` });
        }
        out.push({ type: 'lightning', invoice: m[0].replace(/^(?:lightning|nostr):/i, ''), key: `ln-${keyCounter++}` });
        last = m.index + m[0].length;
      }
      if (last === 0) {
        // No invoice matched — keep the original text part untouched.
        out.push(part);
      } else if (last < text.length) {
        // Trailing text after the final match.
        out.push({ type: 'text', content: text.slice(last), key: `text-ln-${keyCounter++}` });
      }
    }
    return out;
  }

  // Preload profiles when content changes
  $: if (content) {
    processContentWithProfiles(content);
  }

  function toggleExpanded() {
    isExpanded = !isExpanded;
  }
</script>

<div
  class="whitespace-pre-wrap break-words note-content {className} w-full"
  style="white-space: pre-wrap;"
>
  {#each renderParts as part, i}
    {#if part.type === 'text'}<span>{part.content}</span>
    {:else if part.type === 'media-gallery'}
      <!-- Consecutive media URLs render as a swipeable carousel:
           peeking 4:5 tiles with a count badge. -->
      <div class="my-1">
        <MediaCarousel
          items={part.urls}
          onItemClick={(url) => {
            const index = allImageUrls.indexOf(url);
            openImageModal(url, index >= 0 ? index : 0);
          }}
        />
      </div>
    {:else if part.type === 'hashtag'}
      <button
        class="hashtag-pill inline-flex items-center px-2 py-0.5 rounded-full font-medium transition-colors cursor-pointer"
        on:click={() => handleHashtagClick(part.content)}
      >
        {part.content}
      </button>
    {:else if part.type === 'url'}
      {#if part.url && isImageUrl(part.url)}
        {@const imageUrl = part.url || ''}
        {@const imageIndex = allImageUrls.indexOf(imageUrl)}
        <div class="my-1">
          <button
            class="block cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
            on:click={() => openImageModal(imageUrl, imageIndex >= 0 ? imageIndex : 0)}
          >
            <img
              src={part.url}
              alt=""
              class="max-w-full rounded-lg max-h-96 object-contain hover:opacity-95 transition-opacity"
              loading="lazy"
              on:error={handleImageError}
            />
          </button>
        </div>
      {:else if part.url && isYouTube(part.url)}
        {@const yt = parseYouTube(part.url)}
        {#if yt}
          <YouTubeEmbed videoId={yt.id} start={yt.start} />
        {/if}
      {:else if part.url && isVideoUrl(part.url)}
        <VideoPreview url={part.url} />
      {:else if part.url && isTwitterStatus(part.url)}
        <TwitterEmbed tweetUrl={part.url} />
      {:else if showLinkPreviews && part.url}
        <LinkPreview url={part.url} />
      {:else}
        <a
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          class="text-orange-500 hover:text-orange-600 hover:underline break-all"
        >
          {part.content}
        </a>
      {/if}
    {:else if part.type === 'nostr'}
      {#if part.prefix === 'nprofile1' || part.prefix === 'npub1'}
        <ProfileLink
          nostrString={part.content}
          colorClass="text-orange-500 hover:text-orange-600"
          fallbackToRaw={false}
        />
      {:else if part.prefix === 'nevent1' || part.prefix === 'note1'}
        {#if showNostrEmbeds}
          <NoteEmbed nostrString={part.content} depth={embedDepth} />
        {/if}
      {:else if part.prefix === 'naddr1'}
        <!-- Addressable event (recipe, article, etc.) - render as embedded content -->
        {#if showNostrEmbeds}
          <NoteEmbed nostrString={part.content} depth={embedDepth} />
        {/if}
      {:else if part.prefix === 'noffer1'}
        <!-- CLINK static offer — render an inline "⚡ Pay" pill that opens
             NofferPayModal. Matches the bxrd.app affordance. -->
        <NofferButton noffer={part.content} />
      {:else}
        <button
          class="text-orange-500 hover:text-orange-600 hover:underline cursor-pointer"
          on:click={() => handleNostrClick(part.content)}
        >
          {part.content}
        </button>
      {/if}
    {:else if part.type === 'lightning'}
      <LightningInvoiceCard invoice={part.invoice} />
    {/if}
  {/each}

  {#if shouldCollapse}
    <div class="mt-3 flex justify-center">
      <button
        on:click={toggleExpanded}
        class="text-sm font-medium transition-colors inline-flex items-center gap-1"
        style="color: var(--color-primary);"
      >
        {isExpanded ? 'View less' : 'View more'}
        <svg
          class="w-4 h-4 transition-transform {isExpanded ? 'rotate-180' : ''}"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  {/if}
</div>

<!-- Image Modal -->
{#if imageModalOpen}
  <MediaLightbox
    images={allImageUrls}
    bind:index={selectedImageIndex}
    onClose={closeImageModal}
  />
{/if}

<style>
  /* First block element gets more top margin */
  .note-content :global(> div:first-of-type),
  .note-content :global(> a:first-of-type) {
    margin-top: 0.5rem;
  }

  /* Reduce space between consecutive block elements */
  .note-content :global(> div + div),
  .note-content :global(> a + div),
  .note-content :global(> div + a) {
    margin-top: 0.125rem;
  }

  /* Hashtag pill - light mode (default) */
  .hashtag-pill {
    background-color: rgb(255 247 237); /* bg-orange-50 */
    color: rgb(234 88 12); /* text-orange-600 */
  }
  .hashtag-pill:hover {
    background-color: rgb(249 115 22); /* bg-orange-500 */
    color: white;
  }

  /* Hashtag pill - dark mode */
  :global(html.dark) .hashtag-pill {
    background-color: rgb(55 48 45); /* dark brownish-gray */
    color: rgb(251 146 60); /* text-orange-400 */
  }
  :global(html.dark) .hashtag-pill:hover {
    background-color: rgb(234 88 12); /* bg-orange-600 */
    color: white;
  }
</style>
