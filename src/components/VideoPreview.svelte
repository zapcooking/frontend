<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import VideoIcon from 'phosphor-svelte/lib/Video';

  export let url: string;

  let showVideo = false;
  let previewVideo: HTMLVideoElement;
  let containerEl: HTMLDivElement;
  let isVisible = false;
  let isLoading = true;
  let hasError = false;
  let thumbnailLoaded = false;
  let observer: IntersectionObserver | null = null;

  // Try to get thumbnail URL for known video hosts
  function getThumbnailUrl(videoUrl: string): string | null {
    try {
      const urlObj = new URL(videoUrl);
      
      // nostr.build videos - try to get thumbnail
      if (urlObj.hostname.includes('nostr.build')) {
        // nostr.build stores thumbnails at /thumb/ path
        // e.g., https://nostr.build/av/xxx.mp4 -> https://nostr.build/thumb/xxx.jpg
        const path = urlObj.pathname;
        if (path.includes('/av/') || path.includes('/video/')) {
          const baseName = path.replace(/\.(mp4|webm|mov)$/i, '');
          return `https://image.nostr.build${baseName}.jpg`;
        }
      }
      
      // Add more video hosts here as needed
      
      return null;
    } catch {
      return null;
    }
  }

  $: thumbnailUrl = getThumbnailUrl(url);

  function handlePlayClick() {
    showVideo = true;
  }

  // Seek to first frame when metadata loads to show preview
  function handleLoadedMetadata() {
    if (previewVideo && !showVideo) {
      // Seek to a small time to get the first visible frame
      previewVideo.currentTime = 0.1;
    }
  }

  // Ensure video stays paused at first frame
  function handleSeeked() {
    if (previewVideo && !showVideo) {
      previewVideo.pause();
      isLoading = false;
      thumbnailLoaded = true;
    }
  }

  // Handle video load errors
  function handleVideoError() {
    console.warn('Video preview failed to load:', url);
    isLoading = false;
    hasError = true;
  }

  // Handle thumbnail load
  function handleThumbnailLoad() {
    thumbnailLoaded = true;
    isLoading = false;
  }

  function handleThumbnailError() {
    // Thumbnail failed, fall back to video frame extraction
    thumbnailLoaded = false;
  }

  onMount(() => {
    // Use intersection observer to only load video when visible
    if (typeof IntersectionObserver !== 'undefined' && containerEl) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !isVisible) {
              isVisible = true;
              // Don't disconnect - we want to keep tracking
            }
          });
        },
        {
          rootMargin: '100px', // Start loading 100px before visible
          threshold: 0.1
        }
      );
      observer.observe(containerEl);
    } else {
      // Fallback: just make it visible
      isVisible = true;
    }
  });

  onDestroy(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });
</script>

<div class="my-1 relative" bind:this={containerEl}>
  {#if showVideo}
    <!-- Show full video player when clicked -->
    <video
      src={url}
      controls
      autoplay
      class="max-w-full rounded-lg max-h-96 w-full"
      preload="auto"
    >
      <track kind="captions" />
    </video>
  {:else}
    <!-- Show video preview with play button overlay -->
    <div 
      class="relative group cursor-pointer rounded-lg overflow-hidden bg-gray-800" 
      on:click={handlePlayClick} 
      on:keypress={(e) => e.key === 'Enter' && handlePlayClick()} 
      role="button" 
      tabindex="0"
      style="min-height: 200px; aspect-ratio: 16/9;"
    >
      {#if isVisible}
        {#if thumbnailUrl && !thumbnailLoaded && !hasError}
          <!-- Try to load thumbnail image first -->
          <img 
            src={thumbnailUrl}
            alt="Video thumbnail"
            class="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            on:load={handleThumbnailLoad}
            on:error={handleThumbnailError}
          />
        {/if}

        {#if !thumbnailUrl || !thumbnailLoaded}
          <!-- Fall back to video element for frame extraction -->
          <video
            bind:this={previewVideo}
            src={url}
            preload="metadata"
            muted
            playsinline
            class="absolute inset-0 w-full h-full object-cover pointer-events-none"
            class:opacity-0={isLoading && !thumbnailLoaded}
            on:loadedmetadata={handleLoadedMetadata}
            on:seeked={handleSeeked}
            on:error={handleVideoError}
          />
        {:else}
          <!-- Show thumbnail as background -->
          <img 
            src={thumbnailUrl}
            alt="Video thumbnail"
            class="absolute inset-0 w-full h-full object-cover"
          />
        {/if}
      {/if}

      <!-- Loading skeleton -->
      {#if isLoading && !thumbnailLoaded}
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div class="text-gray-400">
            <VideoIcon size={48} weight="thin" />
          </div>
          <div class="flex gap-1">
            <div class="w-2 h-2 rounded-full bg-gray-500 animate-pulse" style="animation-delay: 0ms;"></div>
            <div class="w-2 h-2 rounded-full bg-gray-500 animate-pulse" style="animation-delay: 150ms;"></div>
            <div class="w-2 h-2 rounded-full bg-gray-500 animate-pulse" style="animation-delay: 300ms;"></div>
          </div>
        </div>
      {/if}

      <!-- Error state -->
      {#if hasError}
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div class="text-gray-400">
            <VideoIcon size={48} weight="thin" />
          </div>
          <span class="text-gray-400 text-sm">Video</span>
        </div>
      {/if}
      
      <!-- Play button overlay - always visible -->
      <div class="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors pointer-events-none">
        <div class="bg-white/90 hover:bg-white rounded-full p-4 shadow-lg group-hover:scale-110 transition-transform pointer-events-auto">
          <PlayIcon size={32} weight="fill" class="text-gray-900 ml-1" />
        </div>
      </div>
    </div>
  {/if}
</div>
