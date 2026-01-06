import { writable, type Writable, get } from 'svelte/store';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import { decode } from '@gandlaf21/bolt11-decode';
import { browser } from '$app/environment';

// Types for engagement data
export interface EngagementData {
  reactions: {
    count: number;
    userReacted: boolean;
    groups: Array<{ emoji: string; count: number; userReacted: boolean }>;
    userReactions: Set<string>;
  };
  comments: {
    count: number;
  };
  reposts: {
    count: number;
    userReposted: boolean;
  };
  zaps: {
    totalAmount: number;
    count: number;
    userZapped: boolean;
  };
  loading: boolean;
  lastFetched: number;
}

interface CachedEngagement {
  reactions: { count: number; groups: Array<{ emoji: string; count: number }> };
  comments: number;
  reposts: number;
  zaps: { amount: number; count: number };
  timestamp: number;
}

// Store for engagement data per event
const engagementStores = new Map<string, Writable<EngagementData>>();
const activeSubscriptions = new Map<string, NDKSubscription[]>();
const processedEventIds = new Map<string, Set<string>>();

const CACHE_KEY_PREFIX = 'engagement_';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getDefaultEngagement(): EngagementData {
  return {
    reactions: {
      count: 0,
      userReacted: false,
      groups: [],
      userReactions: new Set()
    },
    comments: { count: 0 },
    reposts: { count: 0, userReposted: false },
    zaps: { totalAmount: 0, count: 0, userZapped: false },
    loading: true,
    lastFetched: 0
  };
}

// Load from localStorage cache
function loadFromCache(eventId: string): CachedEngagement | null {
  if (!browser) return null;
  
  try {
    const cached = localStorage.getItem(CACHE_KEY_PREFIX + eventId);
    if (!cached) return null;
    
    const data = JSON.parse(cached) as CachedEngagement;
    
    // Check if cache is still valid
    if (Date.now() - data.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY_PREFIX + eventId);
      return null;
    }
    
    return data;
  } catch {
    return null;
  }
}

// Save to localStorage cache
function saveToCache(eventId: string, engagement: EngagementData): void {
  if (!browser) return;
  
  try {
    const data: CachedEngagement = {
      reactions: {
        count: engagement.reactions.count,
        groups: engagement.reactions.groups.map(g => ({ emoji: g.emoji, count: g.count }))
      },
      comments: engagement.comments.count,
      reposts: engagement.reposts.count,
      zaps: { amount: engagement.zaps.totalAmount, count: engagement.zaps.count },
      timestamp: Date.now()
    };
    
    localStorage.setItem(CACHE_KEY_PREFIX + eventId, JSON.stringify(data));
  } catch {
    // Storage quota exceeded or other error - silently fail
  }
}

// Get or create engagement store for an event
export function getEngagementStore(eventId: string): Writable<EngagementData> {
  if (!engagementStores.has(eventId)) {
    const store = writable<EngagementData>(getDefaultEngagement());
    engagementStores.set(eventId, store);
    
    // Try to load from cache immediately
    const cached = loadFromCache(eventId);
    if (cached) {
      store.update(s => ({
        ...s,
        reactions: {
          ...s.reactions,
          count: cached.reactions.count,
          groups: cached.reactions.groups.map(g => ({ ...g, userReacted: false }))
        },
        comments: { count: cached.comments },
        reposts: { count: cached.reposts, userReposted: false },
        zaps: { totalAmount: cached.zaps.amount, count: cached.zaps.count, userZapped: false },
        loading: false, // Show cached data immediately
        lastFetched: cached.timestamp
      }));
    }
  }
  
  return engagementStores.get(eventId)!;
}

