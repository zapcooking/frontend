/**
 * Engagement Preloader
 * 
 * Progressive lazy loading for engagement data (reactions, comments, reposts, zaps).
 * Preloads data well before items come into view, so counts are ready when visible.
 * 
 * Strategy:
 * 1. FAR AHEAD (1000px): Start fast COUNT query via server API
 * 2. NEAR (300px): Start full NDK subscription for accurate counts + user state
 * 3. VISIBLE: Data should already be loaded, just display it
 */

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import { batchFetchFromServerAPI, type EngagementCounts } from './countQuery';
import { getEngagementStore, fetchEngagement } from './engagementCache';

// Configuration
const FAR_AHEAD_MARGIN = 1000; // Start COUNT query 1000px before visible
const NEAR_MARGIN = 300;       // Start full subscription 300px before visible
const BATCH_SIZE = 10;         // How many items to batch together
const BATCH_DELAY = 50;        // ms to wait before processing batch

// Track preloading state
interface PreloadState {
  farAhead: Set<string>;  // Items queued for COUNT preload
  near: Set<string>;      // Items queued for full subscription
  loading: Set<string>;   // Items currently loading
  loaded: Set<string>;    // Items fully loaded
}

const preloadState: PreloadState = {
  farAhead: new Set(),
  near: new Set(),
  loading: new Set(),
  loaded: new Set()
};

// Batch queue for efficient API calls
let batchQueue: string[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

// Store for preloader status (for debugging/UI)
export const preloaderStatus = writable({
  queued: 0,
  loading: 0,
  loaded: 0
});

function updateStatus() {
  preloaderStatus.set({
    queued: preloadState.farAhead.size + preloadState.near.size,
    loading: preloadState.loading.size,
    loaded: preloadState.loaded.size
  });
}

/**
 * Process the batch queue - fetch counts for queued items
 */
async function processBatchQueue() {
  if (batchQueue.length === 0) return;
  
  const itemsToProcess = batchQueue.splice(0, BATCH_SIZE);
  
  // Filter out already loaded items
  const toFetch = itemsToProcess.filter(id => 
    !preloadState.loaded.has(id) && !preloadState.loading.has(id)
  );
  
  if (toFetch.length === 0) return;
  
  // Mark as loading
  toFetch.forEach(id => {
    preloadState.loading.add(id);
    preloadState.farAhead.delete(id);
  });
  updateStatus();
  
  try {
    // Batch fetch from server API (fast path)
    const results = await batchFetchFromServerAPI(toFetch);
    
    // Update engagement stores with results
    for (const [eventId, counts] of results) {
      const store = getEngagementStore(eventId);
      store.update(s => ({
        ...s,
        reactions: {
          ...s.reactions,
          count: counts.reactions ?? s.reactions.count
        },
        comments: {
          count: counts.comments ?? s.comments.count
        },
        reposts: {
          count: counts.reposts ?? s.reposts.count,
          userReposted: s.reposts.userReposted
        },
        zaps: {
          ...s.zaps,
          count: counts.zaps ?? s.zaps.count
        },
        loading: false,
        lastFetched: Date.now()
      }));
      
      preloadState.loading.delete(eventId);
      preloadState.loaded.add(eventId);
    }
  } catch (error) {
    // On error, remove from loading so it can be retried
    toFetch.forEach(id => preloadState.loading.delete(id));
  }
  
  updateStatus();
  
  // Process more if queue has items
  if (batchQueue.length > 0) {
    batchTimeout = setTimeout(processBatchQueue, BATCH_DELAY);
  }
}

/**
 * Queue an event for COUNT preloading (far ahead)
 */
function queueForCountPreload(eventId: string) {
  if (preloadState.loaded.has(eventId) || 
      preloadState.loading.has(eventId) ||
      preloadState.farAhead.has(eventId)) {
    return;
  }
  
  preloadState.farAhead.add(eventId);
  batchQueue.push(eventId);
  updateStatus();
  
  // Debounce batch processing
  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }
  batchTimeout = setTimeout(processBatchQueue, BATCH_DELAY);
}

