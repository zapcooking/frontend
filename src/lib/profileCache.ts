import type { NDKUser } from '@nostr-dev-kit/ndk';
import { writable } from 'svelte/store';
import { performanceMonitor } from './performanceMonitor';

interface ProfileCacheEntry {
  user: NDKUser;
  profile: any;
  timestamp: number;
  expiresAt: number;
}

interface ProfileCache {
  [pubkey: string]: ProfileCacheEntry;
}

// Cache store
const profileCache = writable<ProfileCache>({});

// Cache configuration
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000; // Maximum number of profiles to cache

// Cache management
export class ProfileCacheManager {
  private static instance: ProfileCacheManager;
  private cache: ProfileCache = {};
  private fetchPromises: Map<string, Promise<NDKUser | null>> = new Map();

  static getInstance(): ProfileCacheManager {
    if (!ProfileCacheManager.instance) {
      ProfileCacheManager.instance = new ProfileCacheManager();
    }
    return ProfileCacheManager.instance;
  }

  private constructor() {
    profileCache.subscribe(cache => {
      this.cache = cache;
    });
  }

  private isExpired(entry: ProfileCacheEntry): boolean {
    return Date.now() > entry.expiresAt;
  }

  private cleanup(): void {
    const now = Date.now();
    const entries = Object.entries(this.cache);
    
    // Remove expired entries
    const validEntries = entries.filter(([_, entry]) => !this.isExpired(entry));
    
    // If still over limit, remove oldest entries
    if (validEntries.length > MAX_CACHE_SIZE) {
      validEntries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      validEntries.splice(0, validEntries.length - MAX_CACHE_SIZE);
    }
    
    // Update cache
    const newCache: ProfileCache = {};
    validEntries.forEach(([pubkey, entry]) => {
      newCache[pubkey] = entry;
    });
    
    profileCache.set(newCache);
  }

  async getProfile(pubkey: string, ndk: any): Promise<NDKUser | null> {
    if (!pubkey || !ndk) return null;

    // Check if we already have a valid cached entry
    const cached = this.cache[pubkey];
    if (cached && !this.isExpired(cached)) {
      performanceMonitor.recordProfileCacheHit();
      return cached.user;
    }

    // Check if we're already fetching this profile
    if (this.fetchPromises.has(pubkey)) {
      return this.fetchPromises.get(pubkey)!;
    }

    // Start fetching
    const fetchPromise = this.fetchProfile(pubkey, ndk);
    this.fetchPromises.set(pubkey, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.fetchPromises.delete(pubkey);
    }
  }

  private async fetchProfile(pubkey: string, ndk: any): Promise<NDKUser | null> {
    performanceMonitor.recordProfileCacheMiss();
    const startTime = Date.now();
    
    try {
      const user = await ndk.getUser({ hexpubkey: pubkey });
      if (user) {
        await user.fetchProfile();
        
        // Cache the result
        const entry: ProfileCacheEntry = {
          user,
          profile: user.profile,
          timestamp: Date.now(),
          expiresAt: Date.now() + CACHE_DURATION
        };

        profileCache.update(cache => {
          cache[pubkey] = entry;
          return cache;
        });

        // Cleanup old entries
        this.cleanup();

        performanceMonitor.recordProfileFetch(startTime);
        return user;
      }
    } catch (error) {
      console.warn('Failed to fetch profile for', pubkey, error);
      performanceMonitor.recordProfileFetch(startTime);
    }

    return null;
  }

  // Get cached profile without fetching
  getCachedProfile(pubkey: string): NDKUser | null {
    const cached = this.cache[pubkey];
    if (cached && !this.isExpired(cached)) {
      return cached.user;
    }
    return null;
  }

  // Invalidate cache for a specific pubkey
  invalidateProfile(pubkey: string): void {
    profileCache.update(cache => {
      delete cache[pubkey];
      return cache;
    });
  }

  // Clear all cache
  clearCache(): void {
    profileCache.set({});
  }

  // Get cache stats
  getCacheStats(): { size: number; expired: number; valid: number } {
    const entries = Object.values(this.cache);
    const now = Date.now();
    
    return {
      size: entries.length,
      expired: entries.filter(entry => this.isExpired(entry)).length,
      valid: entries.filter(entry => !this.isExpired(entry)).length
    };
  }
}

// Export singleton instance
export const profileCacheManager = ProfileCacheManager.getInstance();
