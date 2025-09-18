<script lang="ts">
  import { onMount } from 'svelte';
  import { ndk } from '$lib/nostr';
  import { formatDistanceToNow } from 'date-fns';
  import { Avatar } from '@nostr-dev-kit/ndk-svelte-components';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import AuthorName from './AuthorName.svelte';

  let events: NDKEvent[] = [];
  let loading = true;
  let error = false;
  let debugInfo = '';
  
  // Carousel state - tracks current slide for each event
  let carouselStates: { [eventId: string]: number } = {};

  async function loadFoodstrFeed() {
    try {
      loading = true;
      error = false;
      events = [];
      
      console.log('🍽️ Loading cooking feed...');
      debugInfo = 'Loading cooking feed...';
      
      // Check if NDK is connected
      if (!$ndk) {
        throw new Error('NDK not initialized');
      }
      
      // Expanded filter with multiple cooking-related tags
      const filter = {
        kinds: [1],
        '#t': ['foodstr', 'cook', 'cookstr', 'zapcooking', 'cooking', 'drinkstr', 'foodies', 'carnivor', 'carnivorediet'],
        limit: 20
      };
      
      console.log('🔍 Filter:', filter);
      
      // Use fetchEvents with timeout
      const fetchPromise = $ndk.fetchEvents(filter);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout - relays may be unreachable')), 15000)
      );
      
      const fetchedEvents = await Promise.race([fetchPromise, timeoutPromise]) as Set<NDKEvent>;
      console.log('📊 Fetched events:', fetchedEvents.size);
      
      if (fetchedEvents.size > 0) {
        const eventArray = Array.from(fetchedEvents);
        // Sort by newest first
        events = eventArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        loading = false;
        error = false;
        debugInfo = `Found ${events.length} events`;
        console.log('✅ Successfully loaded', events.length, 'events');
      } else {
        loading = false;
        error = false;
        debugInfo = 'No cooking events found';
        console.log('ℹ️ No events found');
      }
      
    } catch (err) {
      console.error('❌ Error:', err);
      loading = false;
      error = true;
      
      // Provide more specific error messages
      if (err instanceof Error) {
        if (err.message.includes('timeout')) {
          debugInfo = 'Connection timeout - relays may be unreachable. Try again or check your connection.';
        } else if (err.message.includes('WebSocket')) {
          debugInfo = 'WebSocket connection failed - relays may be down. Try again later.';
        } else {
          debugInfo = `Error: ${err.message}`;
        }
      } else {
        debugInfo = `Error: ${String(err)}`;
      }
    }
  }

  async function retryWithDelay(attempts = 3, delay = 2000) {
    for (let i = 0; i < attempts; i++) {
      try {
        await loadFoodstrFeed();
        if (!error) return; // Success, exit retry loop
      } catch (err) {
        console.log(`🔄 Retry attempt ${i + 1}/${attempts} failed:`, err);
      }
      
      if (i < attempts - 1) {
        debugInfo = `Retrying in ${delay/1000}s... (attempt ${i + 2}/${attempts})`;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  onMount(() => {
    retryWithDelay();
  });

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
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

  // Simple function to get current slide for an event
  function getCurrentSlide(eventId: string): number {
    return carouselStates[eventId] || 0;
  }

  // Navigation functions
  function nextSlide(eventId: string, totalSlides: number) {
    const current = getCurrentSlide(eventId);
    const next = (current + 1) % totalSlides;
    console.log('nextSlide: current', current, 'next', next, 'total', totalSlides);
    carouselStates[eventId] = next;
    carouselStates = { ...carouselStates }; // Trigger reactivity
    console.log('Updated carouselStates:', carouselStates);
  }

  function prevSlide(eventId: string, totalSlides: number) {
    const current = getCurrentSlide(eventId);
    const prev = current === 0 ? totalSlides - 1 : current - 1;
    console.log('prevSlide: current', current, 'prev', prev, 'total', totalSlides);
    carouselStates[eventId] = prev;
    carouselStates = { ...carouselStates }; // Trigger reactivity
    console.log('Updated carouselStates:', carouselStates);
  }
</script>

<div class="max-w-2xl mx-auto">
  <!-- Debug Info -->
  <div class="mb-4 p-3 bg-blue-100 rounded-lg text-sm text-blue-800">
    <strong>Debug:</strong> {debugInfo}<br>
    <strong>Loading:</strong> {loading}<br>
    <strong>Events:</strong> {events.length}<br>
    <strong>Error:</strong> {error}<br>
    <button 
      on:click={() => retryWithDelay()}
      class="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-xs"
    >
      Retry Connection
    </button>
  </div>

  {#if loading}
    <div class="space-y-6">
      {#each Array(3) as _}
        <div class="border-b border-gray-200 py-6">
          <div class="flex space-x-3">
            <div class="h-10 w-10 rounded-full bg-gray-200 animate-pulse flex-shrink-0"></div>
            <div class="flex-1 space-y-3">
              <div class="flex items-center space-x-2">
                <div class="h-4 w-24 bg-gray-200 animate-pulse rounded"></div>
                <div class="h-4 w-16 bg-gray-200 animate-pulse rounded"></div>
              </div>
              <div class="space-y-2">
                <div class="h-4 w-full bg-gray-200 animate-pulse rounded"></div>
                <div class="h-4 w-4/5 bg-gray-200 animate-pulse rounded"></div>
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else if error}
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div class="text-gray-500">
          <svg class="h-12 w-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-lg font-medium">Unable to load cooking posts</p>
          <p class="text-sm">Please check your connection and try again.</p>
        </div>
        <button 
          on:click={() => retryWithDelay()}
          class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Retry Connection
        </button>
      </div>
    </div>
  {:else if events.length === 0}
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div class="text-gray-500">
          <svg class="h-12 w-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-lg font-medium">No cooking posts found</p>
          <p class="text-sm">Try posting with cooking tags like #foodstr, #cook, #cooking, etc.</p>
        </div>
        <button 
          on:click={() => retryWithDelay()}
          class="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Refresh Feed
        </button>
      </div>
    </div>
  {:else}
    <div class="space-y-0">
      {#each events as event}
        <article class="border-b border-gray-200 py-6 first:pt-0">
          <div class="flex space-x-3">
            <!-- Avatar -->
            <div class="flex-shrink-0">
              <Avatar
                class="h-10 w-10 rounded-full cursor-pointer"
                ndk={$ndk}
                pubkey={event.author.hexpubkey}
              />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <!-- Header -->
              <div class="flex items-center space-x-2 mb-2">
                <AuthorName {event} />
                <span class="text-gray-500 text-sm">·</span>
                <span class="text-gray-500 text-sm">
                  {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
                </span>
              </div>

              <!-- Content -->
              <div class="text-sm leading-relaxed mb-3 text-gray-900">
                {getContentWithoutMedia(event.content)}
              </div>

              <!-- Debug: Show all tags -->
              <div class="text-xs text-gray-400 mb-2">
                Tags: {JSON.stringify(event.tags)}
              </div>

              <!-- Images -->
              {#if getImageUrls(event).length > 0}
                {@const mediaUrls = getImageUrls(event)}
                
                <div class="mb-3">
                  <!-- Debug info -->
                  <div class="text-xs text-gray-500 mb-1">
                    Media: {mediaUrls.length} items | Current: {(carouselStates[event.id] || 0) + 1} | State: {carouselStates[event.id] || 0}
                  </div>
                  
                  <!-- Single image container -->
                  <div class="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-100 h-64">
                    {#each mediaUrls as imageUrl, index}
                      <div 
                        class="absolute inset-0 transition-opacity duration-300"
                        class:opacity-100={index === (carouselStates[event.id] || 0)}
                        class:opacity-0={index !== (carouselStates[event.id] || 0)}
                      >
                        {#if isImageUrl(imageUrl)}
                          <img 
                            src={imageUrl} 
                            alt="Shared image" 
                            class="w-full h-full object-cover"
                            loading="lazy"
                            on:error={(e) => {
                              console.log('Image failed to load:', imageUrl);
                              const target = e.target;
                              if (target && target.style) target.style.display = 'none';
                            }}
                          />
                        {:else if isVideoUrl(imageUrl)}
                          <video 
                            src={imageUrl} 
                            controls 
                            class="w-full h-full object-cover"
                            preload="metadata"
                            on:error={(e) => {
                              console.log('Video failed to load:', imageUrl);
                              const target = e.target;
                              if (target && target.style) target.style.display = 'none';
                            }}
                          >
                            Your browser does not support the video tag.
                          </video>
                        {:else}
                          <div class="w-full h-full flex items-center justify-center bg-gray-200">
                            <span class="text-gray-600">Unknown media type</span>
                          </div>
                        {/if}
                      </div>
                    {/each}
                    
                    <!-- Navigation buttons (only show if multiple images) -->
                    {#if mediaUrls.length > 1}
                      <!-- Previous button -->
                      <button
                        on:click={() => {
                          console.log('Previous clicked for event:', event.id, 'current:', carouselStates[event.id] || 0);
                          prevSlide(event.id, mediaUrls.length);
                        }}
                        class="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors z-10"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      
                      <!-- Next button -->
                      <button
                        on:click={() => {
                          console.log('Next clicked for event:', event.id, 'current:', carouselStates[event.id] || 0);
                          nextSlide(event.id, mediaUrls.length);
                        }}
                        class="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors z-10"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      
                      <!-- Slide Counter -->
                      <div class="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                        {(carouselStates[event.id] || 0) + 1} / {mediaUrls.length}
                      </div>
                      
                      <!-- Dot Indicators (only show if 5 or fewer items) -->
                      {#if mediaUrls.length <= 5}
                        <div class="absolute bottom-2 left-1/2 -translate-x-1/2 flex space-x-1">
                          {#each mediaUrls as _, index}
                            <button
                              on:click={() => {
                                console.log('Dot clicked for event:', event.id, 'slide:', index);
                                carouselStates[event.id] = index;
                                carouselStates = { ...carouselStates };
                              }}
                              class="w-2 h-2 rounded-full transition-all"
                              class:bg-white={index === (carouselStates[event.id] || 0)}
                              class:bg-gray-300={index !== (carouselStates[event.id] || 0)}
                              class:hover:bg-gray-200={index !== (carouselStates[event.id] || 0)}
                            />
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>
                </div>
              {/if}

              <!-- Actions -->
              <div class="flex items-center space-x-4 text-sm text-gray-500">
                <button class="hover:text-gray-700 transition-colors">
                  Like
                </button>
                <button class="hover:text-gray-700 transition-colors">
                  Reply
                </button>
                <button class="hover:text-gray-700 transition-colors">
                  Zap
                </button>
              </div>
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>
