/**
 * Enhanced caching with compression and smart invalidation
 */

import { CacheManager } from './cache';

export interface CacheConfig {
  key: string;
  ttl: number; // Time to live in milliseconds
  version?: string; // For cache invalidation
  useIndexedDB?: boolean; // Use IndexedDB for large data
}

export interface CacheItem<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  version: string;
  metadata?: {
    compressed?: boolean;
    originalSize?: number;
    compressedSize?: number;
    compressionLevel?: string;
  };
}

export interface CompressedCacheConfig extends CacheConfig {
  compressionLevel?: 'gzip' | 'deflate' | 'deflate-raw';
  enableCompression?: boolean;
  enableEncryption?: boolean;
  encryptionKey?: string;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  compressions: number;
  decompressions: number;
  compressionRatio: number;
  totalSize: number;
  compressedSize: number;
}

export class CompressedCacheManager extends CacheManager {
  private static instance: CompressedCacheManager;
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    compressions: 0,
    decompressions: 0,
    compressionRatio: 0,
    totalSize: 0,
    compressedSize: 0
  };

  private compressionEnabled = true;
  private compressionLevel: 'gzip' | 'deflate' | 'deflate-raw' = 'gzip';

  constructor() {
    super();
    this.detectCompressionSupport();
  }

  static getInstance(): CompressedCacheManager {
    if (!CompressedCacheManager.instance) {
      CompressedCacheManager.instance = new CompressedCacheManager();
    }
    return CompressedCacheManager.instance;
  }

  private detectCompressionSupport(): void {
    // Check if CompressionStream is available
    if (typeof window !== 'undefined' && 'CompressionStream' in window) {
      this.compressionEnabled = true;
    } else {
      console.warn('Compression not supported, falling back to uncompressed caching');
      this.compressionEnabled = false;
    }
  }

  /**
   * Set data with compression
   */
  async set<T>(config: CompressedCacheConfig, data: T): Promise<void> {
    const startTime = Date.now();
    
    try {
      const serializedData = JSON.stringify(data);
      const originalSize = new Blob([serializedData]).size;
      
      let processedData: string;
      let compressed = false;
      
      if (this.compressionEnabled && config.enableCompression !== false) {
        processedData = await this.compress(serializedData, config.compressionLevel);
        compressed = true;
        this.metrics.compressions++;
      } else {
        processedData = serializedData;
      }
      
      const compressedSize = new Blob([processedData]).size;
      
      // Update metrics
      this.metrics.totalSize += originalSize;
      this.metrics.compressedSize += compressedSize;
      this.metrics.compressionRatio = this.metrics.totalSize > 0 
        ? this.metrics.compressedSize / this.metrics.totalSize 
        : 1;
      
      const cacheItem: CacheItem<T> = {
        data: processedData as T,
        timestamp: Date.now(),
        expiresAt: Date.now() + config.ttl,
        version: config.version,
        metadata: {
          compressed,
          originalSize,
          compressedSize,
          compressionLevel: config.compressionLevel || 'balanced'
        }
      };
      
      await super.set(config, cacheItem);
      
      console.log(`📦 Cached ${config.key}: ${originalSize} → ${compressedSize} bytes (${compressed ? 'compressed' : 'uncompressed'})`);
      
    } catch (error) {
      console.error('Failed to set compressed cache:', error);
      // Fallback to uncompressed
      await super.set(config, data);
    }
  }

  /**
   * Get data with decompression
   */
  async get<T>(config: CompressedCacheConfig): Promise<T | null> {
    try {
      const cacheItem = await super.get<CacheItem<T>>(config);
      
      if (!cacheItem) {
        this.metrics.misses++;
        return null;
      }
      
      this.metrics.hits++;
      
      // Check if data is compressed
      const metadata = (cacheItem as any).metadata;
      if (metadata?.compressed && this.compressionEnabled) {
        const decompressedData = await this.decompress(cacheItem.data as string);
        this.metrics.decompressions++;
        return JSON.parse(decompressedData);
      }
      
      return cacheItem.data;
      
    } catch (error) {
      console.error('Failed to get compressed cache:', error);
      this.metrics.misses++;
      return null;
    }
  }

  /**
   * Compress data using CompressionStream API
   */
  private async compress(data: string, level: 'gzip' | 'deflate' | 'deflate-raw' = 'gzip'): Promise<string> {
    if (!this.compressionEnabled) {
      return data;
    }

    try {
      const encoder = new TextEncoder();
      const stream = new CompressionStream(level);
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      
      // Write data to compression stream
      await writer.write(encoder.encode(data));
      await writer.close();
      
      // Read compressed data
      const chunks: Uint8Array[] = [];
      let done = false;
      
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          chunks.push(value);
        }
      }
      
      // Convert to base64 for storage
      const compressed = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }
      
      return btoa(String.fromCharCode(...compressed));
      
    } catch (error) {
      console.warn('Compression failed, using uncompressed data:', error);
      return data;
    }
  }

  /**
   * Decompress data using DecompressionStream API
   */
  private async decompress(compressedData: string): Promise<string> {
    if (!this.compressionEnabled) {
      return compressedData;
    }

    try {
      // Convert from base64
      const binaryString = atob(compressedData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const stream = new DecompressionStream('gzip');
      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      
      // Write compressed data
      await writer.write(bytes);
      await writer.close();
      
      // Read decompressed data
      const chunks: Uint8Array[] = [];
      let done = false;
      
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          chunks.push(value);
        }
      }
      
      // Convert back to string
      const decompressed = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        decompressed.set(chunk, offset);
        offset += chunk.length;
      }
      
      return new TextDecoder().decode(decompressed);
      
    } catch (error) {
      console.warn('Decompression failed:', error);
      return compressedData;
    }
  }

  /**
   * Smart cache invalidation based on patterns
   */
  async invalidatePattern(pattern: string): Promise<void> {
    if (typeof window === 'undefined') return;
    
    try {
      const keys = Object.keys(localStorage).filter(key => 
        key.includes(pattern) && key.startsWith('cache_')
      );
      
      for (const key of keys) {
        await this.delete(key.replace('cache_', ''));
      }
      
      console.log(`🗑️ Invalidated ${keys.length} cache entries matching pattern: ${pattern}`);
      
    } catch (error) {
      console.error('Failed to invalidate cache pattern:', error);
    }
  }

  /**
   * Invalidate stale cache entries
   */
  async invalidateStale(): Promise<void> {
    if (typeof window === 'undefined') return;
    
    try {
      const now = Date.now();
      const keys = Object.keys(localStorage).filter(key => key.startsWith('cache_'));
      let invalidatedCount = 0;
      
      for (const key of keys) {
        try {
          const item = localStorage.getItem(key);
          if (item) {
            const parsed = JSON.parse(item);
            if (parsed.expiresAt && now > parsed.expiresAt) {
              await this.delete(key.replace('cache_', ''));
              invalidatedCount++;
            }
          }
        } catch (error) {
          // Remove corrupted entries
          localStorage.removeItem(key);
          invalidatedCount++;
        }
      }
      
      console.log(`🧹 Invalidated ${invalidatedCount} stale cache entries`);
      
    } catch (error) {
      console.error('Failed to invalidate stale cache:', error);
    }
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      compressions: 0,
      decompressions: 0,
      compressionRatio: 0,
      totalSize: 0,
      compressedSize: 0
    };
  }

  /**
   * Get cache hit rate
   */
  getHitRate(): number {
    const total = this.metrics.hits + this.metrics.misses;
    return total > 0 ? (this.metrics.hits / total) * 100 : 0;
  }

  /**
   * Get compression ratio
   */
  getCompressionRatio(): number {
    return this.metrics.compressionRatio;
  }
}

// Export singleton instance
export const compressedCacheManager = CompressedCacheManager.getInstance();

// Enhanced cache configurations
export const COMPRESSED_FEED_CACHE_CONFIG: CompressedCacheConfig = {
  key: 'feed_events',
  ttl: 5 * 60 * 1000, // 5 minutes
  version: '1.0',
  useIndexedDB: true,
  enableCompression: true,
  compressionLevel: 'gzip'
};

export const COMPRESSED_PROFILE_CACHE_CONFIG: CompressedCacheConfig = {
  key: 'user_profiles',
  ttl: 30 * 60 * 1000, // 30 minutes
  version: '1.0',
  useIndexedDB: false,
  enableCompression: true,
  compressionLevel: 'gzip'
};
