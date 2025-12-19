import type { NDKEvent, NDKSubscription, NDKFilter } from '@nostr-dev-kit/ndk';

export interface SubscriptionConfig {
  id: string;
  filter: NDKFilter;
  onEvent: (event: NDKEvent) => void;
  onEose?: () => void;
  closeOnEose?: boolean;
}

export class SubscriptionManager {
  private subscriptions = new Map<string, NDKSubscription>();
  private ndk: any = null;
  private subscriptionCounts = new Map<string, number>();

  constructor(ndk: any) {
    this.ndk = ndk;
  }

  /**
   * Subscribe to events with deduplication
   */
  subscribe(config: SubscriptionConfig): NDKSubscription | null {
    if (!this.ndk) {
      console.warn('NDK not available for subscription');
      return null;
    }

    const { id, filter, onEvent, onEose, closeOnEose = true } = config;

    // Guard: prevent subscribing with empty filter arrays
    // NDK's internal batching/merge layer will error "BUG: No filters to merge! Map(0)" if given empty arrays
    let filterToUse: NDKFilter | NDKFilter[] = filter;
    
    if (Array.isArray(filter)) {
      if (filter.length === 0) {
        console.warn(`⚠️ Skipping subscription ${id}: empty filter array`);
        return null;
      }
      // Filter out any invalid/empty filters from the array
      const validFilters = filter.filter(f => f && (f.kinds || f.authors || f['#e'] || f['#a'] || f['#t'] || f['#d']));
      if (validFilters.length === 0) {
        console.warn(`⚠️ Skipping subscription ${id}: no valid filters in array`);
        return null;
      }
      // If we filtered out invalid filters, use only valid ones
      if (validFilters.length !== filter.length) {
        filterToUse = validFilters;
      }
    } else {
      // Single filter object - ensure it has at least one valid field
      if (!filter || (!filter.kinds && !filter.authors && !filter['#e'] && !filter['#a'] && !filter['#t'] && !filter['#d'])) {
        console.warn(`⚠️ Skipping subscription ${id}: invalid or empty filter`);
        return null;
      }
    }

    // Check if we already have this subscription
    if (this.subscriptions.has(id)) {
      // Increment reference count
      const currentCount = this.subscriptionCounts.get(id) || 0;
      this.subscriptionCounts.set(id, currentCount + 1);
      
      console.log(`📡 Reusing existing subscription ${id} (refs: ${currentCount + 1})`);
      return this.subscriptions.get(id)!;
    }

    // Create new subscription
    console.log(`📡 Creating new subscription ${id}`);
    
    try {
      // Use filterToUse (validated and potentially filtered)
      const subscription = this.ndk.subscribe(filterToUse, { closeOnEose });
      
      subscription.on('event', (event: NDKEvent) => {
        onEvent(event);
      });

      if (onEose) {
        subscription.on('eose', onEose);
      }

      // Store subscription and set reference count to 1
      this.subscriptions.set(id, subscription);
      this.subscriptionCounts.set(id, 1);

      return subscription;
    } catch (error) {
      console.error(`Failed to create subscription ${id}:`, error);
      return null;
    }
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(id: string): void {
    const currentCount = this.subscriptionCounts.get(id) || 0;
    
    if (currentCount <= 1) {
      // Last reference, actually stop the subscription
      const subscription = this.subscriptions.get(id);
      if (subscription) {
        console.log(`📡 Stopping subscription ${id}`);
        subscription.stop();
        this.subscriptions.delete(id);
        this.subscriptionCounts.delete(id);
      }
    } else {
      // Decrement reference count
      this.subscriptionCounts.set(id, currentCount - 1);
      console.log(`📡 Decremented subscription ${id} (refs: ${currentCount - 1})`);
    }
  }

  /**
   * Get subscription statistics
   */
  getStats() {
    return {
      activeSubscriptions: this.subscriptions.size,
      totalReferences: Array.from(this.subscriptionCounts.values()).reduce((sum, count) => sum + count, 0),
      subscriptions: Array.from(this.subscriptionCounts.entries()).map(([id, count]) => ({ id, count }))
    };
  }

  /**
   * Clean up all subscriptions
   */
  cleanup(): void {
    console.log('🧹 Cleaning up all subscriptions...');
    
    for (const [id, subscription] of this.subscriptions.entries()) {
      console.log(`📡 Stopping subscription ${id}`);
      subscription.stop();
    }
    
    this.subscriptions.clear();
    this.subscriptionCounts.clear();
  }

  /**
   * Update NDK instance
   */
  updateNDK(ndk: any): void {
    this.ndk = ndk;
  }
}

// Singleton instance
let subscriptionManager: SubscriptionManager | null = null;

export function createSubscriptionManager(ndk: any): SubscriptionManager {
  if (!subscriptionManager) {
    subscriptionManager = new SubscriptionManager(ndk);
  } else {
    subscriptionManager.updateNDK(ndk);
  }
  return subscriptionManager;
}

export function getSubscriptionManager(): SubscriptionManager | null {
  return subscriptionManager;
}
