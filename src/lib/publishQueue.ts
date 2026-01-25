/**
 * Publish Queue Service
 * 
 * Provides resilient event publishing with:
 * - IndexedDB persistence for pending posts
 * - Automatic retry with exponential backoff
 * - Background sync when connection is restored
 * - Longer timeouts for slow relay connections
 * 
 * This solves the "not enough relays to publish" error that occurs when
 * relay connections are slow or unstable.
 */

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import { onConnect, isCurrentlyOnline } from '$lib/connectionMonitor';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

// Database configuration
const DB_NAME = 'zapcooking-publish-queue';
const DB_VERSION = 1;
const QUEUE_STORE = 'pendingPublishes';

// Retry configuration
const MAX_RETRIES = 3; // Reduced - if it fails 3 times, it's probably not going to work
const INITIAL_RETRY_DELAY = 2000; // 2 seconds
const MAX_RETRY_DELAY = 30000; // 30 seconds
const PUBLISH_TIMEOUT = 10000; // 10 seconds per relay
const STALE_ITEM_AGE = 30 * 60 * 1000; // 30 minutes - auto-cleanup stale items

/**
 * Represents a pending publish operation
 */
export interface PendingPublish {
  id: string;
  eventData: {
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
  };
  relayMode: 'all' | 'garden' | 'pantry' | 'garden-pantry';
  createdAt: number;
  retryCount: number;
  lastAttempt: number | null;
  lastError: string | null;
  status: 'pending' | 'retrying' | 'failed' | 'success';
}

/**
 * Store for tracking queue state
 */
export interface PublishQueueState {
  pending: number;
  retrying: boolean;
  lastError: string | null;
}

export const publishQueueState = writable<PublishQueueState>({
  pending: 0,
  retrying: false,
  lastError: null
});

/**
 * Publish Queue Manager
 */
class PublishQueueManager {
  private db: IDBDatabase | null = null;
  private dbReady!: Promise<void>;
  private dbReadyResolve!: () => void;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;

  constructor() {
    this.dbReady = new Promise((resolve) => {
      this.dbReadyResolve = resolve;
    });

    if (browser) {
      this.initDatabase()
        .then(() => {
          // Clean up stale items on startup
          this.cleanupStaleItems();
        })
        .catch((error) => {
          console.warn('[PublishQueue] Failed to initialize:', error);
          this.dbReadyResolve();
        });

      // Register for auto-sync when connection is restored
      onConnect(() => {
        console.log('[PublishQueue] Connection restored, processing queue');
        this.processQueue();
      });
    } else {
      this.dbReadyResolve();
    }
  }

