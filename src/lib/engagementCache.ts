import { writable, type Writable, get } from 'svelte/store';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import NDK, { NDKRelaySet } from '@nostr-dev-kit/ndk';
import { browser } from '$app/environment';
import { getEngagementCounts, batchFetchFromServerAPI } from './countQuery';
import { extractZapAmountSats } from './zapAmount';

// Aggregator relays that index zap receipts — LNURL providers publish kind:9735
// to these relays, which may not overlap with the app's default relay set.
const ZAP_AGGREGATOR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net'
];

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
// Track (pubkey, emoji) pairs per target event to deduplicate reactions
const processedReactionPairs = new Map<string, Set<string>>();
// Track events that are being counted via subscription (to avoid NIP-45 race condition)
const subscriptionCountingInProgress = new Set<string>();
// Track optimistic zap updates to prevent double-counting when real zap arrives
const optimisticZaps = new Map<string, { amountMillisats: number; timestamp: number; userPubkey: string }>();
// Track optimistic reaction updates to prevent double-counting when real reaction arrives
const optimisticReactions = new Map<string, { emoji: string; timestamp: number; userPubkey: string }>();

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
  
  // If we have a subscription but no amount data, close it and create a fresh one.
  // Note: we intentionally do NOT wipe processedEventIds / processedReactionPairs
  // here — those dedup Sets must persist across sub close+reopen so any
  // events the prior sub already counted aren't re-counted by the new sub
  // when the relay redelivers them (F5-B feed-comment double-count bug).
  // The Sets are only evicted by `cleanupEngagement(eventId)` when the
  // event goes off-screen.
  if (existingPersistent && !hasAmountData) {
    console.debug('[Engagement] Subscription exists but no amount data, refreshing for', eventId);
    existingPersistent.sub.stop();
    persistentSubscriptions.delete(eventId);
  }

  // Initialize processed event tracking — init-if-absent, never wipe.
  // Multiple components (NoteTotalComments, NoteTotalLikes/ReactionTrigger,
  // NoteTotalZaps, NoteRepost, ReactionPills) all call fetchEngagement for
  // the same eventId on mount. Wiping the Set on every call caused each
  // component's resulting subscription to treat already-counted events as
  // new — producing the F5-B fingerprint of one event yielding 5+ counts.
  // Sharing a single Set across all callers is the correct pattern for
  // cross-sub dedup.
  //
  // The Set lifetime is bound to the count state that was accumulated
  // against it: if we created the Set this call, counts are still at
  // zero (or cached / API-fast-path values) and the subscription should
  // count up from there. If the Set already existed from a prior call,
  // the count state it produced is already in `store` — wiping counts
  // while preserving the Set would cause the sub to dedup historical
  // events (they're in the Set) without ever re-counting them, leaving
  // counts stuck at 0.
  const isFirstInit = !processedEventIds.has(eventId);
  if (isFirstInit) {
    processedEventIds.set(eventId, new Set());
  }
  if (!processedReactionPairs.has(eventId)) {
    processedReactionPairs.set(eventId, new Set());
  }
  const processed = processedEventIds.get(eventId)!;

  // Stop any old-style subscriptions
  const existingSubs = activeSubscriptions.get(eventId);
  if (existingSubs) {
    existingSubs.forEach(sub => sub.stop());
    activeSubscriptions.delete(eventId);
  }

  // Count-reset is only safe when starting fresh. On re-entry (Set
  // already populated), leave the accumulated counts in place — the
  // subscription will dedup historical events and only increment for
  // genuinely new arrivals, which is the correct behavior.
  // Pending optimistic zap updates are re-applied on both paths so
  // they aren't wiped during re-fetch.
  let pendingOptimisticAmount = 0;
  let pendingOptimisticCount = 0;
  const pendingOptimisticZappers: Array<{ pubkey: string; amount: number; timestamp: number }> = [];
  for (const [key, zap] of optimisticZaps.entries()) {
    if (key.startsWith(`${eventId}:`)) {
      // totalAmount is stored in millisats; topZappers.amount is sats
      const zapSats = Math.floor(zap.amountMillisats / 1000);
      pendingOptimisticAmount += zap.amountMillisats;
      pendingOptimisticCount++;
      const existingZapper = pendingOptimisticZappers.find(z => z.pubkey === zap.userPubkey);
      if (existingZapper) {
        existingZapper.amount += zapSats;
      } else {
        pendingOptimisticZappers.push({
          pubkey: zap.userPubkey,
          amount: zapSats,
          timestamp: Math.floor(zap.timestamp / 1000)
        });
      }
    }
  }
  if (isFirstInit) {
    store.update(s => ({
      ...s,
      reactions: { count: 0, userReacted: false, groups: [], userReactions: new Set() },
      comments: { count: 0 },
      reposts: { count: 0, userReposted: false },
      zaps: {
        ...s.zaps,
        count: pendingOptimisticCount,
        totalAmount: pendingOptimisticAmount,
        topZappers: pendingOptimisticZappers,
        userZapped: s.zaps.userZapped || pendingOptimisticCount > 0
      },
      loading: true
    }));
  } else {
    // Re-entry: preserve counts already produced against this Set;
    // just mark loading so UI knows a refresh is in flight, and top
    // up the optimistic-zap state.
    store.update(s => ({
      ...s,
      zaps: {
        ...s.zaps,
        count: Math.max(s.zaps.count, pendingOptimisticCount),
        totalAmount: Math.max(s.zaps.totalAmount, pendingOptimisticAmount),
        topZappers: pendingOptimisticZappers.length > 0 ? pendingOptimisticZappers : s.zaps.topZappers,
        userZapped: s.zaps.userZapped || pendingOptimisticCount > 0
      },
      loading: true
    }));
  }
  
  // Mark that subscription counting is in progress (prevents NIP-45 race condition)
  subscriptionCountingInProgress.add(eventId);
  
  // Create persistent subscription for all engagement types
  const filter = {
    kinds: [7, 6, 9735, 1],
    '#e': [eventId]
  };

  let eoseReceived = false;

  // Pre-connect aggregator relays before subscribing.
  // NDKRelaySet.fromRelayUrls creates temporary relays that connect asynchronously,
  // so the subscription's initial REQ can miss them. By explicitly connecting first,
  // we ensure the REQ reaches aggregator relays on the first try.
  await Promise.all(
    ZAP_AGGREGATOR_RELAYS.map(async (url) => {
      try {
        const relay = ndk.pool.getRelay(url, true, true);
        if (relay.connectivity?.status !== 1) {
          await relay.connect();
        }
      } catch {
        // Non-fatal: subscription still works with other relays
      }
    })
  );

  // Build relay set: NDK's connected relays + zap aggregator relays
  const relaySet = NDKRelaySet.fromRelayUrls(
    [...(ndk.explicitRelayUrls || []), ...ZAP_AGGREGATOR_RELAYS],
    ndk,
    true // addConnectedRelays
  );

  try {
    // Start subscription cleanup manager
    startSubscriptionCleanup();

    // Create persistent subscription (stays open for real-time updates)
    const sub = ndk.subscribe(filter, { closeOnEose: false }, relaySet);
    
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
            processReaction(updated, event, userPublickey, eventId);
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

function processReaction(data: EngagementData, event: NDKEvent, userPublickey: string, targetEventId?: string): void {
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
  
  // Check if this matches an optimistic reaction we already added
  // This prevents double counting when the published reaction comes back through subscription
  if (targetEventId && event.pubkey === userPublickey) {
    const optimisticKey = `${targetEventId}:${userPublickey}:${emoji}`;
    if (optimisticReactions.has(optimisticKey)) {
      // This matches our optimistic reaction - don't count it again
      console.debug('[Engagement] Skipping optimistic reaction:', emoji);
      optimisticReactions.delete(optimisticKey); // Clean up
      return;
    }
  }

  // Only count one reaction per user per emoji
  if (targetEventId) {
    const pairKey = `${event.pubkey}:${emoji}`;
    let pairs = processedReactionPairs.get(targetEventId);
    if (!pairs) {
      pairs = new Set();
      processedReactionPairs.set(targetEventId, pairs);
    }
    if (pairs.has(pairKey)) return;
    pairs.add(pairKey);
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
  const { sats: amountSats } = extractZapAmountSats(event);
  if (amountSats <= 0) return;
  // Keep data.zaps.totalAmount in millisats for backward compatibility with
  // callers that divide by 1000 at display time (NoteTotalZaps, ShareNoteImageCard,
  // ThreadCommentActions, shareNoteImage, FoodstrFeedOptimized glow tier).
  const amountMillisats = amountSats * 1000;

  // Extract zapper info from the zap request in the description tag
  let zapperPubkey = event.pubkey; // fallback to zapper service pubkey
  try {
    const descTag = event.tags.find(t => t[0] === 'description')?.[1];
    if (descTag) {
      const zapRequest = JSON.parse(descTag);
      if (zapRequest.pubkey) {
        zapperPubkey = zapRequest.pubkey;
      }
    }
  } catch {
    // Failed to parse description, use event pubkey
  }

  // Check if this matches an optimistic zap we already added
  let matchedOptimistic = false;
  let matchedOptimisticMillisats = 0;
  if (eventId && zapperPubkey === userPublickey) {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    for (const [key, optimistic] of optimisticZaps.entries()) {
      const amountDiff = Math.abs(optimistic.amountMillisats - amountMillisats);
      // Within 10% or 1 sat (1000 msat) to account for rounding
      const amountMatch = amountDiff < optimistic.amountMillisats * 0.1 || amountDiff < 1000;
      const timeMatch = optimistic.timestamp > fiveMinutesAgo;

      if (key.startsWith(`${eventId}:${zapperPubkey}:`) && amountMatch && timeMatch) {
        matchedOptimistic = true;
        matchedOptimisticMillisats = optimistic.amountMillisats;
        optimisticZaps.delete(key);
        break;
      }
    }
  }

  if (!matchedOptimistic) {
    data.zaps.totalAmount += amountMillisats;
    data.zaps.count++;
  } else {
    // Replace optimistic amount with real amount for accuracy
    data.zaps.totalAmount = data.zaps.totalAmount - matchedOptimisticMillisats + amountMillisats;
  }

  if (zapperPubkey === userPublickey) {
    data.zaps.userZapped = true;
  }

  const zapTimestamp = event.created_at && event.created_at > 1000000000
    ? event.created_at
    : Math.floor(Date.now() / 1000);

  const existingZapper = data.zaps.topZappers.find(z => z.pubkey === zapperPubkey);
  if (existingZapper) {
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

  data.zaps.topZappers.sort((a, b) => b.amount - a.amount);
  if (data.zaps.topZappers.length > 10) {
    data.zaps.topZappers = data.zaps.topZappers.slice(0, 10);
  }
}

// Mark a reaction/engagement event as already processed to prevent double counting
// Call this after optimistic updates + successful publish
export function markEventAsProcessed(targetEventId: string, processedEventId: string): void {
  const processed = processedEventIds.get(targetEventId);
  if (processed) {
    processed.add(processedEventId);
  }
}

// Track an optimistic reaction BEFORE publishing to prevent double counting
// Call this before publishReaction to mark that we're expecting this reaction
export function trackOptimisticReaction(targetEventId: string, emoji: string, userPubkey: string): void {
  const now = Date.now();
  const key = `${targetEventId}:${userPubkey}:${emoji}`;
  
  optimisticReactions.set(key, {
    emoji,
    timestamp: now,
    userPubkey
  });
  
  // Clean up old optimistic reactions (older than 2 minutes)
  const twoMinutesAgo = now - 2 * 60 * 1000;
  for (const [k, reaction] of optimisticReactions.entries()) {
    if (reaction.timestamp < twoMinutesAgo) {
      optimisticReactions.delete(k);
    }
  }
}

// Clear an optimistic reaction (call on publish failure to allow retry)
export function clearOptimisticReaction(targetEventId: string, emoji: string, userPubkey: string): void {
  const key = `${targetEventId}:${userPubkey}:${emoji}`;
  optimisticReactions.delete(key);
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
  processedReactionPairs.delete(eventId);
  
  // Clear counting in progress flag
  subscriptionCountingInProgress.delete(eventId);
  
  // Clean up optimistic zaps for this event
  for (const [key] of optimisticZaps.entries()) {
    if (key.startsWith(`${eventId}:`)) {
      optimisticZaps.delete(key);
    }
  }
  
  // Clean up optimistic reactions for this event
  for (const [key] of optimisticReactions.entries()) {
    if (key.startsWith(`${eventId}:`)) {
      optimisticReactions.delete(key);
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
    // totalAmount is stored in millisats (consumers divide by 1000 at display)
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
  processedReactionPairs.delete(eventId);
  
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
  // Init-if-absent on the dedup Sets — never wipe them here. The batch
  // subscription shares `processedEventIds` with any per-event subscription
  // that fetchEngagement may have already opened for the same eventId.
  // Wiping the Set at batch-entry caused the in-flight single subs and
  // the new batch sub to each count the same event against a fresh Set
  // (F5-B fingerprint). Eviction happens only in cleanupEngagement when
  // the event leaves the viewport.
  toFetch.forEach(id => {
    // Only reset counts to 0 when we're creating the dedup Set for the
    // first time for this id. If the Set is already populated (e.g. a
    // per-event `fetchEngagement` ran for this id moments ago), the
    // accumulated counts in `store` were produced against that Set —
    // wiping counts while preserving the Set would cause this batch sub
    // to dedup every historical event without ever re-counting them,
    // leaving counts stuck at 0.
    const isFirstInit = !processedEventIds.has(id);
    if (isFirstInit) {
      processedEventIds.set(id, new Set());
    }
    if (!processedReactionPairs.has(id)) {
      processedReactionPairs.set(id, new Set());
    }

    // Mark that subscription counting is in progress
    subscriptionCountingInProgress.add(id);

    if (isFirstInit) {
      const store = getEngagementStore(id);
      store.update(s => ({
        ...s,
        reactions: { count: 0, userReacted: false, groups: [], userReactions: new Set() },
        comments: { count: 0 },
        reposts: { count: 0, userReposted: false },
        zaps: { ...s.zaps, count: 0, totalAmount: 0, topZappers: [] },
        loading: true
      }));
    } else {
      // Re-entry: preserve counts; just flag loading so UI reflects
      // the refresh.
      const store = getEngagementStore(id);
      store.update(s => ({ ...s, loading: true }));
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
            processReaction(updated, event, userPublickey, targetEventId);
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
  processedReactionPairs.clear();
  subscriptionCountingInProgress.clear();
  optimisticZaps.clear();
  optimisticReactions.clear();
  
  // Clear localStorage cache
  if (browser) {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_KEY_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  }
  
  console.log('[Engagement] All caches cleared');
}

