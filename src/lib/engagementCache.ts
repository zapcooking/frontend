import { writable, type Writable, get } from 'svelte/store';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import { decode } from '@gandlaf21/bolt11-decode';
import { browser } from '$app/environment';
import { getEngagementCounts, batchFetchFromServerAPI } from './countQuery';

// Individual zapper info
export interface Zapper {
  pubkey: string;
  amount: number; // in sats
  timestamp: number;
}

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
    topZappers: Zapper[]; // Top zappers sorted by amount (descending)
  };
  loading: boolean;
  lastFetched: number;
}

interface CachedEngagement {
  reactions: { 
    count: number; 
    groups: Array<{ emoji: string; count: number; userReacted?: boolean }>; 
    userReactions?: string[]; // Array of emojis user reacted with
  };
  comments: number;
  reposts: number;
  zaps: { 
    amount: number; 
    count: number;
    topZappers?: Zapper[]; // Top zappers
  };
  timestamp: number;
}

// Store for engagement data per event
const engagementStores = new Map<string, Writable<EngagementData>>();
const activeSubscriptions = new Map<string, NDKSubscription[]>();
const processedEventIds = new Map<string, Set<string>>();
// Track events that are being counted via subscription (to avoid NIP-45 race condition)
const subscriptionCountingInProgress = new Set<string>();
// Track optimistic zap updates to prevent double-counting when real zap arrives
const optimisticZaps = new Map<string, { amountMillisats: number; timestamp: number; userPubkey: string }>();

const CACHE_KEY_PREFIX = 'engagement_';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours - persist across page reloads

// ═══════════════════════════════════════════════════════════════
// PERSISTENT SUBSCRIPTION MANAGER
// Keep subscriptions alive for real-time engagement updates
// ═══════════════════════════════════════════════════════════════

const persistentSubscriptions = new Map<string, { sub: NDKSubscription; lastActivity: number }>();
const SUBSCRIPTION_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes - close idle subscriptions
let subscriptionCleanupInterval: ReturnType<typeof setInterval> | null = null;

// Start cleanup interval for idle subscriptions
function startSubscriptionCleanup(): void {
  if (subscriptionCleanupInterval) return;
  
  subscriptionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [eventId, { sub, lastActivity }] of persistentSubscriptions) {
      if (now - lastActivity > SUBSCRIPTION_IDLE_TIMEOUT) {
        console.debug('[Engagement] Closing idle subscription for', eventId);
        sub.stop();
        persistentSubscriptions.delete(eventId);
      }
    }
  }, 60 * 1000); // Check every minute
}

// Mark subscription as active (called when data is accessed)
export function touchEngagementSubscription(eventId: string): void {
  const entry = persistentSubscriptions.get(eventId);
  if (entry) {
    entry.lastActivity = Date.now();
  }
}

// Get subscription count for monitoring
export function getActiveSubscriptionCount(): number {
  return persistentSubscriptions.size;
}

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
    zaps: { totalAmount: 0, count: 0, userZapped: false, topZappers: [] },
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
        groups: engagement.reactions.groups.map(g => ({ 
          emoji: g.emoji, 
          count: g.count,
          userReacted: g.userReacted 
        })),
        userReactions: Array.from(engagement.reactions.userReactions) // Store as array for JSON
      },
      comments: engagement.comments.count,
      reposts: engagement.reposts.count,
      zaps: { 
        amount: engagement.zaps.totalAmount, 
        count: engagement.zaps.count,
        topZappers: engagement.zaps.topZappers // Include top zappers in cache
      },
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
    
    // Try to load from cache immediately - instant load from prior session
    const cached = loadFromCache(eventId);
    if (cached) {
      store.update(s => ({
        ...s,
        reactions: {
          ...s.reactions,
          count: cached.reactions.count,
          groups: cached.reactions.groups.map(g => ({ 
            emoji: g.emoji, 
            count: g.count, 
            userReacted: g.userReacted || false 
          })),
          userReactions: cached.reactions.userReactions 
            ? new Set(cached.reactions.userReactions) 
            : new Set(),
          userReacted: cached.reactions.userReactions ? cached.reactions.userReactions.length > 0 : false
        },
        comments: { count: cached.comments },
        reposts: { count: cached.reposts, userReposted: false },
        zaps: { 
          totalAmount: cached.zaps.amount, 
          count: cached.zaps.count, 
          userZapped: false,
          topZappers: cached.zaps.topZappers || []
        },
        loading: false, // Show cached data immediately - no loading state
        lastFetched: cached.timestamp
      }));
    }
  }
  
  return engagementStores.get(eventId)!;
}

