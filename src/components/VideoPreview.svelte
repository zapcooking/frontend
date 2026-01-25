<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import VideoIcon from 'phosphor-svelte/lib/Video';

  export let url: string;

  let showVideo = false;
  let previewVideo: HTMLVideoElement;
  let autoplayVideo: HTMLVideoElement;
  let fullVideoPlayer: HTMLVideoElement;
  let containerEl: HTMLDivElement;
  let isVisible = false;
  let isLoading = true;
  let hasError = false;
  let thumbnailLoaded = false;
  let observer: IntersectionObserver | null = null;
  let isInViewport = false;
  let isPlaying = false;
  let playTimeout: ReturnType<typeof setTimeout> | null = null;
  let pauseTimeout: ReturnType<typeof setTimeout> | null = null;
  let userHasInteracted = false; // Track if user has interacted (required for Safari autoplay)

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
    // Enable autoplay on user interaction (Safari requirement)
    enableAutoplay();
    
    // If autoplay is active, switch to controls mode
    if (isPlaying && autoplayVideo) {
      showVideo = true;
      autoplayVideo.pause();
      isPlaying = false;
    } else {
      showVideo = true;
    }
  }

  // Detect Safari browser
  function isSafari(): boolean {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent.toLowerCase();
    return ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium');
  }

  // Handle autoplay based on viewport visibility
  async function handleViewportChange(inViewport: boolean) {
    isInViewport = inViewport;
    
    if (inViewport) {
      // Video entered viewport
      if (showVideo && fullVideoPlayer) {
        // If in full player mode, don't auto-play (user controls it)
        // Just ensure it's ready
        return;
      }
      
      if (!autoplayVideo) return;
      
      // Safari: Check if user has interacted before attempting autoplay
      if (isSafari() && !userHasInteracted) {
        // Safari requires user interaction before muted autoplay works
        // Will be enabled when user interacts
        return;
      }
      
      // Start autoplay for muted preview
      try {
        // Safari-specific: Set volume to 0 and ensure muted before play
        autoplayVideo.volume = 0;
        autoplayVideo.muted = true;
        
        // For Safari, ensure autoplay attribute is set
        if (isSafari()) {
          autoplayVideo.setAttribute('autoplay', '');
        }
        
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
            // Safari: Check if user has interacted
            if (isSafari() && !userHasInteracted) {
              return; // Will be enabled when user interacts
            }
            
            if (isInViewport && !showVideo && autoplayVideo) {
              try {
                // Safari: Ensure muted and volume 0
                autoplayVideo.volume = 0;
                autoplayVideo.muted = true;
                if (isSafari()) {
                  autoplayVideo.setAttribute('autoplay', '');
                }
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
      // Video left viewport - pause immediately (both autoplay and full player)
      if (showVideo && fullVideoPlayer) {
        // Pause full video player with controls/audio
        try {
          fullVideoPlayer.pause();
        } catch (e) {
          console.warn('Error pausing full video player:', e);
        }
      }
      
      if (autoplayVideo) {
        // Pause autoplay preview
        try {
          autoplayVideo.pause();
          // Safari: Remove autoplay attribute when pausing
          if (isSafari()) {
            autoplayVideo.removeAttribute('autoplay');
          }
          isPlaying = false;
        } catch (e) {
          console.warn('Error pausing autoplay video:', e);
          isPlaying = false;
        }
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

  // Enable autoplay after user interaction (required for Safari)
  function enableAutoplay() {
    if (!userHasInteracted) {
      userHasInteracted = true;
      // Try to play any videos currently in viewport
      if (isInViewport && autoplayVideo && !showVideo && !isPlaying) {
        handleViewportChange(true);
      }
    }
  }

  onMount(() => {
    // Listen for user interaction to enable autoplay (Safari requirement)
    if (typeof window !== 'undefined') {
      const enableOnInteraction = () => {
        enableAutoplay();
        // Remove listeners after first interaction
        window.removeEventListener('click', enableOnInteraction);
        window.removeEventListener('touchstart', enableOnInteraction);
        window.removeEventListener('scroll', enableOnInteraction);
      };
      
      window.addEventListener('click', enableOnInteraction, { once: true });
      window.addEventListener('touchstart', enableOnInteraction, { once: true });
      window.addEventListener('scroll', enableOnInteraction, { once: true });
    }

    // Use intersection observer for lazy loading and autoplay
    if (typeof IntersectionObserver !== 'undefined' && containerEl) {
      // Find the app's scroll container (app-scroll from layout)
      const scrollRoot = document.getElementById('app-scroll') || null;
      
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const wasVisible = isVisible;
            const wasInViewport = isInViewport;
            
            if (entry.isIntersecting && !isVisible) {
              isVisible = true;
            }
            
            // Track viewport for autoplay
            // Pause if: not intersecting OR less than 50% visible
            // Play if: intersecting AND at least 50% visible
            const shouldPlay = entry.isIntersecting && entry.intersectionRatio >= 0.5;
            const inViewport = shouldPlay;
            
            // Always update state when it changes (including when scrolling past)
            if (inViewport !== wasInViewport) {
              // Clear any pending timeouts
              if (pauseTimeout) {
                clearTimeout(pauseTimeout);
                pauseTimeout = null;
              }
              if (playTimeout) {
                clearTimeout(playTimeout);
                playTimeout = null;
              }
              
              // Update state immediately
              handleViewportChange(inViewport);
            }
          });
        },
        {
          root: scrollRoot, // Use app scroll container instead of viewport
          rootMargin: '0px', // No margin - play when actually visible
          threshold: [0, 0.25, 0.5, 0.75, 1.0] // Multiple thresholds for smooth transitions
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
    // Clean up timeouts
    if (playTimeout) {
      clearTimeout(playTimeout);
      playTimeout = null;
    }
    if (pauseTimeout) {
      clearTimeout(pauseTimeout);
      pauseTimeout = null;
    }
    
    // Pause videos if playing
    if (isPlaying && autoplayVideo) {
      autoplayVideo.pause();
      isPlaying = false;
    }
    
    // Also pause full video player if it exists
    if (fullVideoPlayer && !fullVideoPlayer.paused) {
      fullVideoPlayer.pause();
    }
    
    // Disconnect observer
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
      bind:this={fullVideoPlayer}
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
            // Safari: Set volume to 0 explicitly and ensure muted
            if (autoplayVideo) {
              autoplayVideo.volume = 0;
              autoplayVideo.muted = true;
              // Safari: Set autoplay attribute if in viewport
              if (isSafari() && isInViewport && !showVideo) {
                autoplayVideo.setAttribute('autoplay', '');
              }
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
            // Safari: Ensure muted and volume 0 before attempting play
            if (autoplayVideo) {
              autoplayVideo.volume = 0;
              autoplayVideo.muted = true;
              // Safari: Set autoplay attribute if in viewport
              if (isSafari() && isInViewport && !showVideo) {
                autoplayVideo.setAttribute('autoplay', '');
              }
            }
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
