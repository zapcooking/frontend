import type NDK from '@nostr-dev-kit/ndk';
import type { NDKUser } from '@nostr-dev-kit/ndk';
import { writable } from 'svelte/store';
import { performanceMonitor } from './performanceMonitor';
import { ndkReady, getNdkInstance, isNdkReady } from './nostr';

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
const PROFILE_FETCH_TIMEOUT = 5000; // 5 seconds timeout for profile fetches

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

  /**
   * Get a profile, waiting for NDK to be ready if needed.
   * Can be called without passing NDK - will use the global instance.
   */
  async getProfile(pubkey: string, ndk?: NDK): Promise<NDKUser | null> {
    if (!pubkey) return null;

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

  private async fetchProfile(pubkey: string, ndkParam?: NDK): Promise<NDKUser | null> {
    performanceMonitor.recordProfileCacheMiss();
    const startTime = Date.now();
    
    try {
      // Wait for NDK to be ready before attempting fetch
      await ndkReady;
      
      // Get NDK instance - use passed instance or get global
      const ndk = ndkParam || getNdkInstance();
      
      if (!ndk) {
        console.warn('[profileCache] NDK not available for profile fetch');
        return null;
      }
      
      // Use ndk.getUser() to properly bind user to NDK instance
      const user = ndk.getUser({ pubkey });
      
      // Add timeout to prevent hanging
      const fetchPromise = user.fetchProfile();
      const timeoutPromise = new Promise<void>((resolve) => 
        setTimeout(() => resolve(), PROFILE_FETCH_TIMEOUT)
      );
      
      await Promise.race([fetchPromise, timeoutPromise]);
        
      // Cache the result (even if profile is null, cache will have the user)
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