// Fetch engagement data from network
// Uses NIP-45 COUNT queries first for speed, then falls back to full event fetch
export async function fetchEngagement(
  ndk: NDK,
  eventId: string,
  userPublickey: string
): Promise<void> {
  if (!eventId || !ndk) return;
  
  const store = getEngagementStore(eventId);
  const currentData = get(store);
  
  // If we have very fresh data (< 30 seconds) and we already got EOSE, skip refetch
  // This prevents redundant fetches while still allowing updates from subscriptions
  const isVeryFresh = currentData.lastFetched && Date.now() - currentData.lastFetched < 30 * 1000;
  const hasCompletedLoad = !currentData.loading && currentData.lastFetched > 0;
  if (isVeryFresh && hasCompletedLoad) {
    // Data is fresh and already loaded - subscription will handle updates
    return;
  }
  
  // Set loading state if not already set
  if (!currentData.loading) {
    store.update(s => ({ ...s, loading: true }));
  }
  
  // FAST PATH: Try server API first (has batching), then NIP-45 COUNT as fallback
  // Server API is much faster for multiple events
  getEngagementCounts(eventId, { timeout: 2000, skipApi: false }).then(counts => {
    // Skip if subscription is actively counting (avoid race condition)
    if (subscriptionCountingInProgress.has(eventId)) {
      console.debug('[Engagement] Skipping NIP-45 counts - subscription counting in progress for', eventId);
      return;
    }
    
    if (counts) {
      store.update(s => {
        // Always update counts if we got them from NIP-45 (they're authoritative)
        const updated = { ...s };
        let hasAnyCounts = false;
        
        if (counts.reactions !== null) {
          updated.reactions.count = counts.reactions;
          hasAnyCounts = true;
        }
        if (counts.comments !== null) {
          updated.comments.count = counts.comments;
          hasAnyCounts = true;
        }
        if (counts.reposts !== null) {
          updated.reposts.count = counts.reposts;
          hasAnyCounts = true;
        }
        if (counts.zaps !== null) {
          updated.zaps.count = counts.zaps;
          hasAnyCounts = true;
        }
        
        // Mark as loaded if we got counts (even if 0 - that's valid data)
        if (hasAnyCounts) {
          updated.loading = false;
          updated.lastFetched = Date.now();
          // Save to cache immediately with fresh counts
          saveToCache(eventId, updated);
        }
        return updated;
      });
    }
  }).catch((err) => {
    // NIP-45 failed - log for debugging but continue with subscription
    console.debug('[Engagement] NIP-45 COUNT failed for', eventId, err);
  });

  // FULL PATH: Start persistent subscription for real-time engagement updates
  // Check if we already have a persistent subscription
  const existingPersistent = persistentSubscriptions.get(eventId);
  const latestData = get(store);
  const hasAmountData = latestData.zaps.totalAmount > 0 || latestData.zaps.topZappers.length > 0;
  
  if (existingPersistent && hasAmountData) {
    // Only reuse if we already have amount data
    existingPersistent.lastActivity = Date.now();
    store.update(s => ({ ...s, loading: false }));
    return;
  }
  
  // If we have a subscription but no amount data, close it and create a fresh one
  if (existingPersistent && !hasAmountData) {
    console.debug('[Engagement] Subscription exists but no amount data, refreshing for', eventId);
    existingPersistent.sub.stop();
    persistentSubscriptions.delete(eventId);
    processedEventIds.delete(eventId); // Allow re-processing events
  }
  
  // Initialize processed event tracking - MUST be fresh to avoid double counting
  // Clear any stale processed IDs and start fresh
  processedEventIds.set(eventId, new Set());
  const processed = processedEventIds.get(eventId)!;
  
  // Stop any old-style subscriptions
  const existingSubs = activeSubscriptions.get(eventId);
  if (existingSubs) {
    existingSubs.forEach(sub => sub.stop());
    activeSubscriptions.delete(eventId);
  }
  
  // IMPORTANT: Reset counts to 0 before subscription to prevent double counting
  // The cache shows instant data, but subscription will provide accurate final counts
  store.update(s => ({
    ...s,
    reactions: { count: 0, userReacted: false, groups: [], userReactions: new Set() },
    comments: { count: 0 },
    reposts: { count: 0, userReposted: false },
    zaps: { ...s.zaps, count: 0, totalAmount: 0, topZappers: [] }, // Keep userZapped state
    loading: true
  }));
  
  // Mark that subscription counting is in progress (prevents NIP-45 race condition)
  subscriptionCountingInProgress.add(eventId);
  
  // Create persistent subscription for all engagement types
  const filter = {
    kinds: [7, 6, 9735, 1],
    '#e': [eventId]
  };
  
  let eoseReceived = false;
  
  try {
    // Start subscription cleanup manager
    startSubscriptionCleanup();
    
    // Create persistent subscription (stays open for real-time updates)
    const sub = ndk.subscribe(filter, { closeOnEose: false });
    
    // Register in persistent subscriptions map
    persistentSubscriptions.set(eventId, { sub, lastActivity: Date.now() });
    
    sub.on('event', (event: NDKEvent) => {
      if (!event.id || processed.has(event.id)) return;
      processed.add(event.id);
      
      // Mark subscription as active on new events
      touchEngagementSubscription(eventId);
      
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
            processZap(updated, event, userPublickey, eventId);
            break;
          case 1: // Comment
            // Only count as comment if it's replying to this event
            if (event.tags.some(t => t[0] === 'e' && t[1] === eventId)) {
              updated.comments.count++;
            }
            break;
        }
        
        // Save to cache on each update for persistence
        saveToCache(eventId, updated);
        
        return updated;
      });
    });
    
    sub.on('eose', () => {
      if (!eoseReceived) {
        eoseReceived = true;
        // Clear counting flag - subscription initial count is complete
        subscriptionCountingInProgress.delete(eventId);
        
        store.update(s => {
          const updated = { ...s, loading: false, lastFetched: Date.now() };
          
          // Recalculate reaction count from groups to ensure accuracy
          const sumOfGroups = updated.reactions.groups.reduce((sum, g) => sum + g.count, 0);
          if (sumOfGroups > 0 && sumOfGroups !== updated.reactions.count) {
            updated.reactions.count = sumOfGroups;
          }
          
          // Save to cache after initial fetch
          saveToCache(eventId, updated);
          return updated;
        });
        
        console.debug('[Engagement] EOSE received, subscription stays open for', eventId);
      }
    });
    
    // Timeout fallback - mark as loaded after timeout even if EOSE didn't arrive
    setTimeout(() => {
      if (!eoseReceived) {
        eoseReceived = true;
        // Clear counting flag on timeout too
        subscriptionCountingInProgress.delete(eventId);
        
        store.update(s => {
          const updated = { ...s, loading: false, lastFetched: Date.now() };
          
          // Recalculate reaction count from groups to ensure accuracy
          const sumOfGroups = updated.reactions.groups.reduce((sum, g) => sum + g.count, 0);
          if (sumOfGroups > 0 && sumOfGroups !== updated.reactions.count) {
            updated.reactions.count = sumOfGroups;
          }
          
          saveToCache(eventId, updated);
          return updated;
        });
      }
    }, 5000);
    
    // Also keep in activeSubscriptions for backward compatibility
    activeSubscriptions.set(eventId, [sub]);
    
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

