/**
 * Feed Subscription Manager
 * 
 * Optimized subscription management for the feed with:
 * - Single subscription per mode (instead of multiple batched ones)
 * - EOSE tracking for accurate loading states
 * - Kind separation (notes/reposts vs replies)
 * - Subscription reuse to prevent duplicate connections
 */

import type { NDK, NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SubscriptionConfig {
  authors?: string[];
  hashtags?: string[];
  since?: number;
  until?: number;
  kinds?: number[];
  limit?: number;
  onEvent: (event: NDKEvent) => void;
  onEose?: () => void;
}

export interface SubscriptionStats {
  activeCount: number;
  totalCreated: number;
  totalStopped: number;
  eoseReceived: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Default time window (24 hours)
  DEFAULT_SINCE_SECONDS: 24 * 60 * 60,
  
  // Max authors per subscription (NDK handles batching internally)
  MAX_AUTHORS_PER_SUB: 500,
  
  // Default kinds for feed
  DEFAULT_KINDS: [1, 6], // Notes + reposts
};

// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTION MANAGER CLASS
// ═══════════════════════════════════════════════════════════════

export class FeedSubscriptionManager {
  private subscriptions = new Map<string, NDKSubscription>();
  private eoseCallbacks = new Map<string, Set<() => void>>();
  private stats: SubscriptionStats = {
    activeCount: 0,
    totalCreated: 0,
    totalStopped: 0,
    eoseReceived: 0
  };
  
  constructor(private ndk: NDK) {}
  
  /**
   * Create optimized subscription for notes and reposts
   * NDK handles batching internally for large author lists
   */
  subscribeNotes(config: SubscriptionConfig): NDKSubscription {
    const filter: NDKFilter = {
      kinds: config.kinds || CONFIG.DEFAULT_KINDS,
      since: config.since || Math.floor(Date.now() / 1000) - CONFIG.DEFAULT_SINCE_SECONDS,
    };
    
    if (config.until) {
      filter.until = config.until;
    }
    
    if (config.limit) {
      filter.limit = config.limit;
    }
    
    if (config.authors && config.authors.length > 0) {
      // NDK handles batching internally, but we can optimize for very large lists
      if (config.authors.length <= CONFIG.MAX_AUTHORS_PER_SUB) {
        filter.authors = config.authors;
      } else {
        // For very large lists, let NDK handle it but warn
        console.debug(`[SubscriptionManager] Large author list (${config.authors.length}), NDK will batch`);
        filter.authors = config.authors;
      }
    }
    
    if (config.hashtags && config.hashtags.length > 0) {
      filter['#t'] = config.hashtags;
    }
    
    const subId = this.generateSubId(filter);
    const existing = this.subscriptions.get(subId);
    
    if (existing) {
      // Reuse existing subscription, just add callbacks
      console.debug(`[SubscriptionManager] Reusing existing subscription: ${subId}`);
      if (config.onEose) {
        const callbacks = this.eoseCallbacks.get(subId) || new Set();
        callbacks.add(config.onEose);
        this.eoseCallbacks.set(subId, callbacks);
      }
      return existing;
    }
    
    // Create new subscription with EOSE tracking
    const sub = this.ndk.subscribe(filter, { closeOnEose: true });
    
    sub.on('event', config.onEvent);
    
    if (config.onEose) {
      const callbacks = new Set<() => void>([config.onEose]);
      this.eoseCallbacks.set(subId, callbacks);
      
      sub.on('eose', () => {
        this.stats.eoseReceived++;
        const callbacks = this.eoseCallbacks.get(subId);
        if (callbacks) {
          callbacks.forEach(cb => cb());
        }
        console.debug(`[SubscriptionManager] EOSE received for: ${subId}`);
      });
    } else {
      sub.on('eose', () => {
        this.stats.eoseReceived++;
        console.debug(`[SubscriptionManager] EOSE received for: ${subId}`);
      });
    }
    
    this.subscriptions.set(subId, sub);
    this.stats.activeCount++;
    this.stats.totalCreated++;
    
    console.debug(`[SubscriptionManager] Created subscription: ${subId} (active: ${this.stats.activeCount})`);
    
    return sub;
  }
  
  /**
   * Create subscription specifically for replies (kind 1 with e tags)
   * Replies are filtered in the event handler since relays don't support tag presence filters
   */
  subscribeReplies(config: SubscriptionConfig): NDKSubscription {
    const replyConfig: SubscriptionConfig = {
      ...config,
      kinds: [1], // Replies are kind 1 with e tags
      onEvent: (event: NDKEvent) => {
        // Only process if it's a reply (has e tags)
        const eTags = event.tags.filter(t => t[0] === 'e');
        if (eTags.length > 0) {
          config.onEvent(event);
        }
      }
    };
    
    return this.subscribeNotes(replyConfig);
  }
  
  /**
   * Create a real-time subscription that stays open
   * Use for live updates after initial load
   */
  subscribeRealtime(config: SubscriptionConfig): NDKSubscription {
    const filter: NDKFilter = {
      kinds: config.kinds || CONFIG.DEFAULT_KINDS,
      since: config.since || Math.floor(Date.now() / 1000),
    };
    
    if (config.authors && config.authors.length > 0) {
      filter.authors = config.authors;
    }
    
    if (config.hashtags && config.hashtags.length > 0) {
      filter['#t'] = config.hashtags;
    }
    
    // Real-time subscriptions stay open (closeOnEose: false)
    const sub = this.ndk.subscribe(filter, { closeOnEose: false });
    
    sub.on('event', config.onEvent);
    
    const subId = `realtime_${this.generateSubId(filter)}`;
    this.subscriptions.set(subId, sub);
    this.stats.activeCount++;
    this.stats.totalCreated++;
    
    console.debug(`[SubscriptionManager] Created realtime subscription: ${subId}`);
    
    return sub;
  }
  
  /**
   * Stop a specific subscription by ID
   */
  stop(subId: string): void {
    const sub = this.subscriptions.get(subId);
    if (sub) {
      try {
        sub.stop();
      } catch {
        // Already stopped
      }
      this.subscriptions.delete(subId);
      this.eoseCallbacks.delete(subId);
      this.stats.activeCount--;
      this.stats.totalStopped++;
      console.debug(`[SubscriptionManager] Stopped subscription: ${subId}`);
    }
  }
  
  /**
   * Stop all active subscriptions
   */
  stopAll(): void {
    for (const [id, sub] of this.subscriptions) {
      try {
        sub.stop();
      } catch {
        // Already stopped
      }
      this.stats.totalStopped++;
    }
    
    const count = this.subscriptions.size;
    this.subscriptions.clear();
    this.eoseCallbacks.clear();
    this.stats.activeCount = 0;
    
    console.debug(`[SubscriptionManager] Stopped all subscriptions (${count} total)`);
  }
  
  /**
   * Get current subscription statistics
   */
  getStats(): SubscriptionStats {
    return { ...this.stats };
  }
  
  /**
   * Get number of active subscriptions
   */
  getActiveCount(): number {
    return this.subscriptions.size;
  }
  
  /**
   * Generate unique subscription ID from filter
   */
  private generateSubId(filter: NDKFilter): string {
    const parts = [
      `kinds:${filter.kinds?.join(',') || ''}`,
      `authors:${filter.authors?.slice(0, 3).join(',') || ''}${filter.authors && filter.authors.length > 3 ? `+${filter.authors.length - 3}` : ''}`,
      `hashtags:${filter['#t']?.slice(0, 3).join(',') || ''}`,
      `since:${filter.since || ''}`,
      `until:${filter.until || ''}`
    ];
    return parts.join('|');
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let subscriptionManager: FeedSubscriptionManager | null = null;

/**
 * Get or create the singleton subscription manager
 */
export function getSubscriptionManager(ndk: NDK): FeedSubscriptionManager {
  if (!subscriptionManager) {
    subscriptionManager = new FeedSubscriptionManager(ndk);
  }
  return subscriptionManager;
}

/**
 * Reset the subscription manager (for testing or re-initialization)
 */
export function resetSubscriptionManager(): void {
  if (subscriptionManager) {
    subscriptionManager.stopAll();
    subscriptionManager = null;
  }
}

