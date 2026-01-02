<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { browser } from '$app/environment';
  import { ndk } from '$lib/nostr';
  import CustomAvatar from './CustomAvatar.svelte';
  import AuthorName from './AuthorName.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { goto } from '$app/navigation';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import ClientAttribution from './ClientAttribution.svelte';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { decode } from '@gandlaf21/bolt11-decode';
  import { formatAmount } from '$lib/utils';
  import NoteContent from './NoteContent.svelte';

  export let nostrString: string;
  export let boostAmount: number = 0; // Optional boost amount in sats (passed from parent)
  export let depth: number = 0; // Prevent infinite recursion with nested embeds
  
  const MAX_EMBED_DEPTH = 2; // Maximum nesting depth for embedded content

  let event: NDKEvent | null = null;
  let loading = true;
  let error = false;
  let eventId = '';
  let naddrData: { identifier: string; pubkey: string; kind: number } | null = null;
  let fetchedBoostAmount = 0; // Fetched from zap receipts if not provided
  let boostFetchDone = false; // Prevent multiple boost fetches

  let subscription: any = null;
  let fetching = false;
  let previousNostrString = ''; // Track previous value to detect actual changes
  let isContentExpanded = true; // Default to expanded for kind 1 notes
  let contentLines: number = 0; // Track estimated line count

  // Extract event ID from nostr string (nevent) or naddr data - only when nostrString actually changes
  function parseNostrString(nostrStr: string) {
    // Clean up previous subscription
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
    
    // Reset state
    event = null;
    eventId = '';
    naddrData = null;
    error = false;
    loading = true;
    fetching = false;
    fetchedBoostAmount = 0;
    boostFetchDone = false;
    isContentExpanded = true; // Default to expanded for kind 1 notes
    contentLines = 0;
    
    try {
      const cleanString = nostrStr.replace(/^nostr:/, '');
      if (cleanString.startsWith('nevent1')) {
        const decoded = nip19.decode(cleanString);
        if (decoded.type === 'nevent') {
          eventId = decoded.data.id;
          naddrData = null;
        }
      } else if (cleanString.startsWith('naddr1')) {
        const decoded = nip19.decode(cleanString);
        if (decoded.type === 'naddr') {
          naddrData = {
            identifier: decoded.data.identifier,
            pubkey: decoded.data.pubkey,
            kind: decoded.data.kind || 30023
          };
          eventId = '';
        }
      } else {
        loading = false;
        error = true;
      }
    } catch (err) {
      console.error('Failed to decode nostr string:', err);
      error = true;
      loading = false;
      eventId = '';
      naddrData = null;
    }
  }

  // Only re-parse when nostrString actually changes
  $: if (nostrString !== previousNostrString) {
    previousNostrString = nostrString;
    parseNostrString(nostrString);
  }

  // Fetch event when eventId or naddrData changes and we're in browser
  $: if (browser && $ndk && (eventId || naddrData) && loading && !fetching) {
    fetchEvent();
  }

  async function fetchEvent() {
    if (!$ndk || (!eventId && !naddrData) || fetching || event) return;
    fetching = true;

    try {
      let filter: any;
      
      if (eventId) {
        // Fetch by event ID (nevent)
        filter = { ids: [eventId] };
      } else if (naddrData) {
        // Fetch by naddr (recipe/replaceable event)
        filter = {
          kinds: [naddrData.kind],
          '#d': [naddrData.identifier],
          authors: [naddrData.pubkey]
        };
      } else {
        loading = false;
        return;
      }

      subscription = $ndk.subscribe(filter, { closeOnEose: false });
      let resolved = false;

      subscription.on('event', (receivedEvent: NDKEvent) => {
        if (!event) {
          event = receivedEvent;
          loading = false;
          fetching = false;
          // Don't fetch boost here - wait for eose to avoid double fetch
        }
      });

      subscription.on('eose', () => {
        if (!resolved) {
          resolved = true;
          subscription.stop();
          subscription = null;
          fetching = false;
          if (!event) {
            error = true;
          }
          loading = false;
          // Fetch boost amount only once after event is loaded
          if (event) {
            fetchBoostAmount();
          }
        }
      });

      // Handle timeout - resolve with whatever we have
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          fetching = false;
          if (subscription) {
            subscription.stop();
            subscription = null;
          }
          if (!event) {
            error = true;
          }
          loading = false;
        }
      }, 5000);
    } catch (err) {
      console.error('Failed to fetch embedded event:', err);
      error = true;
      loading = false;
      fetching = false;
    }
  }

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
  });

  // Extract boost amount from Fountain boost events
  function extractBoostAmountFromEvent(boostEvent: NDKEvent): number {
    // Debug: log the event to see its structure
    const authorName = boostEvent.author?.profile?.name || boostEvent.pubkey?.slice(0, 8);
    if (authorName?.toLowerCase().includes('fountain') || boostEvent.content?.toLowerCase().includes('boost')) {
      console.log('[NoteEmbed] Potential boost event:', {
        author: authorName,
        content: boostEvent.content?.slice(0, 200),
        tags: boostEvent.tags
      });
    }

    // Check for amount in tags (some clients use this)
    const amountTag = boostEvent.tags.find((tag) => tag[0] === 'amount');
    if (amountTag?.[1]) {
      const amount = parseInt(amountTag[1], 10);
      if (!isNaN(amount) && amount > 0) {
        return amount / 1000; // Often in millisats
      }
    }

    // Check for bolt11 in tags
    const bolt11Tag = boostEvent.tags.find((tag) => tag[0] === 'bolt11');
    if (bolt11Tag?.[1]) {
      try {
        const decoded = decode(bolt11Tag[1]);
        const amountSection = decoded.sections.find((section) => section.name === 'amount');
        if (amountSection?.value) {
          const amount = Number(amountSection.value);
          if (!isNaN(amount) && amount > 0) {
            return amount / 1000; // Convert millisats to sats
          }
        }
      } catch {
        // Ignore decode errors
      }
    }

    // Check description tag for structured amount data only (not text patterns)
    const descTag = boostEvent.tags.find((tag) => tag[0] === 'description');
    if (descTag?.[1]) {
      try {
        const descData = JSON.parse(descTag[1]);
        // Look for amount in parsed JSON description only
        if (descData.amount) {
          const amount = parseInt(descData.amount, 10);
          if (!isNaN(amount) && amount > 0) {
            return amount / 1000;
          }
        }
      } catch {
        // Not JSON - don't try to extract from text content
        // to avoid duplicating amounts already shown in note content
      }
    }

    // Don't extract from content text - it causes duplication when
    // the note content itself mentions sats amounts
    return 0;
  }

  // Fetch zaps for this event to get boost amount
  async function fetchBoostAmount() {
    // Prevent duplicate fetches
    if (boostFetchDone) return;
    boostFetchDone = true;
    
    const idToUse = event?.id || eventId;
    if (!idToUse || !$ndk || boostAmount > 0) return;

    // First check if the embedded event itself contains boost info (Fountain style)
    if (event) {
      const eventAmount = extractBoostAmountFromEvent(event);
      if (eventAmount > 0) {
        fetchedBoostAmount = eventAmount;
        return;
      }
    }

    try {
      const zapFilter = {
        kinds: [9735],
        '#e': [idToUse],
        limit: 50
      };

      // Add timeout to prevent hanging
      const fetchPromise = $ndk.fetchEvents(zapFilter);
      const timeoutPromise = new Promise<Set<any>>((resolve) => 
        setTimeout(() => resolve(new Set()), 5000)
      );
      const zapEvents = await Promise.race([fetchPromise, timeoutPromise]);
      let totalAmount = 0;

      for (const zapEvent of zapEvents) {
        const bolt11 = zapEvent.tags.find((tag) => tag[0] === 'bolt11')?.[1];
        if (!bolt11) continue;

        try {
          const decoded = decode(bolt11);
          const amountSection = decoded.sections.find((section) => section.name === 'amount');
          if (amountSection?.value) {
            const amount = Number(amountSection.value);
            if (!isNaN(amount) && amount > 0) {
              totalAmount += amount / 1000; // Convert millisats to sats
            }
          }
        } catch {
          // Ignore decode errors
        }
      }

      if (totalAmount > 0) {
        fetchedBoostAmount = totalAmount;
      }
    } catch (err) {
      console.error('Failed to fetch boost amount:', err);
    }
  }

  // Display amount (prefer passed prop, fallback to fetched)
  $: displayBoostAmount = boostAmount > 0 ? boostAmount : fetchedBoostAmount;

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }

  function getNoteUrl(): string | null {
    if (!event) return null;
    
    // Check if it's a recipe (kind 30023)
    if (event.kind === 30023) {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      if (dTag && event.author?.hexpubkey) {
        try {
          const naddr = nip19.naddrEncode({
            identifier: dTag,
            kind: 30023,
            pubkey: event.author.hexpubkey
          });
          return `/recipe/${naddr}`;
        } catch (e) {
          console.warn('Failed to encode recipe naddr:', e);
        }
      }
    }
    
    // For regular notes, use noteEncode
    try {
      const noteId = nip19.noteEncode(event.id);
      return `/${noteId}`;
    } catch (e) {
      console.warn('Failed to encode note ID:', e);
      return null;
    }
  }

  function handleCardClick() {
    const url = getNoteUrl();
    if (url) {
      goto(url);
    }
  }

  function getImageUrls(event: NDKEvent): string[] {
    // Extract image URLs from event content (not tags)
    const content = event.content || '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = content.match(urlRegex) || [];
    
    // Filter for image and video URLs
    return urls.filter(url => isImageUrl(url) || isVideoUrl(url));
  }

  function isImageUrl(url: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
    const lowercaseUrl = url.toLowerCase();
    return imageExtensions.some(ext => lowercaseUrl.includes(ext));
  }

  function isVideoUrl(url: string): boolean {
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];
    const lowercaseUrl = url.toLowerCase();
    return videoExtensions.some(ext => lowercaseUrl.includes(ext)) ||
           lowercaseUrl.includes('youtube.com') || 
           lowercaseUrl.includes('youtu.be') ||
           lowercaseUrl.includes('vimeo.com');
  }

  function getContentWithoutMedia(content: string): string {
    // Remove image and video URLs from content to avoid duplication
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return content.replace(urlRegex, (url) => {
      // Only remove URLs that are images or videos
      if (isImageUrl(url) || isVideoUrl(url)) {
        return '';
      }
      return url; // Keep other URLs (like marketplace links)
    }).replace(/\s+/g, ' ').trim(); // Clean up extra spaces
  }

  function handleImageError(e: Event) {
    const target = e.target;
    if (target && 'style' in target) {
      (target as any).style.display = 'none';
    }
  }

  function handleVideoError(e: Event) {
    const target = e.target;
    if (target && 'style' in target) {
      (target as any).style.display = 'none';
    }
  }

  // Estimate line count for content (rough approximation)
  function estimateLineCount(content: string, containerWidth: number = 400): number {
    if (!content) return 0;
    // Rough estimation: ~50-70 characters per line depending on font size
    // Using 60 as average for text-sm (14px font)
    const charsPerLine = 60;
    const lines = Math.ceil(content.length / charsPerLine);
    return lines;
  }

  // Toggle expanded state
  function toggleExpanded() {
    isContentExpanded = !isContentExpanded;
  }
