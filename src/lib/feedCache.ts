import { cacheManager, FEED_CACHE_CONFIG, createCacheKey } from './cache';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

export interface FeedCacheData {
  events: NDKEvent[];
  lastFetched: number;
  filter: any;
}

export interface FeedCacheOptions {
  filter: any;
  maxAge?: number; // Override default TTL
  backgroundRefresh?: boolean; // Whether to refresh in background
}

export class FeedCacheService {
  private static instance: FeedCacheService;
  private refreshPromises: Map<string, Promise<NDKEvent[]>> = new Map();

  private constructor() {}

  static getInstance(): FeedCacheService {
    if (!FeedCacheService.instance) {
      FeedCacheService.instance = new FeedCacheService();
    }
    return FeedCacheService.instance;
  }

  /**
   * Get cached feed data
   */
  async getCachedFeed(options: FeedCacheOptions): Promise<NDKEvent[] | null> {
    const cacheKey = createCacheKey('feed_events', options.filter);
    const config = {
      ...FEED_CACHE_CONFIG,
      key: cacheKey,
      ttl: options.maxAge || FEED_CACHE_CONFIG.ttl
    };

    const cachedData = await cacheManager.get<FeedCacheData>(config);
    
    if (!cachedData) {
      return null;
    }

    // Check if cache is still fresh enough for immediate display
    const age = Date.now() - cachedData.lastFetched;
    const maxStaleAge = config.ttl / 2; // Consider stale after half the TTL

    if (age > maxStaleAge && options.backgroundRefresh) {
      // Cache is stale, trigger background refresh
      this.refreshInBackground(options);
    }

    return cachedData.events;
  }

  /**
   * Cache feed data
   */
  async setCachedFeed(events: NDKEvent[], options: FeedCacheOptions): Promise<void> {
    const cacheKey = createCacheKey('feed_events', options.filter);
    const config = {
      ...FEED_CACHE_CONFIG,
      key: cacheKey,
      ttl: options.maxAge || FEED_CACHE_CONFIG.ttl
    };

    const cacheData: FeedCacheData = {
      events,
      lastFetched: Date.now(),
      filter: options.filter
    };

    await cacheManager.set(config, cacheData);
  }

  /**
   * Refresh feed data in background
   */
  async refreshInBackground(options: FeedCacheOptions): Promise<void> {
    const cacheKey = createCacheKey('feed_events', options.filter);
    
    // Prevent multiple simultaneous refreshes for the same filter
    if (this.refreshPromises.has(cacheKey)) {
      return this.refreshPromises.get(cacheKey);
    }

    const refreshPromise = this.performBackgroundRefresh(options);
    this.refreshPromises.set(cacheKey, refreshPromise);

    try {
      await refreshPromise;
    } finally {
      this.refreshPromises.delete(cacheKey);
    }
  }

  /**
   * Perform actual background refresh
   */
  private async performBackgroundRefresh(options: FeedCacheOptions): Promise<NDKEvent[]> {
    // This will be called by the feed component with the actual fetch logic
    // For now, we'll emit an event that the feed component can listen to
    const event = new CustomEvent('feed-background-refresh', {
      detail: { options }
    });
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(event);
    }

    // Return empty array as placeholder - actual data will come from the event handler
    return [];
  }

  /**
   * Invalidate cache for specific filter
   */
  async invalidateCache(options: FeedCacheOptions): Promise<void> {
    const cacheKey = createCacheKey('feed_events', options.filter);
    await cacheManager.delete(cacheKey);
  }

  /**
   * Clear all feed cache
   */
  async clearAllCache(): Promise<void> {
    // Clear all cache entries that start with 'feed_events'
    if (typeof window !== 'undefined') {
      const keys = Object.keys(localStorage).filter(key => 
        key.startsWith('cache_feed_events')
      );
      
      for (const key of keys) {
        await cacheManager.delete(key.replace('cache_', ''));
      }
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalItems: number;
    totalSize: number;
    feedItems: number;
    oldestItem?: number;
  }> {
    const info = await cacheManager.getInfo();
    
    let feedItems = 0;
    let oldestItem: number | undefined;

    if (typeof window !== 'undefined') {
      const keys = Object.keys(localStorage).filter(key => 
        key.startsWith('cache_feed_events')
      );
      
      feedItems = keys.length;

      // Find oldest item
      for (const key of keys) {
        try {
          const item = localStorage.getItem(key);
          if (item) {
            const parsed = JSON.parse(item);
            if (!oldestItem || parsed.timestamp < oldestItem) {
              oldestItem = parsed.timestamp;
            }
          }
        } catch (error) {
          console.warn('Failed to parse cache item:', error);
        }
      }
    }

    return {
      totalItems: info.items,
      totalSize: info.size,
      feedItems,
      oldestItem
    };
  }

  /**
   * Check if cache needs refresh
   */
  async needsRefresh(options: FeedCacheOptions): Promise<boolean> {
    const cacheKey = createCacheKey('feed_events', options.filter);
    const config = {
      ...FEED_CACHE_CONFIG,
      key: cacheKey,
      ttl: options.maxAge || FEED_CACHE_CONFIG.ttl
    };

    const cachedData = await cacheManager.get<FeedCacheData>(config);
    
    if (!cachedData) {
      return true;
    }

    const age = Date.now() - cachedData.lastFetched;
    return age > config.ttl;
  }
}

// Export singleton instance
export const feedCacheService = FeedCacheService.getInstance();

// Export utility functions
export function createFeedCacheKey(filter: any): string {
  return createCacheKey('feed_events', filter);
}

export function shouldUseCache(maxAge: number = 5 * 60 * 1000): boolean {
  // Simple heuristic: use cache if we're not in a hurry
  return typeof window !== 'undefined' && 'localStorage' in window;
}