/**
 * Start full subscription for an event (near viewport)
 */
function startFullSubscription(ndk: NDK, eventId: string, userPublickey: string) {
  if (preloadState.near.has(eventId)) return;
  
  preloadState.near.add(eventId);
  updateStatus();
  
  // Use the existing fetchEngagement which handles full subscriptions
  fetchEngagement(ndk, eventId, userPublickey);
}

/**
 * Create an Intersection Observer action for progressive engagement loading
 * 
 * Usage in Svelte component:
 * <div use:engagementPreloadAction={{ eventId: event.id, ndk: $ndk, userPublickey: $userPublickey }}>
 */
export function engagementPreloadAction(
  node: HTMLElement,
  params: { eventId: string; ndk: NDK; userPublickey: string }
) {
  if (!browser) return;
  
  const { eventId, ndk, userPublickey } = params;
  
  // Far ahead observer - triggers COUNT preload
  const farAheadObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        queueForCountPreload(eventId);
      }
    },
    { rootMargin: `${FAR_AHEAD_MARGIN}px 0px ${FAR_AHEAD_MARGIN}px 0px` }
  );
  
  // Near observer - triggers full subscription
  const nearObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        startFullSubscription(ndk, eventId, userPublickey);
        nearObserver.disconnect(); // Only need to trigger once
      }
    },
    { rootMargin: `${NEAR_MARGIN}px 0px ${NEAR_MARGIN}px 0px` }
  );
  
  farAheadObserver.observe(node);
  nearObserver.observe(node);
  
  return {
    destroy() {
      farAheadObserver.disconnect();
      nearObserver.disconnect();
    },
    update(newParams: { eventId: string; ndk: NDK; userPublickey: string }) {
      // Handle parameter updates if needed
    }
  };
}

/**
 * Preload engagement for a list of events (e.g., when feed loads)
 * Useful for initial batch loading
 */
export async function preloadEngagementBatch(eventIds: string[]): Promise<void> {
  if (!browser || eventIds.length === 0) return;
  
  // Queue all for COUNT preload
  eventIds.forEach(id => queueForCountPreload(id));
}

/**
 * Create a continuous subscription that keeps loading events in background
 * Returns a cleanup function
 */
export function createBackgroundEngagementLoader(
  ndk: NDK,
  userPublickey: string,
  getVisibleEventIds: () => string[]
): () => void {
  if (!browser) return () => {};
  
  let isRunning = true;
  let subscription: NDKSubscription | null = null;
  
  async function loadLoop() {
    while (isRunning) {
      const visibleIds = getVisibleEventIds();
      
      // Get IDs that need full subscription but haven't started yet
      const needsSubscription = visibleIds.filter(id => 
        !preloadState.loaded.has(id) && 
        !preloadState.loading.has(id)
      );
      
      if (needsSubscription.length > 0) {
        // Start subscriptions for visible items
        for (const eventId of needsSubscription.slice(0, 5)) {
          startFullSubscription(ndk, eventId, userPublickey);
        }
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  loadLoop();
  
  return () => {
    isRunning = false;
    if (subscription) {
      subscription.stop();
    }
  };
}

/**
 * Reset preloader state (e.g., when changing feeds)
 */
export function resetPreloader(): void {
  preloadState.farAhead.clear();
  preloadState.near.clear();
  preloadState.loading.clear();
  preloadState.loaded.clear();
  batchQueue = [];
  if (batchTimeout) {
    clearTimeout(batchTimeout);
    batchTimeout = null;
  }
  updateStatus();
}

/**
 * Get preload progress for an event
 */
export function getPreloadProgress(eventId: string): 'queued' | 'loading' | 'loaded' | 'none' {
  if (preloadState.loaded.has(eventId)) return 'loaded';
  if (preloadState.loading.has(eventId)) return 'loading';
  if (preloadState.farAhead.has(eventId) || preloadState.near.has(eventId)) return 'queued';
  return 'none';
}
