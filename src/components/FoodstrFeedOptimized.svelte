<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk } from '$lib/nostr';
  import { formatDistanceToNow } from 'date-fns';
  import { Avatar } from '@nostr-dev-kit/ndk-svelte-components';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import NoteTotalLikes from './NoteTotalLikes.svelte';
  import NoteTotalZaps from './NoteTotalZaps.svelte';
  import InlineComments from './InlineComments.svelte';
  import ZapModal from './ZapModal.svelte';
  import NoteContent from './NoteContent.svelte';

  // State management
  let events: NDKEvent[] = [];
  let loading = true;
  let error = false;
  let hasMore = true;
  let loadingMore = false;
  let debugInfo = '';
  
  // Performance optimizations
  let subscription: NDKSubscription | null = null;
  let batchTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingEvents: NDKEvent[] = [];
  let lastEventTime: number = 0;
  
  // Caching
  const CACHE_KEY = 'foodstr_feed_cache';
  const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes
  
  // Carousel state - tracks current slide for each event
  let carouselStates: { [eventId: string]: number } = {};
  
  // Zap modal state
  let zapModal = false;
  let selectedEvent: NDKEvent | null = null;

  // Debounced batch processing for rapid updates
  function processBatch() {
    if (pendingEvents.length === 0) return;
    
    console.log(`🔄 Processing batch of ${pendingEvents.length} events`);
    
    // Sort new events by creation time
    const sortedNewEvents = pendingEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    
    // Merge with existing events, avoiding duplicates
    const existingIds = new Set(events.map(e => e.id));
    const uniqueNewEvents = sortedNewEvents.filter(e => !existingIds.has(e.id));
    
    // Insert new events in chronological order
    events = [...events, ...uniqueNewEvents].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    
    // Update last event time
    if (uniqueNewEvents.length > 0) {
      lastEventTime = Math.max(lastEventTime, ...uniqueNewEvents.map(e => e.created_at || 0));
    }
    
    // Clear pending events
    pendingEvents = [];
    
    // Cache the updated events
    cacheEvents();
    
    console.log(`✅ Batch processed. Total events: ${events.length}`);
  }

  function debouncedBatchProcess() {
    if (batchTimeout) {
      clearTimeout(batchTimeout);
    }
    batchTimeout = setTimeout(processBatch, 300); // 300ms debounce
  }

  // Caching functions
  function cacheEvents() {
    if (typeof window === 'undefined') return;
    
    try {
      const cacheData = {
        events: events.map(e => ({
          id: e.id,
          pubkey: e.pubkey,
          content: e.content,
          created_at: e.created_at,
          tags: e.tags,
          author: e.author ? {
            hexpubkey: e.author.hexpubkey,
            profile: e.author.profile
          } : null
        })),
        timestamp: Date.now(),
        lastEventTime: lastEventTime
      };
      
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
      console.log('💾 Events cached to localStorage');
    } catch (err) {
      console.warn('⚠️ Failed to cache events:', err);
    }
  }

  function loadCachedEvents(): boolean {
    if (typeof window === 'undefined') return false;
    
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return false;
      
      const cacheData = JSON.parse(cached);
      const now = Date.now();
      
      // Check if cache is still valid
      if (now - cacheData.timestamp > CACHE_EXPIRY) {
        localStorage.removeItem(CACHE_KEY);
        return false;
      }
      
      // Restore events from cache
      events = cacheData.events.map((e: any) => ({
        ...e,
        author: e.author ? {
          hexpubkey: e.author.hexpubkey,
          profile: e.author.profile
        } : null
      })) as NDKEvent[];
      
      lastEventTime = cacheData.lastEventTime || 0;
      
      console.log(`📦 Loaded ${events.length} events from cache`);
      return true;
    } catch (err) {
      console.warn('⚠️ Failed to load cached events:', err);
      localStorage.removeItem(CACHE_KEY);
      return false;
    }
  }

  async function loadFoodstrFeed(useCache = true) {
    try {
      // Try to load from cache first
      if (useCache && loadCachedEvents()) {
        loading = false;
        error = false;
        debugInfo = `Loaded ${events.length} events from cache`;
        
        // Still fetch fresh data in background
        setTimeout(() => fetchFreshData(), 100);
        return;
      }
      
      loading = true;
      error = false;
      events = [];
      
      console.log('🍽️ Loading cooking feed...');
      debugInfo = 'Loading cooking feed...';
      
      // Check if NDK is connected
      if (!$ndk) {
        throw new Error('NDK not initialized');
      }
      
      // Optimized filter with reduced initial limit
      const filter = {
        kinds: [1],
        '#t': ['foodstr', 'cook', 'cookstr', 'zapcooking', 'cooking', 'drinkstr', 'foodies', 'carnivor', 'carnivorediet'],
        limit: 25, // Reduced from 20 to 25 for better initial load
        since: Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60) // Only last 7 days
      };
      
      console.log('🔍 Filter:', filter);
      
      // Use fetchEvents with timeout
      const fetchPromise = $ndk.fetchEvents(filter);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout - relays may be unreachable')), 10000)
      );
      
      const fetchedEvents = await Promise.race([fetchPromise, timeoutPromise]) as Set<NDKEvent>;
      console.log('📊 Fetched events:', fetchedEvents.size);
      
      if (fetchedEvents.size > 0) {
        const eventArray = Array.from(fetchedEvents);
        // Sort by newest first
        events = eventArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        lastEventTime = Math.max(...events.map(e => e.created_at || 0));
        
        loading = false;
        error = false;
        debugInfo = `Found ${events.length} events`;
        console.log('✅ Successfully loaded', events.length, 'events');
        
        // Cache the events
        cacheEvents();
        
        // Start real-time subscription for new events
        startRealtimeSubscription();
      } else {
        loading = false;
        error = false;
        debugInfo = 'No cooking events found';
        console.log('ℹ️ No events found');
        
        // Still start subscription for real-time updates
        startRealtimeSubscription();
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

  function startRealtimeSubscription() {
    if (subscription) {
      subscription.stop();
    }
    
    console.log('🔄 Starting real-time subscription...');
    
    const subscriptionFilter = {
      kinds: [1],
      '#t': ['foodstr', 'cook', 'cookstr', 'zapcooking', 'cooking', 'drinkstr', 'foodies', 'carnivor', 'carnivorediet'],
      since: lastEventTime + 1 // Only get events newer than what we have
    };
    
    subscription = $ndk.subscribe(subscriptionFilter);
    
    subscription.on('event', (event: NDKEvent) => {
      console.log('📨 New real-time event:', event.id);
      
      // Add to pending batch
      pendingEvents.push(event);
      
      // Debounced batch processing
      debouncedBatchProcess();
    });
    
    subscription.on('eose', () => {
      console.log('🏁 Real-time subscription established');
    });
  }

  async function fetchFreshData() {
    try {
      console.log('🔄 Fetching fresh data in background...');
      
      const filter = {
        kinds: [1],
        '#t': ['foodstr', 'cook', 'cookstr', 'zapcooking', 'cooking', 'drinkstr', 'foodies', 'carnivor', 'carnivorediet'],
        limit: 50,
        since: Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60)
      };
      
      const fetchedEvents = await $ndk.fetchEvents(filter);
      
      if (fetchedEvents.size > 0) {
        const eventArray = Array.from(fetchedEvents);
        const sortedEvents = eventArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        
        // Merge with existing events
        const existingIds = new Set(events.map(e => e.id));
        const newEvents = sortedEvents.filter(e => !existingIds.has(e.id));
        
        if (newEvents.length > 0) {
          events = [...events, ...newEvents].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          lastEventTime = Math.max(...events.map(e => e.created_at || 0));
          cacheEvents();
          
          console.log(`🔄 Background refresh added ${newEvents.length} new events`);
          debugInfo = `Found ${events.length} events (${newEvents.length} new)`;
        }
      }
    } catch (err) {
      console.warn('⚠️ Background refresh failed:', err);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    
    try {
      loadingMore = true;
      
      const oldestEvent = events[events.length - 1];
      if (!oldestEvent?.created_at) {
        hasMore = false;
        return;
      }
      
      const filter = {
        kinds: [1],
        '#t': ['foodstr', 'cook', 'cookstr', 'zapcooking', 'cooking', 'drinkstr', 'foodies', 'carnivor', 'carnivorediet'],
        until: oldestEvent.created_at - 1,
        limit: 20
      };

      const fetchedEvents = await $ndk.fetchEvents(filter);
      const newEvents = Array.from(fetchedEvents);
      
      if (newEvents.length > 0) {
        events = [...events, ...newEvents];
        hasMore = newEvents.length === 20;
        cacheEvents();
      } else {
        hasMore = false;
      }
    } catch (err) {
      console.error('Error loading more events:', err);
    } finally {
      loadingMore = false;
    }
  }

  async function retryWithDelay(attempts = 3, delay = 2000) {
    for (let i = 0; i < attempts; i++) {
      try {
        await loadFoodstrFeed(i === 0); // Use cache only on first attempt
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

  // Cleanup function
  function cleanup() {
    console.log('🧹 Cleaning up subscriptions...');
    
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
    
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    
    // Process any remaining pending events
    if (pendingEvents.length > 0) {
      processBatch();
    }
  }

  onMount(() => {
    retryWithDelay();
  });

  onDestroy(() => {
    cleanup();
  });

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }

  function getDisplayName(event: NDKEvent): string {
    const metadata = event.author?.profile;
    const pubkey = event.author?.hexpubkey;
    if (metadata?.display_name) return metadata.display_name;
    if (metadata?.name) return metadata.name;
    if (pubkey) return String(pubkey).slice(0, 8);
    return 'Anonymous';
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
    carouselStates[eventId] = next;
    carouselStates = { ...carouselStates }; // Trigger reactivity
  }

  function prevSlide(eventId: string, totalSlides: number) {
    const current = getCurrentSlide(eventId);
    const prev = current === 0 ? totalSlides - 1 : current - 1;
    carouselStates[eventId] = prev;
    carouselStates = { ...carouselStates }; // Trigger reactivity
  }

  function openZapModal(event: NDKEvent) {
    selectedEvent = event;
    zapModal = true;
  }
</script>

<div class="max-w-2xl mx-auto">

  {#if loading}
    <!-- Optimized skeleton loading -->
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
              <!-- Image skeleton -->
              <div class="h-64 bg-gray-200 animate-pulse rounded-lg"></div>
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
      {#each events as event (event.id)}
        <article class="border-b border-gray-200 py-4 sm:py-6 first:pt-0">
          <div class="flex space-x-3 px-2 sm:px-0">
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
                <span class="font-semibold text-sm text-gray-900">
                  {getDisplayName(event)}
                </span>
                <span class="text-gray-500 text-sm">·</span>
                <span class="text-gray-500 text-sm">
                  {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
                </span>
              </div>

              <!-- Content -->
              <div class="text-sm leading-relaxed mb-3 text-gray-900">
                <NoteContent content={getContentWithoutMedia(event.content)} />
              </div>

              <!-- Images with optimized loading -->
              {#if getImageUrls(event).length > 0}
                {@const mediaUrls = getImageUrls(event)}
                
                <div class="mb-3 -mx-2 sm:mx-0">
                  <!-- Single image container -->
                  <div class="relative overflow-hidden rounded-none sm:rounded-lg border-0 sm:border border-gray-200 bg-gray-100 h-48 sm:h-64">
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
                            decoding="async"
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
                        on:click={() => prevSlide(event.id, mediaUrls.length)}
                        class="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors z-10"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      
                      <!-- Next button -->
                      <button
                        on:click={() => nextSlide(event.id, mediaUrls.length)}
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

              <!-- Actions: Likes, Comments, Zaps -->
              <div class="space-y-2">
                <div class="flex items-center space-x-3 sm:space-x-4 text-sm text-gray-500 px-2 sm:px-0">
                  <NoteTotalLikes {event} />
                  <button 
                    class="cursor-pointer hover:bg-input rounded px-0.5 transition duration-300"
                    on:click={() => openZapModal(event)}
                  >
                    <NoteTotalZaps {event} />
                  </button>
                </div>
                
                <!-- Inline Comments -->
                <InlineComments {event} />
              </div>
            </div>
          </div>
        </article>
      {/each}

      {#if hasMore}
        <div class="py-4 text-center">
          {#if loadingMore}
            <div class="flex justify-center">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            </div>
          {:else}
            <button 
              on:click={loadMore}
              class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Load More
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Zap Modal -->
{#if zapModal && selectedEvent}
  <ZapModal 
    event={selectedEvent} 
    on:close={() => {
      zapModal = false;
      selectedEvent = null;
    }} 
  />
{/if}