</script>

{#if loading}
  <div class="rounded-lg p-4 animate-pulse" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border)">
    <div class="flex space-x-3">
      <div class="w-8 h-8 rounded-full skeleton-bg"></div>
      <div class="flex-1">
        <div class="h-4 rounded w-1/4 mb-2 skeleton-bg"></div>
        <div class="h-3 rounded w-1/6 mb-2 skeleton-bg"></div>
        <div class="h-3 rounded w-full skeleton-bg"></div>
      </div>
    </div>
  </div>
{:else if error}
  <div class="border border-red-200 rounded-lg p-4 bg-red-50 dark:bg-red-900/20 dark:border-red-800">
    <p class="text-red-600 dark:text-red-400 text-sm">Failed to load embedded note</p>
    <p class="text-xs mt-1" style="color: var(--color-caption)">{nostrString}</p>
  </div>
{:else if event}
  <button
    type="button"
    class="w-full rounded-lg overflow-hidden transition-colors note-embed-card hover:opacity-90 cursor-pointer text-left"
    style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border)"
    on:click={handleCardClick}
    on:keydown={(e) => e.key === 'Enter' && handleCardClick()}
  >
    <div class="flex gap-3 p-3">
      <!-- Avatar -->
      <a 
        href="/user/{nip19.npubEncode(event.author.hexpubkey)}" 
        class="flex-shrink-0"
        on:click|stopPropagation
      >
        <CustomAvatar
          className="cursor-pointer"
          pubkey={event.author.hexpubkey}
          size={40}
        />
      </a>

      <!-- Content -->
      <div class="flex-1 min-w-0 leading-tight">
        <!-- Header -->
        <div class="flex items-center space-x-2 flex-wrap mb-2">
          <AuthorName {event} />
          <span class="text-sm" style="color: var(--color-caption)">·</span>
          <span class="text-sm" style="color: var(--color-caption)">
            {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
          </span>
          <ClientAttribution tags={event.tags} enableEnrichment={false} />
        </div>

        <!-- Boost amount inline -->
        {#if displayBoostAmount > 0}
          <div class="flex items-center gap-1 text-yellow-500 font-semibold text-sm mb-2">
            <LightningIcon size={14} weight="fill" />
            <span>{formatAmount(displayBoostAmount)} sats boost</span>
          </div>
        {/if}

        <!-- Content Preview (only if there's content and not too deeply nested) -->
        {#if getContentWithoutMedia(event.content).trim() && depth < MAX_EMBED_DEPTH}
          {@const cleanContent = getContentWithoutMedia(event.content).trim()}
          {@const isKind1 = event.kind === 1}
          {@const estimatedLines = isKind1 ? estimateLineCount(cleanContent) : 0}
          {@const needsReadMore = isKind1 && estimatedLines > 6}
          {@const shouldClamp = needsReadMore && !isContentExpanded}
          
          <div class="text-sm leading-relaxed mb-3" style="color: var(--color-text-primary)">
            <div
              class="overflow-hidden transition-all duration-200"
              class:line-clamp-6={shouldClamp}
            >
              <NoteContent content={cleanContent} showLinkPreviews={false} embedDepth={depth + 1} />
            </div>
            {#if needsReadMore}
              <button
                on:click|stopPropagation={toggleExpanded}
                class="text-caption hover:opacity-80 text-xs mt-1 transition-colors"
              >
                {isContentExpanded ? 'Show less' : 'Read more'}
              </button>
            {/if}
          </div>
        {:else if getContentWithoutMedia(event.content).trim()}
          <div class="text-sm leading-relaxed mb-3 text-caption italic">
            [Embedded content - click to view]
          </div>
        {/if}

        <!-- Images -->
        {#if getImageUrls(event).length > 0}
          {@const mediaUrls = getImageUrls(event)}
          <div class="mb-2">
            <div class="relative overflow-hidden rounded-lg h-32" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border)">
              {#each mediaUrls.slice(0, 1) as imageUrl}
                {#if isImageUrl(imageUrl)}
                  <img 
                    src={imageUrl} 
                    class="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    alt="Embedded image"
                    on:error={handleImageError}
                  />
                {:else if isVideoUrl(imageUrl)}
                  <video 
                    src={imageUrl} 
                    controls 
                    class="w-full h-full object-cover"
                    preload="metadata"
                    on:error={handleVideoError}
                    on:click|stopPropagation
                  >
                    <track kind="captions" src="" srclang="en" label="English" />
                    Your browser does not support the video tag.
                  </video>
                {/if}
              {/each}
            </div>
            {#if mediaUrls.length > 1}
              <div class="text-xs mt-1" style="color: var(--color-caption)">
                +{mediaUrls.length - 1} more image{mediaUrls.length - 1 !== 1 ? 's' : ''}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </button>
{:else}
  <div class="rounded-lg p-4" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border)">
    <p class="text-sm" style="color: var(--color-caption)">Note not found</p>
  </div>
{/if}

<style>
  .note-embed-card:hover {
    background-color: var(--color-input-bg) !important;
  }

  .line-clamp-6 {
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>

