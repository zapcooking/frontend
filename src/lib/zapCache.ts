import { NDKEvent } from '@nostr-dev-kit/ndk';
import { decode } from '@gandlaf21/bolt11-decode';

export interface ZapData {
  totalAmount: number;
  count: number;
  userHasZapped: boolean;
  lastUpdated: number;
}

export interface ZapCacheEntry {
  eventId: string;
  data: ZapData;
  processedEvents: Set<string>;
  subscription: any;
}

export class ZapCache {
  private cache = new Map<string, ZapCacheEntry>();
  private globalSubscription: any = null;
  private ndk: any = null;
  private userPublickey: string = '';

  constructor(ndk: any, userPublickey: string) {
    this.ndk = ndk;
    this.userPublickey = userPublickey;
  }

  /**
   * Get or create zap data for an event
   */
  async getZapData(eventId: string): Promise<ZapData> {
    if (!eventId) {
      return { totalAmount: 0, count: 0, userHasZapped: false, lastUpdated: 0 };
    }

    let entry = this.cache.get(eventId);
    
    if (!entry) {
      // Create new cache entry
      entry = {
        eventId,
        data: { totalAmount: 0, count: 0, userHasZapped: false, lastUpdated: Date.now() },
        processedEvents: new Set(),
        subscription: null
      };
      
      this.cache.set(eventId, entry);
      
      // Load existing zaps
      await this.loadExistingZaps(entry);
      
      // Subscribe to new zaps
      this.subscribeToNewZaps(entry);
    }

    return entry.data;
  }

  /**
   * Load existing zap events for an event
   */
  private async loadExistingZaps(entry: ZapCacheEntry) {
    try {
      const subscription = this.ndk.subscribe({
        kinds: [9735],
        '#e': [entry.eventId]
      }, { closeOnEose: false });

      let zapCount = 0;
      let resolved = false;
      
      subscription.on('event', (zapEvent: NDKEvent) => {
        zapCount++;
        this.processZapEvent(entry, zapEvent);
      });

      subscription.on('eose', () => {
        if (!resolved) {
          resolved = true;
          subscription.stop();
          console.log(`Found ${zapCount} existing zap events for event ${entry.eventId}`);
        }
      });
      
      // Timeout to ensure subscription closes
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          subscription.stop();
          console.log(`Timeout: Found ${zapCount} existing zap events for event ${entry.eventId}`);
        }
      }, 5000);
    } catch (error) {
      console.error('Error loading existing zaps:', error);
    }
  }

  /**
   * Subscribe to new zap events for an event
   */
  private subscribeToNewZaps(entry: ZapCacheEntry) {
    if (entry.subscription) {
      return; // Already subscribed
    }

    entry.subscription = this.ndk.subscribe({
      kinds: [9735],
      '#e': [entry.eventId]
    });

    entry.subscription.on('event', (zapEvent: NDKEvent) => {
      this.processZapEvent(entry, zapEvent);
    });
  }

  /**
   * Process a zap event and update the cache
   */
  private processZapEvent(entry: ZapCacheEntry, zapEvent: NDKEvent) {
    if (!zapEvent.sig || entry.processedEvents.has(zapEvent.sig)) {
      return;
    }

    const bolt11 = zapEvent.tags.find((tag) => tag[0] === 'bolt11')?.[1];
    if (!bolt11) {
      return;
    }

    try {
      const decoded = decode(bolt11);
      const amountSection = decoded.sections.find((section) => section.name === 'amount');
      
      if (amountSection && amountSection.value) {
        const amount = Number(amountSection.value);
        if (!isNaN(amount) && amount > 0) {
          entry.data.totalAmount += amount;
          entry.data.count += 1;
          entry.data.lastUpdated = Date.now();
          entry.processedEvents.add(zapEvent.sig);

          // Check if current user zapped
          if (zapEvent.tags.some(tag => tag[0] === 'P' && tag[1] === this.userPublickey)) {
            entry.data.userHasZapped = true;
          }

          console.log(`Processed zap: ${amount} sats, total: ${entry.data.totalAmount}`);
        }
      }
    } catch (error) {
      console.error('Error decoding bolt11:', error);
    }
  }

  /**
   * Remove an event from the cache
   */
  removeEvent(eventId: string) {
    const entry = this.cache.get(eventId);
    if (entry) {
      if (entry.subscription) {
        entry.subscription.stop();
      }
      this.cache.delete(eventId);
    }
  }

  /**
   * Clear all cached data
   */
  clear() {
    for (const [eventId, entry] of this.cache.entries()) {
      if (entry.subscription) {
        entry.subscription.stop();
      }
    }
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cachedEvents: this.cache.size,
      totalZaps: Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.data.count, 0),
      totalAmount: Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.data.totalAmount, 0)
    };
  }

  /**
   * Update user public key (for when user logs in/out)
   */
  updateUserPublickey(newPublickey: string) {
    this.userPublickey = newPublickey;
    
    // Update userHasZapped status for all cached events
    for (const entry of this.cache.values()) {
      entry.data.userHasZapped = false;
      // We'd need to re-check all zap events to determine if user has zapped
      // For now, we'll just reset to false and let the next zap event update it
    }
  }
}

// Singleton instance
let zapCache: ZapCache | null = null;

export function createZapCache(ndk: any, userPublickey: string): ZapCache {
  if (!zapCache) {
    zapCache = new ZapCache(ndk, userPublickey);
  }
  return zapCache;
}

export function getZapCache(): ZapCache | null {
  return zapCache;
}
