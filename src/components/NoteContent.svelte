<script lang="ts">
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import ProfileLink from './ProfileLink.svelte';
  import NoteEmbed from './NoteEmbed.svelte';
  import LinkPreview from './LinkPreview.svelte';
  import VideoPreview from './VideoPreview.svelte';
  import { processContentWithProfiles } from '$lib/contentProcessor';
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  export let content: string;
  export let className: string = '';
  export let showLinkPreviews: boolean = true;
  export let embedDepth: number = 0; // Track nesting depth to prevent infinite recursion
  export let collapsible: boolean = true; // Enable collapsible long content
  export let maxLength: number = 500; // Character limit before collapse

  let isExpanded: boolean = false;

  // Image modal state
  let imageModalOpen = false;
  let selectedImageUrl = '';
  let allImageUrls: string[] = [];
  let selectedImageIndex = 0;

  function openImageModal(imageUrl: string, index: number) {
    selectedImageUrl = imageUrl;
    selectedImageIndex = index;
    imageModalOpen = true;
  }

  function closeImageModal() {
    imageModalOpen = false;
    selectedImageUrl = '';
    selectedImageIndex = 0;
  }

  function nextModalImage() {
    if (allImageUrls.length <= 1) return;
    selectedImageIndex = (selectedImageIndex + 1) % allImageUrls.length;
    selectedImageUrl = allImageUrls[selectedImageIndex];
  }

  function prevModalImage() {
    if (allImageUrls.length <= 1) return;
    selectedImageIndex =
      selectedImageIndex === 0 ? allImageUrls.length - 1 : selectedImageIndex - 1;
    selectedImageUrl = allImageUrls[selectedImageIndex];
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!imageModalOpen) return;
    if (e.key === 'Escape') closeImageModal();
    else if (e.key === 'ArrowLeft') prevModalImage();
    else if (e.key === 'ArrowRight') nextModalImage();
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

  function isBlockPart(part?: { type?: string; prefix?: string; url?: string }) {
    if (!part?.type) return false;
    if (part.type === 'nostr') {
      // nevent1, note1, and naddr1 are all block-level embedded content
      return part.prefix === 'nevent1' || part.prefix === 'note1' || part.prefix === 'naddr1';
    }
    if (part.type === 'url') {
      if (!part.url) return false;
      return isImageUrl(part.url) || isVideoUrl(part.url) || showLinkPreviews;
    }
    return false;
  }

  // Parse content and create clickable links for URLs, hashtags, and nostr references
  function parseContent(text: string) {
    // Include naddr1 for addressable events (recipes, long-form content)
    const urlRegex =
      /(https?:\/\/[^\s]+)|nostr:(nevent1|note1|npub1|nprofile1|naddr1)([023456789acdefghjklmnpqrstuvwxyz]+)/g;
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
      const [fullMatch, url, nostrPrefix, nostrData] = match;
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
  $: displayContent = shouldCollapse && !isExpanded ? content.substring(0, maxLength) : content;
  $: finalParsedContent = parseContent(displayContent);

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
  {#each finalParsedContent as part, i}
    {#if part.type === 'text'}<span>{part.content}</span>
    {:else if part.type === 'hashtag'}
      <button
        class="hashtag-pill inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer"
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
      {:else if part.url && isVideoUrl(part.url)}
        <VideoPreview url={part.url} />
      {:else if showLinkPreviews && part.url}
        <LinkPreview url={part.url} />
      {:else}
        <a
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          class="text-blue-500 hover:text-blue-700 hover:underline break-all"
        >
          {part.content}
        </a>
      {/if}
    {:else if part.type === 'nostr'}
      {#if part.prefix === 'nprofile1' || part.prefix === 'npub1'}
        <ProfileLink
          nostrString={part.content}
          colorClass="text-orange-500 hover:text-orange-600"
        />
      {:else if part.prefix === 'nevent1' || part.prefix === 'note1'}
        <NoteEmbed nostrString={part.content} depth={embedDepth} />
      {:else if part.prefix === 'naddr1'}
        <!-- Addressable event (recipe, article, etc.) - render as embedded content -->
        <NoteEmbed nostrString={part.content} depth={embedDepth} />
      {:else}
        <button
          class="text-blue-500 hover:text-blue-700 hover:underline cursor-pointer"
          on:click={() => handleNostrClick(part.content)}
        >
          {part.content}
        </button>
      {/if}
    {/if}
  {/each}

  {#if shouldCollapse}
    <button
      on:click={toggleExpanded}
      class="mt-2 text-sm font-medium transition-colors inline-flex items-center gap-1"
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
  {/if}
</div>

<!-- Image Modal -->
<svelte:window on:keydown={handleKeydown} />

{#if imageModalOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
    on:click={closeImageModal}
    role="dialog"
    aria-modal="true"
  >
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div
      class="relative bg-input rounded-lg shadow-2xl max-w-4xl max-h-[90vh] overflow-hidden"
      on:click|stopPropagation
    >
      <!-- Close button -->
      <button
        class="absolute top-2 right-2 bg-input hover:bg-accent-gray rounded-full p-2 shadow-md transition z-10"
        style="color: var(--color-text-primary)"
        on:click={closeImageModal}
        aria-label="Close image"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      {#if allImageUrls.length > 1}
        <!-- Image counter -->
        <div
          class="absolute top-2 left-2 bg-black/60 text-white text-sm px-3 py-1.5 rounded-full z-10"
        >
          {selectedImageIndex + 1} / {allImageUrls.length}
        </div>

        <!-- Previous button -->
        <button
          on:click|stopPropagation={prevModalImage}
          class="absolute left-2 top-1/2 -translate-y-1/2 bg-input/90 hover:bg-input rounded-full p-2 shadow-md transition z-10"
          style="color: var(--color-text-primary)"
          aria-label="Previous image"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>

        <!-- Next button -->
        <button
          on:click|stopPropagation={nextModalImage}
          class="absolute right-2 top-1/2 -translate-y-1/2 bg-input/90 hover:bg-input rounded-full p-2 shadow-md transition z-10"
          style="color: var(--color-text-primary)"
          aria-label="Next image"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      {/if}

      <img
        src={selectedImageUrl}
        alt="Full size preview"
        class="w-full h-auto max-h-[90vh] object-contain"
      />
    </div>
  </div>
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
