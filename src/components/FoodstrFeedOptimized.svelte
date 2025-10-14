<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk } from '$lib/nostr';
  import { formatDistanceToNow } from 'date-fns';
  import CustomAvatar from './CustomAvatar.svelte';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import NoteTotalLikes from './NoteTotalLikes.svelte';
  import NoteTotalComments from './NoteTotalComments.svelte';
  import NoteTotalZaps from './NoteTotalZaps.svelte';
  import InlineComments from './InlineComments.svelte';
  import ZapModal from './ZapModal.svelte';
  import NoteContent from './NoteContent.svelte';
  import AuthorName from './AuthorName.svelte';
  import { optimizeImageUrl, getOptimalFormat } from '$lib/imageOptimizer';
  import { compressedCacheManager, COMPRESSED_FEED_CACHE_CONFIG } from '$lib/compressedCache';
  import { createSubscriptionManager } from '$lib/subscriptionManager';
  import FeedErrorBoundary from './FeedErrorBoundary.svelte';
  import FeedPostSkeleton from './FeedPostSkeleton.svelte';
  import LoadingState from './LoadingState.svelte';

  // State management
  let events: NDKEvent[] = [];
  let loading = true;
  let error = false;
  let hasMore = true;
  let loadingMore = false;
  let debugInfo = '';
  let isRefreshing = false;
  
  // Performance optimizations
  let subscription: NDKSubscription | null = null;
  let batchTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingEvents: NDKEvent[] = [];
  let lastEventTime: number = 0;
  let subscriptionManager: any = null;
  
  // Caching
  let cacheLoaded = false;
  
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

  // Simple caching functions (restored for stability)
  const CACHE_KEY = 'foodstr_feed_cache';
  const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

  async function cacheEvents() {
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
      
      // Use compressed cache for better performance
      await compressedCacheManager.set({
        ...COMPRESSED_FEED_CACHE_CONFIG,
        key: CACHE_KEY
      }, cacheData);
      
      console.log('💾 Events cached with compression');
    } catch (err) {
      console.warn('⚠️ Failed to cache events:', err);
      // Fallback to localStorage
      try {
        const fallbackCacheData = {
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
        localStorage.setItem(CACHE_KEY, JSON.stringify(fallbackCacheData));
        console.log('💾 Events cached to localStorage (fallback)');
      } catch (fallbackErr) {
        console.error('❌ Failed to cache events (fallback):', fallbackErr);
      }
    }
  }

  async function loadCachedEvents(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    
    try {
      // Try compressed cache first
      const cacheData = await compressedCacheManager.get({
        ...COMPRESSED_FEED_CACHE_CONFIG,
        key: CACHE_KEY
      });
      
      if (cacheData && typeof cacheData === 'object' && cacheData !== null && 'events' in cacheData) {
        // Restore events from compressed cache
        events = (cacheData as any).events.map((e: any) => ({
          ...e,
          author: e.author ? {
            hexpubkey: e.author.hexpubkey,
            profile: e.author.profile
          } : null
        })) as NDKEvent[];
        
        lastEventTime = (cacheData as any).lastEventTime || 0;
        
        console.log(`📦 Loaded ${events.length} events from compressed cache`);
        return true;
      }
      
      // Fallback to localStorage
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return false;
      
      const fallbackCacheData = JSON.parse(cached);
      const now = Date.now();
      
      // Check if cache is still valid
      if (now - fallbackCacheData.timestamp > CACHE_EXPIRY) {
        localStorage.removeItem(CACHE_KEY);
        return false;
      }
      
      // Restore events from localStorage cache
      events = fallbackCacheData.events.map((e: any) => ({
        ...e,
        author: e.author ? {
          hexpubkey: e.author.hexpubkey,
          profile: e.author.profile
        } : null
      })) as NDKEvent[];
      
      lastEventTime = fallbackCacheData.lastEventTime || 0;
      
      console.log(`📦 Loaded ${events.length} events from localStorage cache (fallback)`);
      return true;
      
    } catch (err) {
      console.warn('⚠️ Failed to load cached events:', err);
      // Clean up corrupted cache
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch (cleanupErr) {
        console.warn('Failed to cleanup corrupted cache:', cleanupErr);
      }
      return false;
    }
  }

  // Utility function to handle image/video errors
  function handleMediaError(e: Event) {
    const target = e.target;
    if (target && 'style' in target) {
      (target as any).style.display = 'none';
    }
  }

  async function loadFoodstrFeed(useCache = true) {
    try {
      const filter = {
        kinds: [1],
        '#t': ['foodstr', 'cook', 'cookstr', 'zapcooking', 'cooking', 'drinkstr', 'foodies', 'carnivor', 'carnivorediet'],
        limit: 20, // Reduced initial limit for faster loading
        since: Math.floor(Date.now() / 1000) - (3 * 24 * 60 * 60) // Reduced to 3 days for faster loading
      };

      // Try to load from cache first (simplified for now)
      if (useCache && await loadCachedEvents()) {
        loading = false;
        error = false;
        cacheLoaded = true;
        debugInfo = `Loaded ${events.length} events from cache`;
        
        // Trigger background refresh
        setTimeout(() => fetchFreshData(), 100);
        return;
      }
      
      loading = true;
      error = false;
      events = [];
      cacheLoaded = false;
      
      console.log('🍽️ Loading cooking feed...');
      debugInfo = 'Loading cooking feed...';
      
      // Check if NDK is connected
      if (!$ndk) {
        throw new Error('NDK not initialized');
      }

      // Ensure NDK is connected before making requests
      try {
        await $ndk.connect();
      } catch (connectError) {
        console.warn('Failed to connect NDK, proceeding anyway:', connectError);
      }
      
      console.log('🔍 Filter:', filter);
      
      // Use subscribe instead of fetchEvents
      let eventCount = 0;
      const subscription = $ndk.subscribe(filter, { closeOnEose: false });
      
      const subscriptionPromise = new Promise<NDKEvent[]>((resolve, reject) => {
        const receivedEvents: NDKEvent[] = [];
        let eoseCount = 0;
        let resolved = false;
        
        subscription.on('event', (event: NDKEvent) => {
          receivedEvents.push(event);
          eventCount++;
        });
        
        subscription.on('eose', () => {
          eoseCount++;
          console.log(`📊 EOSE received from relay ${eoseCount}`);
          // Resolve after first EOSE or timeout
          if (!resolved) {
            resolved = true;
            console.log('📊 Fetched events:', eventCount);
            subscription.stop();
            resolve(receivedEvents);
          }
        });
        
        // Timeout to resolve with whatever events were collected
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log('⏱️ Timeout reached, resolving with', eventCount, 'events');
            subscription.stop();
            resolve(receivedEvents);
          }
        }, 5000); // Reduced timeout to 5 seconds for faster response
      });
      
      const fetchedEvents = await subscriptionPromise;
      
      if (fetchedEvents.length > 0) {
        // Sort by newest first
        events = fetchedEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
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
    // Initialize subscription manager if needed
    if (!subscriptionManager) {
      subscriptionManager = createSubscriptionManager($ndk);
    }
    
    console.log('🔄 Starting real-time subscription...');
    
    const subscriptionFilter = {
      kinds: [1],
      '#t': ['foodstr', 'cook', 'cookstr', 'zapcooking', 'cooking', 'drinkstr', 'foodies', 'carnivor', 'carnivorediet'],
      since: lastEventTime + 1 // Only get events newer than what we have
    };
    
    subscription = subscriptionManager.subscribe({
      id: 'foodstr-feed-realtime',
      filter: subscriptionFilter,
      onEvent: (event: NDKEvent) => {
        // Reduce logging frequency - only log every 10th event
        if (pendingEvents.length % 10 === 0) {
          console.log('📨 New real-time event:', event.id);
        }
        
        // Add to pending batch
        pendingEvents.push(event);
        
        // Debounced batch processing
        debouncedBatchProcess();
      },
      onEose: () => {
        console.log('🏁 Real-time subscription established');
      },
      closeOnEose: false
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
      
      const subscription = $ndk.subscribe(filter, { closeOnEose: false });
      const fetchedEvents: NDKEvent[] = [];
      
      await new Promise<void>((resolve) => {
        let resolved = false;
        
        subscription.on('event', (event: NDKEvent) => {
          fetchedEvents.push(event);
        });
        
        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            if (fetchedEvents.length > 0) {
              const sortedEvents = fetchedEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              
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
            resolve();
          }
        });
        
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            console.log('⏱️ Background refresh timeout, collected', fetchedEvents.length, 'events');
            if (fetchedEvents.length > 0) {
              const sortedEvents = fetchedEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
              
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
            resolve();
          }
        }, 5000);
      });
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

      const subscription = $ndk.subscribe(filter, { closeOnEose: false });
      const newEvents: NDKEvent[] = [];
      
      await new Promise<void>((resolve) => {
        let resolved = false;
        
        subscription.on('event', (event: NDKEvent) => {
          newEvents.push(event);
        });
        
        subscription.on('eose', () => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            if (newEvents.length > 0) {
              events = [...events, ...newEvents];
              hasMore = newEvents.length === 20;
              // Cache the updated events
              cacheEvents();
            } else {
              hasMore = false;
            }
            resolve();
          }
        });
        
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            subscription.stop();
            console.log('⏱️ Load more timeout, collected', newEvents.length, 'events');
            if (newEvents.length > 0) {
              events = [...events, ...newEvents];
              hasMore = newEvents.length === 20;
              // Cache the updated events
              cacheEvents();
            } else {
              hasMore = false;
            }
            resolve();
          }
        }, 5000);
      });
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
    try {
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
      
      // All attempts failed
      console.error('❌ All retry attempts failed');
      error = true;
      loading = false;
      debugInfo = 'Failed to load feed after multiple attempts. Please check your connection.';
    } catch (err) {
      console.error('❌ Critical error in retryWithDelay:', err);
      error = true;
      loading = false;
      debugInfo = 'Critical error occurred. Please refresh the page.';
    }
  }

  // Cleanup function
  function cleanup() {
    console.log('🧹 Cleaning up subscriptions...');
    
    if (subscriptionManager) {
      subscriptionManager.unsubscribe('foodstr-feed-realtime');
    }
    
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    
    // Process any remaining pending events
    if (pendingEvents.length > 0) {
      processBatch();
    }
    
    // Cleanup stale cache entries
    compressedCacheManager.invalidateStale();
  }

  onMount(() => {
    try {
      retryWithDelay();
    } catch (error) {
      console.error('❌ Error in FoodstrFeedOptimized onMount:', error);
      loading = false;
      error = true;
      debugInfo = 'Failed to initialize feed. Please refresh the page.';
    }
  });

  onDestroy(() => {
    cleanup();
  });

  function formatTimeAgo(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }


  // Simple functions (memoization temporarily disabled to avoid crashes)
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

  // Simple image optimization (no memoization for now)
  function getOptimizedImageUrl(url: string): string {
    return optimizeImageUrl(url, {
      width: 640,
      quality: 85,
      format: getOptimalFormat()
    });
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
    console.log('Opening zap modal for event:', event);
    console.log('Event ID:', event.id);
    console.log('Event author:', event.author);
    console.log('Event author pubkey:', event.author?.hexpubkey || event.pubkey);
    selectedEvent = event;
    zapModal = true;
    console.log('Zap modal state:', zapModal);
    console.log('Selected event set to:', selectedEvent);
  }