  /**
   * Initialize IndexedDB database
   */
  private async initDatabase(): Promise<void> {
    if (!browser || typeof window === 'undefined') {
      return;
    }

    const idb = (globalThis as any).indexedDB;
    if (!idb) {
      console.warn('[PublishQueue] IndexedDB not available');
      this.dbReadyResolve();
      return;
    }

    return new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[PublishQueue] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[PublishQueue] Database initialized');
        this.dbReadyResolve();
        this.updateQueueState();
        resolve();
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  /**
   * Wait for database to be ready
   */
  async ready(): Promise<void> {
    return this.dbReady;
  }

  /**
   * Update the queue state store
   */
  private async updateQueueState(): Promise<void> {
    const pending = await this.getPendingCount();
    publishQueueState.update(s => ({ ...s, pending }));
  }

  /**
   * Get count of pending publishes
   */
  private async getPendingCount(): Promise<number> {
    await this.ready();
    if (!this.db) return 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([QUEUE_STORE], 'readonly');
      const store = transaction.objectStore(QUEUE_STORE);
      const index = store.index('status');
      
      // Count pending and retrying items
      let count = 0;
      const pendingRequest = index.count(IDBKeyRange.only('pending'));
      const retryingRequest = index.count(IDBKeyRange.only('retrying'));

      pendingRequest.onsuccess = () => {
        count += pendingRequest.result;
      };
      retryingRequest.onsuccess = () => {
        count += retryingRequest.result;
        resolve(count);
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Add an event to the publish queue
   */
  async queuePublish(
    event: NDKEvent,
    relayMode: PendingPublish['relayMode']
  ): Promise<string> {
    await this.ready();
    
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const pendingPublish: PendingPublish = {
      id,
      eventData: {
        kind: event.kind || 1,
        content: event.content,
        tags: event.tags.map(t => [...t]),
        created_at: event.created_at || Math.floor(Date.now() / 1000)
      },
      relayMode,
      createdAt: Date.now(),
      retryCount: 0,
      lastAttempt: null,
      lastError: null,
      status: 'pending'
    };

    if (!this.db) {
      // If DB not available, just return - we'll try to publish immediately
      console.warn('[PublishQueue] DB not available, skipping queue persistence');
      return id;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([QUEUE_STORE], 'readwrite');
      const store = transaction.objectStore(QUEUE_STORE);
      const request = store.add(pendingPublish);

      request.onsuccess = () => {
        this.updateQueueState();
        resolve(id);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a pending publish by ID
   */
  private async getPublish(id: string): Promise<PendingPublish | null> {
    await this.ready();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([QUEUE_STORE], 'readonly');
      const store = transaction.objectStore(QUEUE_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update a pending publish
   */
  private async updatePublish(publish: PendingPublish): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([QUEUE_STORE], 'readwrite');
      const store = transaction.objectStore(QUEUE_STORE);
      const request = store.put(publish);

      request.onsuccess = () => {
        this.updateQueueState();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove a pending publish (after success)
   */
  async removePublish(id: string): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([QUEUE_STORE], 'readwrite');
      const store = transaction.objectStore(QUEUE_STORE);
      const request = store.delete(id);

      request.onsuccess = () => {
        this.updateQueueState();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all pending publishes
   */
  async getPendingPublishes(): Promise<PendingPublish[]> {
    await this.ready();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([QUEUE_STORE], 'readonly');
      const store = transaction.objectStore(QUEUE_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const all = request.result || [];
        // Return pending and retrying items, sorted by createdAt
        const pending = all
          .filter(p => p.status === 'pending' || p.status === 'retrying')
          .sort((a, b) => a.createdAt - b.createdAt);
        resolve(pending);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Publish an event with resilient retry logic
   * 
   * This is the main entry point for publishing events.
   * It will attempt to publish immediately, and if that fails,
   * queue the event for background retry.
   * 
   * @returns true if published successfully on first attempt,
   *          'queued' if queued for retry
   */
  async publishWithRetry(
    event: NDKEvent,
    relayMode: PendingPublish['relayMode'] = 'all'
  ): Promise<{ success: boolean; queued: boolean; error?: string }> {
    // Clean up stale items first
    await this.cleanupStaleItems();

    // Try to publish immediately (DON'T queue first - only queue on failure)
    try {
      await this.attemptPublish(event, relayMode);
      
      // Success!
      return { success: true, queued: false };
    } catch (error: any) {
      console.warn('[PublishQueue] Initial publish failed:', error.message);
      
      // Only queue AFTER failure - this prevents ghost items in the queue
      // when relays actually received the post but we timed out waiting for confirmation
      const queueId = await this.queuePublish(event, relayMode);
      
      // Update the queued item with error info
      const pending = await this.getPublish(queueId);
      if (pending) {
        pending.lastAttempt = Date.now();
        pending.lastError = error.message || 'Unknown error';
        pending.status = 'retrying';
        pending.retryCount = 1;
        await this.updatePublish(pending);
      }

      publishQueueState.update(s => ({ ...s, lastError: error.message }));

      // Schedule background retry
      this.scheduleRetry();

      return { 
        success: false, 
        queued: true, 
        error: error.message || 'Failed to publish, will retry in background'
      };
    }
  }

  /**
   * Clean up stale items from the queue
   * Items older than STALE_ITEM_AGE are automatically removed
   */
  private async cleanupStaleItems(): Promise<void> {
    await this.ready();
    if (!this.db) return;

    try {
      const all = await this.getPendingPublishes();
      const now = Date.now();
      let cleanedCount = 0;

      for (const item of all) {
        // Remove items older than STALE_ITEM_AGE
        if (now - item.createdAt > STALE_ITEM_AGE) {
          console.log(`[PublishQueue] Removing stale item ${item.id} (age: ${Math.round((now - item.createdAt) / 1000 / 60)}min)`);
          await this.removePublish(item.id);
          cleanedCount++;
        }
        // Also remove items that have exceeded max retries
        else if (item.retryCount >= MAX_RETRIES) {
          console.log(`[PublishQueue] Removing failed item ${item.id} (retries: ${item.retryCount})`);
          await this.removePublish(item.id);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`[PublishQueue] Cleaned up ${cleanedCount} stale/failed items`);
      }
    } catch (error) {
      console.warn('[PublishQueue] Error cleaning up stale items:', error);
    }
  }

  /**
   * Attempt to publish an event with extended timeout
   */
  private async attemptPublish(
    event: NDKEvent,
    relayMode: PendingPublish['relayMode']
  ): Promise<void> {
    const { ndk, normalizeRelayUrl } = await import('$lib/nostr');
    const { NDKRelaySet, NDKEvent: NDKEventClass } = await import('@nostr-dev-kit/ndk');
    const ndkInstance = get(ndk);

    // Ensure signer is ready
    const { getAuthManager } = await import('$lib/authManager');
    const authManager = getAuthManager();
    if (authManager) {
      await authManager.ensureNip46SignerReady();
    }

    // Sign the event if not already signed
    if (!event.sig) {
      await event.sign();
    }

    let publishPromise: Promise<Set<any>>;

    if (relayMode === 'garden') {
      const relay = ndkInstance.pool.getRelay('wss://garden.zap.cooking', true, true);
      await relay.connect();
      await new Promise(resolve => setTimeout(resolve, 100));
      const relaySet = new NDKRelaySet(new Set([relay]), ndkInstance);
      publishPromise = event.publish(relaySet, PUBLISH_TIMEOUT);
    } else if (relayMode === 'pantry') {
      const relay = ndkInstance.pool.getRelay('wss://pantry.zap.cooking', true, true);
      await relay.connect();
      await new Promise(resolve => setTimeout(resolve, 100));
      const relaySet = new NDKRelaySet(new Set([relay]), ndkInstance);
      publishPromise = event.publish(relaySet, PUBLISH_TIMEOUT);
    } else if (relayMode === 'garden-pantry') {
      const gardenRelay = ndkInstance.pool.getRelay('wss://garden.zap.cooking', true, true);
      const pantryRelay = ndkInstance.pool.getRelay('wss://pantry.zap.cooking', true, true);
      await Promise.all([gardenRelay.connect(), pantryRelay.connect()]);
      await new Promise(resolve => setTimeout(resolve, 100));
      const relaySet = new NDKRelaySet(new Set([gardenRelay, pantryRelay]), ndkInstance);
      publishPromise = event.publish(relaySet, PUBLISH_TIMEOUT);
    } else {
      // 'all' mode - publish to all connected relays with extended timeout
      publishPromise = event.publish(undefined, PUBLISH_TIMEOUT);
    }

    // Add our own timeout wrapper
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Publishing timeout')), PUBLISH_TIMEOUT + 5000);
    });

    const publishedRelays = await Promise.race([publishPromise, timeoutPromise]);

    // Verify at least one relay received it
    if (!publishedRelays || publishedRelays.size === 0) {
      throw new Error('No relays received the event');
    }

    console.log(`[PublishQueue] Published to ${publishedRelays.size} relay(s)`);
  }

  /**
   * Schedule a retry attempt
   */
  private scheduleRetry(delayOverride?: number): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    const delay = delayOverride ?? INITIAL_RETRY_DELAY;
    
    console.log(`[PublishQueue] Scheduling retry in ${delay}ms`);
    
    this.retryTimer = setTimeout(() => {
      this.processQueue();
    }, delay);
  }

  /**
   * Process the queue - retry all pending publishes
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing) {
      console.log('[PublishQueue] Already processing, skipping');
      return;
    }

    if (!isCurrentlyOnline()) {
      console.log('[PublishQueue] Offline, skipping queue processing');
      return;
    }

    this.isProcessing = true;
    publishQueueState.update(s => ({ ...s, retrying: true }));

    try {
      const pending = await this.getPendingPublishes();
      
      if (pending.length === 0) {
        console.log('[PublishQueue] No pending publishes');
        return;
      }

      console.log(`[PublishQueue] Processing ${pending.length} pending publish(es)`);

      const { ndk } = await import('$lib/nostr');
      const { NDKEvent } = await import('@nostr-dev-kit/ndk');
      const ndkInstance = get(ndk);

      for (const item of pending) {
        // Check if max retries exceeded
        if (item.retryCount >= MAX_RETRIES) {
          console.log(`[PublishQueue] Max retries exceeded for ${item.id}, marking as failed`);
          item.status = 'failed';
          await this.updatePublish(item);
          continue;
        }

        try {
          // Reconstruct the event
          const event = new NDKEvent(ndkInstance);
          event.kind = item.eventData.kind;
          event.content = item.eventData.content;
          event.tags = item.eventData.tags;
          event.created_at = item.eventData.created_at;

          await this.attemptPublish(event, item.relayMode);

          // Success!
          console.log(`[PublishQueue] Successfully published ${item.id}`);
          await this.removePublish(item.id);
        } catch (error: any) {
          console.warn(`[PublishQueue] Retry failed for ${item.id}:`, error.message);
          
          item.retryCount++;
          item.lastAttempt = Date.now();
          item.lastError = error.message || 'Unknown error';
          await this.updatePublish(item);
        }
      }

      // Check if there are still pending items
      const remaining = await this.getPendingPublishes();
      if (remaining.length > 0) {
        // Schedule next retry with exponential backoff
        const maxRetryCount = Math.max(...remaining.map(r => r.retryCount));
        const delay = Math.min(
          INITIAL_RETRY_DELAY * Math.pow(2, maxRetryCount),
          MAX_RETRY_DELAY
        );
        this.scheduleRetry(delay);
      }
    } finally {
      this.isProcessing = false;
      publishQueueState.update(s => ({ ...s, retrying: false }));
    }
  }

  /**
   * Clear all pending publishes (use with caution)
   */
  async clearQueue(): Promise<void> {
    await this.ready();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([QUEUE_STORE], 'readwrite');
      const store = transaction.objectStore(QUEUE_STORE);
      const request = store.clear();

      request.onsuccess = () => {
        this.updateQueueState();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{ pending: number; failed: number; retrying: boolean }> {
    const all = await this.getPendingPublishes();
    const state = get(publishQueueState);
    
    return {
      pending: all.length,
      failed: all.filter(p => p.retryCount >= MAX_RETRIES).length,
      retrying: state.retrying
    };
  }
}

// Export singleton instance
export const publishQueue = new PublishQueueManager();