function processZap(data: EngagementData, event: NDKEvent, userPublickey: string, eventId?: string): void {
  const bolt11 = event.tags.find(t => t[0] === 'bolt11')?.[1];
  if (!bolt11) return;
  
  try {
    const decoded = decode(bolt11);
    const amountSection = decoded.sections.find(s => s.name === 'amount');
    
    if (amountSection?.value) {
      const amountMillisats = Number(amountSection.value);
      if (!isNaN(amountMillisats) && amountMillisats > 0) {
        const amountSats = Math.floor(amountMillisats / 1000); // Convert millisats to sats
        
        // Extract zapper info from the zap request in the description tag
        let zapperPubkey = event.pubkey; // fallback to zapper service pubkey
        try {
          const descTag = event.tags.find(t => t[0] === 'description')?.[1];
          if (descTag) {
            const zapRequest = JSON.parse(descTag);
            if (zapRequest.pubkey) {
              zapperPubkey = zapRequest.pubkey; // The actual sender
            }
          }
        } catch {
          // Failed to parse description, use event pubkey
        }
        
        // Check if this matches an optimistic zap we already added
        // Look for optimistic zap with matching user, similar amount, and recent timestamp
        let matchedOptimistic = false;
        let matchedOptimisticAmount = 0;
        if (eventId && zapperPubkey === userPublickey) {
          const now = Date.now();
          const fiveMinutesAgo = now - 5 * 60 * 1000; // 5 minute window
          
          for (const [key, optimistic] of optimisticZaps.entries()) {
            // Match if same event, same user, amount within 10% (to account for rounding), and recent
            const amountDiff = Math.abs(optimistic.amountMillisats - amountMillisats);
            const amountMatch = amountDiff < optimistic.amountMillisats * 0.1 || amountDiff < 1000; // Within 10% or 1 sat
            const timeMatch = optimistic.timestamp > fiveMinutesAgo;
            
            if (key.startsWith(`${eventId}:${zapperPubkey}:`) && amountMatch && timeMatch) {
              // This matches our optimistic zap - don't double count
              matchedOptimistic = true;
              matchedOptimisticAmount = optimistic.amountMillisats;
              optimisticZaps.delete(key); // Remove from tracking
              break;
            }
          }
        }
        
        // Only add to count if this isn't matching an optimistic zap we already added
        if (!matchedOptimistic) {
          data.zaps.totalAmount += amountMillisats;
          data.zaps.count++;
        } else {
          // This matches our optimistic zap - replace optimistic amount with real amount for accuracy
          // Adjust totalAmount: subtract optimistic amount, add real amount
          data.zaps.totalAmount = data.zaps.totalAmount - matchedOptimisticAmount + amountMillisats;
          // Don't increment count since we already did optimistically
        }
        
        // Check if current user zapped
        if (zapperPubkey === userPublickey) {
          data.zaps.userZapped = true;
        }
        
        // Add or update zapper in the list
        // Use event timestamp, falling back to current time if missing
        const zapTimestamp = event.created_at && event.created_at > 1000000000 
          ? event.created_at 
          : Math.floor(Date.now() / 1000);
        
        const existingZapper = data.zaps.topZappers.find(z => z.pubkey === zapperPubkey);
        if (existingZapper) {
          // If we matched optimistic, the amount was already added optimistically, so just update timestamp
          // Otherwise, add the amount
          if (!matchedOptimistic) {
            existingZapper.amount += amountSats;
          }
          existingZapper.timestamp = Math.max(existingZapper.timestamp, zapTimestamp);
        } else {
          data.zaps.topZappers.push({
            pubkey: zapperPubkey,
            amount: amountSats,
            timestamp: zapTimestamp
          });
        }
        
        // Sort by amount descending, keep top 10 for efficiency
        data.zaps.topZappers.sort((a, b) => b.amount - a.amount);
        if (data.zaps.topZappers.length > 10) {
          data.zaps.topZappers = data.zaps.topZappers.slice(0, 10);
        }
      }
    }
  } catch {
    // Invalid bolt11 - skip
  }
}

