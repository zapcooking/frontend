import type { NDKEvent } from '@nostr-dev-kit/ndk';

export interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  version: string;
}

export interface CacheConfig {
  key: string;
  ttl: number; // Time to live in milliseconds
  version?: string; // For cache invalidation
  useIndexedDB?: boolean; // Use IndexedDB for large data
}

export class CacheManager {
  private static instance: CacheManager;
  private db: IDBDatabase | null = null;
  private dbName = 'ZapCookingCache';
  private dbVersion = 1;

  private constructor() {
    this.initIndexedDB();
  }

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  private async initIndexedDB(): Promise<void> {
    if (typeof window === 'undefined') return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object store for cache
        if (!db.objectStoreNames.contains('cache')) {
          const store = db.createObjectStore('cache', { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });
        }
      };
    });
  }

  /**
   * Set data in cache
   */
  async set<T>(config: CacheConfig, data: T): Promise<void> {
    const cacheItem: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + config.ttl,
      version: config.version || '1.0'
    };

    if (config.useIndexedDB && this.db) {
      await this.setIndexedDB(config.key, cacheItem);
    } else {
      this.setLocalStorage(config.key, cacheItem);
    }
  }

  /**
   * Get data from cache
   */
  async get<T>(config: CacheConfig): Promise<T | null> {
    let cacheItem: CacheItem<T> | null = null;

    if (config.useIndexedDB && this.db) {
      cacheItem = await this.getIndexedDB<T>(config.key);
    } else {
      cacheItem = this.getLocalStorage<T>(config.key);
    }

    if (!cacheItem) {
      return null;
    }

    // Check if expired
    if (Date.now() > cacheItem.expiresAt) {
      await this.delete(config.key);
      return null;
    }

    return cacheItem.data;
  }

  /**
   * Check if cache exists and is valid
   */
  async has(config: CacheConfig): Promise<boolean> {
    const data = await this.get(config);
    return data !== null;
  }

  /**
   * Delete from cache
   */
  async delete(key: string): Promise<void> {
    if (this.db) {
      await this.deleteIndexedDB(key);
    }
    this.deleteLocalStorage(key);
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    if (this.db) {
      await this.clearIndexedDB();
    }
    this.clearLocalStorage();
  }

  /**
   * Get cache info (size, age, etc.)
   */
  async getInfo(): Promise<{ size: number; items: number }> {
    if (this.db) {
      return this.getIndexedDBInfo();
    }
    return this.getLocalStorageInfo();
  }

  // IndexedDB methods
  private async setIndexedDB<T>(key: string, item: CacheItem<T>): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const request = store.put({ key, ...item });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async getIndexedDB<T>(key: string): Promise<CacheItem<T> | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? { 
          data: result.data, 
          timestamp: result.timestamp, 
          expiresAt: result.expiresAt,
          version: result.version 
        } : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async deleteIndexedDB(key: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async clearIndexedDB(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readwrite');
      const store = transaction.objectStore('cache');
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private async getIndexedDBInfo(): Promise<{ size: number; items: number }> {
    if (!this.db) return { size: 0, items: 0 };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['cache'], 'readonly');
      const store = transaction.objectStore('cache');
      const request = store.count();

      request.onsuccess = () => {
        resolve({ size: 0, items: request.result }); // Size calculation would be complex
      };
      request.onerror = () => reject(request.error);
    });
  }

  // LocalStorage methods
  private setLocalStorage<T>(key: string, item: CacheItem<T>): void {
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.setItem(`cache_${key}`, JSON.stringify(item));
    } catch (error) {
      console.warn('Failed to set localStorage cache:', error);
    }
  }

  private getLocalStorage<T>(key: string): CacheItem<T> | null {
    if (typeof window === 'undefined') return null;

    try {
      const item = localStorage.getItem(`cache_${key}`);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      console.warn('Failed to get localStorage cache:', error);
      return null;
    }
  }

  private deleteLocalStorage(key: string): void {
    if (typeof window === 'undefined') return;
    
    try {
      localStorage.removeItem(`cache_${key}`);
    } catch (error) {
      console.warn('Failed to delete localStorage cache:', error);
    }
  }

  private clearLocalStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith('cache_'));
      keys.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.warn('Failed to clear localStorage cache:', error);
    }
  }

  private getLocalStorageInfo(): { size: number; items: number } {
    if (typeof window === 'undefined') return { size: 0, items: 0 };

    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith('cache_'));
      let size = 0;
      
      keys.forEach(key => {
        const item = localStorage.getItem(key);
        if (item) {
          size += item.length;
        }
      });

      return { size, items: keys.length };
    } catch (error) {
      console.warn('Failed to get localStorage info:', error);
      return { size: 0, items: 0 };
    }
  }
}

// Convenience functions for common use cases
export const cacheManager = CacheManager.getInstance();

/**
 * Cache configuration for feed data
 */
export const FEED_CACHE_CONFIG: CacheConfig = {
  key: 'feed_events',
  ttl: 5 * 60 * 1000, // 5 minutes
  version: '1.0',
  useIndexedDB: true // Use IndexedDB for potentially large feed data
};

/**
 * Cache configuration for user profiles
 */
export const PROFILE_CACHE_CONFIG: CacheConfig = {
  key: 'user_profiles',
  ttl: 30 * 60 * 1000, // 30 minutes
  version: '1.0',
  useIndexedDB: false // Use localStorage for smaller profile data
};

/**
 * Cache configuration for tags
 */
export const TAGS_CACHE_CONFIG: CacheConfig = {
  key: 'tags_data',
  ttl: 60 * 60 * 1000, // 1 hour
  version: '1.0',
  useIndexedDB: false
};

/**
 * Utility function to create cache key with filters
 */
export function createCacheKey(baseKey: string, filters: Record<string, any>): string {
  const sortedFilters = Object.keys(filters)
    .sort()
    .map(key => `${key}:${JSON.stringify(filters[key])}`)
    .join('|');
  
  return `${baseKey}_${btoa(sortedFilters).replace(/[^a-zA-Z0-9]/g, '')}`;
}

/**
 * Utility function to check if cache is stale
 */
export function isCacheStale(timestamp: number, maxAge: number): boolean {
  return Date.now() - timestamp > maxAge;
}