// Fetch engagement data from network
export async function fetchEngagement(
  ndk: NDK,
  eventId: string,
  userPublickey: string
): Promise<void> {
  if (!eventId || !ndk) return;
  
  const store = getEngagementStore(eventId);
  const currentData = get(store);
  
  // If we have fresh data, don't refetch
  if (currentData.lastFetched && Date.now() - currentData.lastFetched < CACHE_TTL) {
    store.update(s => ({ ...s, loading: false }));
    return;
  }
  
  // Initialize processed event tracking
  if (!processedEventIds.has(eventId)) {
    processedEventIds.set(eventId, new Set());
  }
  const processed = processedEventIds.get(eventId)!;
  
  // Stop existing subscriptions
  const existingSubs = activeSubscriptions.get(eventId);
  if (existingSubs) {
    existingSubs.forEach(sub => sub.stop());
  }
  
  const subscriptions: NDKSubscription[] = [];
  
  // Create a single subscription for all engagement types
  const filter = {
    kinds: [7, 6, 9735, 1],
    '#e': [eventId]
  };
  
  let eoseReceived = false;
  
  try {
    const sub = ndk.subscribe(filter, { closeOnEose: false });
    subscriptions.push(sub);
    
    sub.on('event', (event: NDKEvent) => {
      if (!event.id || processed.has(event.id)) return;
      processed.add(event.id);
      
      store.update(s => {
        const updated = { ...s };
        
        switch (event.kind) {
          case 7: // Reaction
            processReaction(updated, event, userPublickey);
            break;
          case 6: // Repost
            processRepost(updated, event, userPublickey);
            break;
          case 9735: // Zap
            processZap(updated, event, userPublickey);
            break;
          case 1: // Comment
            // Only count as comment if it's replying to this event
            if (event.tags.some(t => t[0] === 'e' && t[1] === eventId)) {
              updated.comments.count++;
            }
            break;
        }
        
        return updated;
      });
    });
    
    sub.on('eose', () => {
      if (!eoseReceived) {
        eoseReceived = true;
        store.update(s => {
          const updated = { ...s, loading: false, lastFetched: Date.now() };
          // Save to cache after initial fetch
          saveToCache(eventId, updated);
          return updated;
        });
      }
    });
    
    // Timeout fallback
    setTimeout(() => {
      if (!eoseReceived) {
        eoseReceived = true;
        store.update(s => ({ ...s, loading: false, lastFetched: Date.now() }));
      }
    }, 8000);
    
    activeSubscriptions.set(eventId, subscriptions);
    
  } catch (error) {
    console.error('Error fetching engagement:', error);
    store.update(s => ({ ...s, loading: false }));
  }
}

function processReaction(data: EngagementData, event: NDKEvent, userPublickey: string): void {
  const content = event.content.trim() || '+';
  
  // Normalize reaction content
  let emoji: string;
  if (content === '+' || content === '') {
    emoji = '❤️';
  } else if (content === '-') {
    emoji = '👎';
  } else if (content.startsWith(':') && content.endsWith(':')) {
    // Skip custom emoji shortcodes we can't render
    return;
  } else {
    emoji = content;
  }
  
  data.reactions.count++;
  
  // Track user reactions
  if (event.pubkey === userPublickey) {
    data.reactions.userReacted = true;
    data.reactions.userReactions.add(emoji);
  }
  
  // Update or add to groups
  const existingGroup = data.reactions.groups.find(g => g.emoji === emoji);
  if (existingGroup) {
    existingGroup.count++;
    if (event.pubkey === userPublickey) {
      existingGroup.userReacted = true;
    }
  } else {
    data.reactions.groups.push({
      emoji,
      count: 1,
      userReacted: event.pubkey === userPublickey
    });
  }
  
  // Sort groups by count
  data.reactions.groups.sort((a, b) => b.count - a.count);
}

function processRepost(data: EngagementData, event: NDKEvent, userPublickey: string): void {
  data.reposts.count++;
  if (event.pubkey === userPublickey) {
    data.reposts.userReposted = true;
  }
}