// Cleanup function for when a note is removed from view
export function cleanupEngagement(eventId: string): void {
  // Clean up persistent subscription
  const persistent = persistentSubscriptions.get(eventId);
  if (persistent) {
    persistent.sub.stop();
    persistentSubscriptions.delete(eventId);
  }
  
  // Clean up legacy subscriptions
  const subs = activeSubscriptions.get(eventId);
  if (subs) {
    subs.forEach(sub => sub.stop());
    activeSubscriptions.delete(eventId);
  }
  
  // Clear processed events tracking
  processedEventIds.delete(eventId);
  
  // Clear counting in progress flag
  subscriptionCountingInProgress.delete(eventId);
  
  // Clean up optimistic zaps for this event
  for (const [key] of optimisticZaps.entries()) {
    if (key.startsWith(`${eventId}:`)) {
      optimisticZaps.delete(key);
    }
  }
}

// Optimistically update zap count when zap is initiated
// This provides immediate feedback while the zap is processing
// The subscription will correct the count when the real zap receipt arrives
export function optimisticZapUpdate(eventId: string, amountMillisats: number, userPublickey: string): void {
  const store = getEngagementStore(eventId);
  const amountSats = Math.floor(amountMillisats / 1000);
  const now = Date.now();
  
  // Track this optimistic zap (keyed by eventId + userPubkey + timestamp for uniqueness)
  const optimisticKey = `${eventId}:${userPublickey}:${now}`;
  optimisticZaps.set(optimisticKey, {
    amountMillisats,
    timestamp: now,
    userPubkey: userPublickey
  });
  
  // Clean up old optimistic zaps (older than 5 minutes)
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  for (const [key, zap] of optimisticZaps.entries()) {
    if (zap.timestamp < fiveMinutesAgo) {
      optimisticZaps.delete(key);
    }
  }
  
  store.update(s => {
    const updated = { ...s };
    
    // Optimistically add the zap amount and count
    updated.zaps.totalAmount += amountMillisats;
    updated.zaps.count += 1;
    updated.zaps.userZapped = true;
    
    // Add or update zapper in the list optimistically
    const existingZapper = updated.zaps.topZappers.find(z => z.pubkey === userPublickey);
    if (existingZapper) {
      existingZapper.amount += amountSats;
      existingZapper.timestamp = Math.floor(Date.now() / 1000);
    } else {
      updated.zaps.topZappers.push({
        pubkey: userPublickey,
        amount: amountSats,
        timestamp: Math.floor(Date.now() / 1000)
      });
    }
    
    // Sort by amount descending, keep top 10
    updated.zaps.topZappers.sort((a, b) => b.amount - a.amount);
    if (updated.zaps.topZappers.length > 10) {
      updated.zaps.topZappers = updated.zaps.topZappers.slice(0, 10);
    }
    
    // Save to cache with optimistic update
    saveToCache(eventId, updated);
    
    return updated;
  });
}

