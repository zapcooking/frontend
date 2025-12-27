<script lang="ts">
  import { onMount } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { ndk } from '$lib/nostr';
  import CustomAvatar from './CustomAvatar.svelte';
  import AuthorName from './AuthorName.svelte';
  import ProfileLink from './ProfileLink.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { goto } from '$app/navigation';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import ClientAttribution from './ClientAttribution.svelte';

  export let nostrString: string;

  let event: NDKEvent | null = null;
  let loading = true;
  let error = false;
  let eventId = '';

  // Extract event ID from nostr string
  $: {
    try {
      if (nostrString.startsWith('nostr:nevent1')) {
        const decoded = nip19.decode(nostrString.replace('nostr:', ''));
        if (decoded.type === 'nevent') {
          eventId = decoded.data.id;
        }
      }
    } catch (err) {
      console.error('Failed to decode nevent:', err);
      error = true;
      loading = false;
    }
  }

  // Fetch the embedded event
  onMount(async () => {
    if (eventId && $ndk) {
      try {
        const filter = {
          ids: [eventId]
        };
        
        const subscription = $ndk.subscribe(filter, { closeOnEose: false });
        let resolved = false;
        
        subscription.on('event', (receivedEvent: NDKEvent) => {
          if (!event) {
            event = receivedEvent;
          }
        });
        
        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            if (!event) {
              error = true;
            }
            loading = false;
          }
        });
        
        // Handle timeout - resolve with whatever we have
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
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
      }
    } else {
      loading = false;
    }
  });

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }

  function truncateContent(content: string, maxLength: number = 200): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
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

  // Parse content and create clickable links for URLs and nostr references
  function parseContent(text: string) {
    // Regex to find URLs and nostr references
    const urlRegex = /(https?:\/\/[^\s]+)|nostr:(nevent1|note1|npub1|nprofile1)([023456789acdefghjklmnpqrstuvwxyz]+)/g;
    
    const parts = [];
    let lastIndex = 0;
    let match;
    let keyCounter = 0;

    while ((match = urlRegex.exec(text)) !== null) {
      const [fullMatch, url, nostrPrefix, nostrData] = match;
      const index = match.index;

      // Add text before this match
      if (index > lastIndex) {
        parts.push({
          type: 'text',
          content: text.substring(lastIndex, index),
          key: `text-${keyCounter++}`
        });
      }

      if (url) {
        // Add the URL as a clickable link
        parts.push({
          type: 'url',
          content: fullMatch,
          url: url,
          key: `url-${keyCounter++}`
        });
      } else if (nostrPrefix && nostrData) {
        // Add the nostr reference as a clickable link
        parts.push({
          type: 'nostr',
          content: fullMatch,
          prefix: nostrPrefix,
          data: nostrData,
          key: `nostr-${keyCounter++}`
        });
      }

      lastIndex = index + fullMatch.length;
    }

    // Add any remaining text
    if (lastIndex < text.length) {
      parts.push({
        type: 'text',
        content: text.substring(lastIndex),
        key: `text-${keyCounter++}`
      });
    }

    return parts;
  }

  function handleNostrClick(nostrId: string) {
    // Navigate to the nostr reference
    goto(`/${nostrId}`);
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
  <div class="rounded-lg p-4 transition-colors note-embed-card" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border)">
    <div class="flex space-x-3">
      <!-- Avatar -->
      <div class="flex-shrink-0">
        <CustomAvatar
          className="cursor-pointer"
          pubkey={event.author.hexpubkey}
          size={32}
        />
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <!-- Header -->
        <div class="flex items-center space-x-2 mb-2 flex-wrap">
          <AuthorName {event} />
          <span class="text-sm" style="color: var(--color-caption)">·</span>
          <span class="text-sm" style="color: var(--color-caption)">
            {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
          </span>
          <ClientAttribution tags={event.tags} enableEnrichment={false} />
        </div>

        <!-- Content Preview -->
        <div class="text-sm mb-2" style="color: var(--color-text-secondary)">
          {#each parseContent(truncateContent(getContentWithoutMedia(event.content))) as part}
            {#if part.type === 'text'}
              {part.content}
            {:else if part.type === 'url'}
              <a
                href={part.url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary hover:opacity-80 hover:underline break-all"
              >
                {part.content}
              </a>
            {:else if part.type === 'nostr'}
              {#if part.prefix === 'nprofile1'}
                <ProfileLink nostrString={part.content} />
              {:else if part.prefix === 'nevent1'}
                <!-- Skip nested embeds to avoid infinite recursion -->
                <span class="text-primary">{part.content}</span>
              {:else}
                <button
                  class="text-primary hover:opacity-80 hover:underline cursor-pointer"
                  on:click={() => handleNostrClick(part.content)}
                >
                  {part.content}
                </button>
              {/if}
            {/if}
          {/each}
        </div>

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

        <!-- Footer -->
        <div class="text-xs" style="color: var(--color-caption)">
          Embedded note
        </div>
      </div>
    </div>
  </div>
{:else}
  <div class="rounded-lg p-4" style="background-color: var(--color-bg-secondary); border: 1px solid var(--color-input-border)">
    <p class="text-sm" style="color: var(--color-caption)">Note not found</p>
  </div>
{/if}

<style>
  .note-embed-card:hover {
    background-color: var(--color-input-bg) !important;
  }
</style>
