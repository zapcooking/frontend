<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import VideoIcon from 'phosphor-svelte/lib/Video';

  export let url: string;

  let showVideo = false;
  let previewVideo: HTMLVideoElement;
  let autoplayVideo: HTMLVideoElement;
  let containerEl: HTMLDivElement;
  let isVisible = false;
  let isLoading = true;
  let hasError = false;
  let thumbnailLoaded = false;
  let observer: IntersectionObserver | null = null;
  let isInViewport = false;
  let isPlaying = false;

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
    // If autoplay is active, switch to controls mode
    if (isPlaying && autoplayVideo) {
      showVideo = true;
      autoplayVideo.pause();
      isPlaying = false;
    } else {
      showVideo = true;
    }
  }

  // Handle autoplay based on viewport visibility
  async function handleViewportChange(inViewport: boolean) {
    isInViewport = inViewport;
    
    if (!autoplayVideo || showVideo) return;
    
    if (inViewport) {
      // Video entered viewport - start playing
      try {
        // Ensure video is muted (required for autoplay)
        autoplayVideo.muted = true;
        
        if (autoplayVideo.readyState >= 2) {
          // Video has loaded enough data (HAVE_CURRENT_DATA or higher)
          const playPromise = autoplayVideo.play();
          if (playPromise !== undefined) {
            await playPromise;
            isPlaying = true;
            isLoading = false;
          }
        } else {
          // Wait for video to load enough data
          const canPlayHandler = async () => {
            if (isInViewport && !showVideo && autoplayVideo) {
              try {
                autoplayVideo.muted = true;
                await autoplayVideo.play();
                isPlaying = true;
                isLoading = false;
              } catch (e) {
                console.warn('Autoplay failed:', e);
              }
            }
          };
          
          if (autoplayVideo.readyState >= 1) {
            // Already have metadata, try playing
            canPlayHandler();
          } else {
            // Wait for canplay event
            autoplayVideo.addEventListener('canplay', canPlayHandler, { once: true });
          }
        }
      } catch (e) {
        // Autoplay may be blocked by browser policy
        console.warn('Autoplay blocked:', e);
        // Don't set isPlaying to true if autoplay fails
      }
    } else {
      // Video left viewport - pause
      if (isPlaying && autoplayVideo) {
        autoplayVideo.pause();
        isPlaying = false;
      }
    }
  }

  // Seek to first frame when metadata loads to show preview
  function handleLoadedMetadata() {
    // Use autoplayVideo if available, otherwise previewVideo
    const video = autoplayVideo || previewVideo;
    if (video && !showVideo && !isPlaying) {
      // Seek to a small time to get the first visible frame
      video.currentTime = 0.1;
    }
  }

  // Ensure video shows first frame (for thumbnail extraction)
  function handleSeeked() {
    const video = previewVideo;
    if (video && !showVideo && !isPlaying) {
      video.pause();
      isLoading = false;
      if (!thumbnailUrl) {
        thumbnailLoaded = true;
      }
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
    // Use intersection observer for lazy loading and autoplay
    if (typeof IntersectionObserver !== 'undefined' && containerEl) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const wasVisible = isVisible;
            const wasInViewport = isInViewport;
            
            if (entry.isIntersecting && !isVisible) {
              isVisible = true;
            }
            
            // Track viewport for autoplay (more strict threshold)
            const inViewport = entry.isIntersecting && entry.intersectionRatio > 0.5;
            if (inViewport !== wasInViewport) {
              handleViewportChange(inViewport);
            }
          });
        },
        {
          rootMargin: '50px', // Start loading 50px before visible
          threshold: [0, 0.5, 1.0] // Multiple thresholds for better tracking
        }
      );
      observer.observe(containerEl);
    } else {
      // Fallback: just make it visible
      isVisible = true;
      handleViewportChange(true);
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
      title={isPlaying ? "Tap to show controls" : "Tap to play"}
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

        {#if thumbnailUrl && thumbnailLoaded}
          <!-- Show thumbnail as background initially -->
          <img 
            src={thumbnailUrl}
            alt="Video thumbnail"
            class="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
            class:opacity-0={isPlaying}
          />
        {/if}

        <!-- Video element for autoplay -->
        <video
          bind:this={autoplayVideo}
          src={url}
          preload="metadata"
          muted
          playsinline
          loop
          class="absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-300"
          class:opacity-0={!isPlaying && (isLoading || (thumbnailUrl && thumbnailLoaded))}
          on:loadedmetadata={() => {
            if (!thumbnailUrl || !thumbnailLoaded) {
              handleLoadedMetadata();
            }
            // Try to autoplay if in viewport
            if (isInViewport && !showVideo) {
              handleViewportChange(true);
            }
          }}
          on:seeked={() => {
            if (!thumbnailUrl || !thumbnailLoaded) {
              handleSeeked();
            }
          }}
          on:canplay={() => {
            // Auto-play when video can play and is in viewport
            if (isInViewport && !showVideo && !isPlaying && autoplayVideo) {
              handleViewportChange(true);
            }
          }}
          on:error={handleVideoError}
        />
        
        <!-- Keep previewVideo for initial frame extraction if no thumbnail -->
        {#if !thumbnailUrl && !thumbnailLoaded}
          <video
            bind:this={previewVideo}
            src={url}
            preload="none"
            muted
            playsinline
            class="hidden"
            on:loadedmetadata={handleLoadedMetadata}
            on:seeked={handleSeeked}
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
      
      <!-- Play button overlay - hide when playing -->
      {#if !isPlaying}
        <div class="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors pointer-events-none">
          <div class="bg-white/90 hover:bg-white rounded-full p-4 shadow-lg group-hover:scale-110 transition-transform pointer-events-auto">
            <PlayIcon size={32} weight="fill" class="text-gray-900 ml-1" />
          </div>
        </div>
      {:else}
        <!-- Subtle overlay when playing - click to show controls -->
        <div class="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors pointer-events-none"></div>
      {/if}
    </div>
  {/if}
</div>