// Force refresh engagement data for an event (bypasses cache)
export async function refreshEngagement(
  ndk: NDK,
  eventId: string,
  userPublickey: string
): Promise<void> {
  // Clear processed events to allow re-processing
  processedEventIds.delete(eventId);
  
  // Reset store to loading state but keep existing data
  const store = getEngagementStore(eventId);
  store.update(s => ({ ...s, loading: true }));
  
  // Close existing subscription to force reconnect
  cleanupEngagement(eventId);
  
  // Fetch fresh data
  await fetchEngagement(ndk, eventId, userPublickey);
}

// Get engagement stats for monitoring
export function getEngagementStats(): {
  storeCount: number;
  subscriptionCount: number;
  persistentSubscriptionCount: number;
  processedEventsCount: number;
} {
  return {
    storeCount: engagementStores.size,
    subscriptionCount: activeSubscriptions.size,
    persistentSubscriptionCount: persistentSubscriptions.size,
    processedEventsCount: processedEventIds.size
  };
}

// Batch fetch for multiple events (more efficient)
// Uses server API batch endpoint first, then falls back to NDK subscriptions
export async function batchFetchEngagement(
  ndk: NDK,
  eventIds: string[],
  userPublickey: string
): Promise<void> {
  if (!eventIds.length || !ndk) return;
  
  // Filter to only fetch events we don't have fresh data for
  // Use shorter TTL (5 min) for batch refresh to ensure counts are current
  const REFRESH_TTL = 5 * 60 * 1000; // 5 minutes - refresh if older than this
  const toFetch = eventIds.filter(id => {
    const store = getEngagementStore(id);
    const data = get(store);
    // Refresh if no data, or if data is stale (> 5 min), or if loading failed
    return !data.lastFetched || 
           Date.now() - data.lastFetched > REFRESH_TTL || 
           (data.loading && Date.now() - data.lastFetched > 60000); // Stuck loading > 1 min
  });
  
  if (!toFetch.length) return;

  // FAST PATH: Try server batch API first
  try {
    const apiCounts = await batchFetchFromServerAPI(toFetch);
    
    if (apiCounts.size > 0) {
      for (const [eventId, counts] of apiCounts) {
        const store = getEngagementStore(eventId);
        store.update(s => {
          const updated = { ...s };
          if (counts.reactions !== null) updated.reactions.count = counts.reactions;
          if (counts.comments !== null) updated.comments.count = counts.comments;
          if (counts.reposts !== null) updated.reposts.count = counts.reposts;
          if (counts.zaps !== null) updated.zaps.count = counts.zaps;
          updated.loading = false;
          updated.lastFetched = Date.now();
          saveToCache(eventId, updated);
          return updated;
        });
      }
      
      // If API returned all counts, we're done for the fast path
      // Still run NDK subscription for user-specific data (userReacted, etc.)
    }
  } catch {
    // API failed, continue with NDK subscription
  }
  
  // FULL PATH: NDK subscription for accurate counts + user state
  // Reset processed IDs and counts to prevent double counting
  toFetch.forEach(id => {
    // Clear processed IDs to start fresh
    processedEventIds.set(id, new Set());
    
    // Mark that subscription counting is in progress
    subscriptionCountingInProgress.add(id);
    
    // Reset counts to 0 before fetching to prevent accumulation
    const store = getEngagementStore(id);
    store.update(s => ({
      ...s,
      reactions: { count: 0, userReacted: false, groups: [], userReactions: new Set() },
      comments: { count: 0 },
      reposts: { count: 0, userReposted: false },
      zaps: { ...s.zaps, count: 0, totalAmount: 0, topZappers: [] },
      loading: true
    }));
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
            processZap(updated, event, userPublickey, targetEventId);
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
        
        // Mark all stores as loaded and clear counting flags
        toFetch.forEach(id => {
          subscriptionCountingInProgress.delete(id);
          const store = getEngagementStore(id);
          store.update(s => {
            const updated = { ...s, loading: false, lastFetched: Date.now() };
            
            // Recalculate reaction count from groups to ensure accuracy
            const sumOfGroups = updated.reactions.groups.reduce((sum, g) => sum + g.count, 0);
            if (sumOfGroups > 0 && sumOfGroups !== updated.reactions.count) {
              updated.reactions.count = sumOfGroups;
            }
            
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
          subscriptionCountingInProgress.delete(id);
          const store = getEngagementStore(id);
          store.update(s => {
            const updated = { ...s, loading: false, lastFetched: Date.now() };
            
            // Recalculate reaction count from groups to ensure accuracy
            const sumOfGroups = updated.reactions.groups.reduce((sum, g) => sum + g.count, 0);
            if (sumOfGroups > 0 && sumOfGroups !== updated.reactions.count) {
              updated.reactions.count = sumOfGroups;
            }
            
            return updated;
          });
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
  // Stop persistent subscriptions
  persistentSubscriptions.forEach(({ sub }) => sub.stop());
  persistentSubscriptions.clear();
  
  // Stop cleanup interval
  if (subscriptionCleanupInterval) {
    clearInterval(subscriptionCleanupInterval);
    subscriptionCleanupInterval = null;
  }
  
  // Stop legacy subscriptions
  activeSubscriptions.forEach(subs => subs.forEach(sub => sub.stop()));
  activeSubscriptions.clear();
  
  // Clear stores
  engagementStores.clear();
  processedEventIds.clear();
  subscriptionCountingInProgress.clear();
  optimisticZaps.clear();
  
  // Clear localStorage cache
  if (browser) {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_KEY_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  }
  
  console.log('[Engagement] All caches cleared');
}