function processZap(data: EngagementData, event: NDKEvent, userPublickey: string): void {
  const bolt11 = event.tags.find(t => t[0] === 'bolt11')?.[1];
  if (!bolt11) return;
  
  try {
    const decoded = decode(bolt11);
    const amountSection = decoded.sections.find(s => s.name === 'amount');
    
    if (amountSection?.value) {
      const amount = Number(amountSection.value);
      if (!isNaN(amount) && amount > 0) {
        data.zaps.totalAmount += amount;
        data.zaps.count++;
        
        // Check if current user zapped (via P tag)
        if (event.tags.some(t => t[0] === 'P' && t[1] === userPublickey)) {
          data.zaps.userZapped = true;
        }
      }
    }
  } catch {
    // Invalid bolt11 - skip
  }
}

// Cleanup function for when a note is removed from view
export function cleanupEngagement(eventId: string): void {
  const subs = activeSubscriptions.get(eventId);
  if (subs) {
    subs.forEach(sub => sub.stop());
    activeSubscriptions.delete(eventId);
  }
}

// Batch fetch for multiple events (more efficient)
export async function batchFetchEngagement(
  ndk: NDK,
  eventIds: string[],
  userPublickey: string
): Promise<void> {
  if (!eventIds.length || !ndk) return;
  
  // Filter to only fetch events we don't have fresh data for
  const toFetch = eventIds.filter(id => {
    const store = getEngagementStore(id);
    const data = get(store);
    return !data.lastFetched || Date.now() - data.lastFetched > CACHE_TTL;
  });
  
  if (!toFetch.length) return;
  
  // Initialize all stores
  toFetch.forEach(id => {
    if (!processedEventIds.has(id)) {
      processedEventIds.set(id, new Set());
    }
  });
  
  const filter = {
    kinds: [7, 6, 9735, 1],
    '#e': toFetch
  };
  
  let eoseReceived = false;
  
  try {
    const sub = ndk.subscribe(filter, { closeOnEose: true });
    
    sub.on('event', (event: NDKEvent) => {
      // Find which target event this is for
      const targetEventId = event.tags.find(t => t[0] === 'e' && toFetch.includes(t[1]))?.[1];
      if (!targetEventId) return;
      
      const processed = processedEventIds.get(targetEventId);
      if (!processed || !event.id || processed.has(event.id)) return;
      processed.add(event.id);
      
      const store = getEngagementStore(targetEventId);
      
      store.update(s => {
        const updated = { ...s };
        
        switch (event.kind) {
          case 7:
            processReaction(updated, event, userPublickey);
            break;
          case 6:
            processRepost(updated, event, userPublickey);
            break;
          case 9735:
            processZap(updated, event, userPublickey);
            break;
          case 1:
            if (event.tags.some(t => t[0] === 'e' && t[1] === targetEventId)) {
              updated.comments.count++;
            }
            break;
        }
        
        return updated;
      });
    });
    
    sub.on('eose', () => {
      if (!eoseReceived) {
        eoseReceived = true;
        
        // Mark all stores as loaded
        toFetch.forEach(id => {
          const store = getEngagementStore(id);
          store.update(s => {
            const updated = { ...s, loading: false, lastFetched: Date.now() };
            saveToCache(id, updated);
            return updated;
          });
        });
      }
    });
    
    // Timeout fallback
    setTimeout(() => {
      if (!eoseReceived) {
        eoseReceived = true;
        toFetch.forEach(id => {
          const store = getEngagementStore(id);
          store.update(s => ({ ...s, loading: false, lastFetched: Date.now() }));
        });
      }
    }, 10000);
    
  } catch (error) {
    console.error('Error batch fetching engagement:', error);
    toFetch.forEach(id => {
      const store = getEngagementStore(id);
      store.update(s => ({ ...s, loading: false }));
    });
  }
}

// Clear all caches (for logout, etc)
export function clearAllEngagementCaches(): void {
  // Stop all subscriptions
  activeSubscriptions.forEach(subs => subs.forEach(sub => sub.stop()));
  activeSubscriptions.clear();
  
  // Clear stores
  engagementStores.clear();
  processedEventIds.clear();
  
  // Clear localStorage cache
  if (browser) {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_KEY_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  }
}