</script>

<FeedErrorBoundary>
  <div class="max-w-2xl mx-auto">
  
  <!-- Refresh indicator -->
  {#if isRefreshing}
    <div class="mb-4">
      <LoadingState 
        type="spinner" 
        size="sm" 
        text="Refreshing feed..." 
        showText={true}
      />
    </div>
  {/if}

  {#if loading}
    <!-- Enhanced skeleton loading -->
    <div class="space-y-6">
      {#each Array(3) as _}
        <FeedPostSkeleton />
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
              <CustomAvatar
                className="cursor-pointer"
                pubkey={event.author.hexpubkey}
                size={40}
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
                            src={getOptimizedImageUrl(imageUrl)} 
                            alt="Preview"
                            class="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                            on:error={handleMediaError}
                          />
                        {:else if isVideoUrl(imageUrl)}
                          <video 
                            src={imageUrl} 
                            controls 
                            class="w-full h-full object-cover"
                            preload="metadata"
                            on:error={handleMediaError}
                          >
                            <track kind="captions" src="" srclang="en" label="English" />
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
                  <NoteTotalComments {event} />
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
            <LoadingState 
              type="spinner" 
              size="lg" 
              text="Loading more posts..." 
              showText={true}
            />
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
</FeedErrorBoundary>

<!-- Zap Modal -->
{#if zapModal && selectedEvent}
  <ZapModal 
    bind:open={zapModal}
    event={selectedEvent} 
  />
{/if}
