/**
 * Article Outbox Strategy
 * 
 * Optimized fetching strategy for kind:30023 (longform articles) that combines:
 * 1. Primal cache (fast path - aggregates from 100+ relays)
 * 2. Discovery relays (broad content discovery)
 * 3. Default relays (reliable fallback)
 * 
 * Unlike the follow-based outbox model for kind:1, articles are fetched by
 * hashtags rather than author write relays, since we're discovering content
 * rather than fetching from specific users.
 */

import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';
import { browser } from '$app/environment';
import { 
  fetchArticlesFromPrimal, 
  isPrimalCacheAvailable,
  type PrimalArticleOptions 
} from './primalCache';
import { RELAY_SETS } from './relays/relaySets';
import { 
  isValidLongformArticleNoFoodFilter,
  ALL_ARTICLE_HASHTAGS
} from './articleUtils';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ArticleFetchOptions {
  /** Maximum number of articles to fetch */
  limit?: number;
  /** Fetch articles newer than this timestamp */
  since?: number;
  /** Fetch articles older than this timestamp (for pagination) */
  until?: number;
  /** Hashtags to filter by (uses ALL_ARTICLE_HASHTAGS if not provided) */
  hashtags?: string[];
  /** Timeout for Primal cache in ms */
  primalTimeoutMs?: number;
  /** Timeout for relay fetches in ms */
  relayTimeoutMs?: number;
  /** Skip Primal and go straight to relays */
  skipPrimal?: boolean;
  /** Callback when events are received (for streaming) */
  onEvent?: (event: NDKEvent) => void;
  /** Callback when fetch completes */
  onComplete?: (stats: ArticleFetchStats) => void;
}

export interface ArticleFetchResult {
  events: NDKEvent[];
  stats: ArticleFetchStats;
}

export interface ArticleFetchStats {
  totalEvents: number;
  primalEvents: number;
  relayEvents: number;
  primalTimeMs: number;
  relayTimeMs: number;
  totalTimeMs: number;
  usedPrimal: boolean;
  relaysQueried: string[];
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Primal settings
  PRIMAL_TIMEOUT_MS: 6000,           // 6 seconds for Primal
  PRIMAL_MIN_RESULTS: 10,            // Minimum results to consider Primal successful
  
  // Relay settings  
  RELAY_TIMEOUT_MS: 15000,           // 15 seconds for relays (more time for depth)
  
  // Article-optimized relays (good for longform content)
  ARTICLE_RELAYS: [
    'wss://relay.primal.net',        // Primal's relay (aggregated content)
    'wss://relay.damus.io',          // Large general relay
    'wss://nos.lol',                 // Popular relay with good uptime
    'wss://nostr.wine',              // Premium relay with quality content
    'wss://purplepag.es',            // Good for profile/content discovery
    'wss://relay.nostr.band',        // Search-optimized relay
  ],
  
  // Fallback relays if primary ones fail
  FALLBACK_RELAYS: [
    'wss://nostr.mutinywallet.com',
    'wss://relay.snort.social',
  ]
};

// ═══════════════════════════════════════════════════════════════
// MAIN FETCH FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch articles using optimized strategy:
 * 1. Try Primal cache first (fast, aggregated from 100+ relays)
 * 2. Supplement with discovery relays if needed
 * 3. Background fetch from additional relays to catch anything Primal missed
 */
export async function fetchArticles(
  ndk: NDK,
  options: ArticleFetchOptions = {}
): Promise<ArticleFetchResult> {
  const startTime = Date.now();
  const {
    limit = 100,
    since,
    until,
    hashtags = ALL_ARTICLE_HASHTAGS.slice(0, 40), // Use top hashtags by default
    primalTimeoutMs = CONFIG.PRIMAL_TIMEOUT_MS,
    relayTimeoutMs = CONFIG.RELAY_TIMEOUT_MS,
    skipPrimal = false,
    onEvent,
    onComplete
  } = options;

  const stats: ArticleFetchStats = {
    totalEvents: 0,
    primalEvents: 0,
    relayEvents: 0,
    primalTimeMs: 0,
    relayTimeMs: 0,
    totalTimeMs: 0,
    usedPrimal: false,
    relaysQueried: [],
    errors: []
  };

  const seenIds = new Set<string>();
  const allEvents: NDKEvent[] = [];

  // Helper to add events without duplicates
  const addEvents = (events: NDKEvent[], source: 'primal' | 'relay'): number => {
    let added = 0;
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    
    for (const event of events) {
      if (!event.id) continue;
      
      if (seenIds.has(event.id)) {
        skippedDuplicate++;
        continue;
      }
      
      // Validate it's a valid longform article
      if (!isValidLongformArticleNoFoodFilter(event)) {
        skippedInvalid++;
        continue;
      }
      
      seenIds.add(event.id);
      allEvents.push(event);
      added++;
      
      if (onEvent) {
        onEvent(event);
      }
    }
    
    if (source === 'primal') {
      stats.primalEvents += added;
    } else {
      stats.relayEvents += added;
    }
    
    // Log filtering stats for debugging
    if (events.length > 0 && added === 0) {
      console.log(`[ArticleOutbox] ${source}: ${events.length} events received, ${skippedDuplicate} duplicates, ${skippedInvalid} invalid`);
    }
    
    return added;
  };

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Try Primal Cache (fast path)
  // ═══════════════════════════════════════════════════════════════
  
  if (!skipPrimal && browser && isPrimalCacheAvailable()) {
    const primalStart = Date.now();
    
    try {
      if (import.meta.env.DEV) {
        console.log('[ArticleOutbox] Trying Primal cache...');
      }
      
      const primalOptions: PrimalArticleOptions = {
        limit: Math.min(limit * 2, 200), // Request more to account for filtering
        hashtags
      };
      
      if (since) primalOptions.since = since;
      if (until) primalOptions.until = until;
      
      const { events: primalEvents } = await Promise.race([
        fetchArticlesFromPrimal(ndk, primalOptions),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Primal timeout')), primalTimeoutMs)
        )
      ]);
      
      const addedCount = addEvents(primalEvents, 'primal');
      stats.primalTimeMs = Date.now() - primalStart;
      stats.usedPrimal = addedCount >= CONFIG.PRIMAL_MIN_RESULTS;
      
      if (import.meta.env.DEV) {
        console.log(`[ArticleOutbox] Primal: ${addedCount} articles in ${stats.primalTimeMs}ms`);
      }
      
    } catch (err) {
      stats.primalTimeMs = Date.now() - primalStart;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      stats.errors.push(`Primal: ${errorMsg}`);
      
      // Log error in production too (but as warn, not error)
      console.warn('[ArticleOutbox] Primal failed:', errorMsg);
      if (import.meta.env.DEV && err instanceof Error) {
        console.warn('[ArticleOutbox] Primal error details:', err);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Fetch from Relays (supplement or primary)
  // ═══════════════════════════════════════════════════════════════
  
  // Only fetch from relays if:
  // - Primal was skipped or failed
  // - Primal didn't return enough results
  // - We need to supplement (background refresh)
  const needRelayFetch = !stats.usedPrimal || allEvents.length < limit;
  
  if (needRelayFetch && browser) {
    const relayStart = Date.now();
    
    try {
      // Build relay list
      const relaysToQuery = new Set<string>();
      
      // Add discovery relays
      const discoveryRelays = RELAY_SETS.discovery?.relays || [];
      discoveryRelays.forEach(r => relaysToQuery.add(r));
      
      // Add default relays (but exclude garden.zap.cooking - it has issues with kind:30023)
      const defaultRelays = RELAY_SETS.default?.relays || [];
      defaultRelays.forEach(r => {
        if (r !== 'wss://garden.zap.cooking') {
          relaysToQuery.add(r);
        }
      });
      
      // Add article-optimized relays
      CONFIG.ARTICLE_RELAYS.forEach(r => relaysToQuery.add(r));
      
      stats.relaysQueried = [...relaysToQuery];
      
      // Build filter - fetch all kind:30023 events, filter by hashtags client-side
      // Some relays don't handle large hashtag arrays well
      const filter: NDKFilter = {
        kinds: [30023],
        limit: 2000 // Request lots of events since we filter client-side
      };
      
      // If no since/until specified, default to recent articles (last 90 days)
      if (since) {
        filter.since = since;
      } else if (!until) {
        // Default to last 90 days for recent articles
        filter.since = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60);
      }
      if (until) filter.until = until;
      
      // Use top food hashtags for relay filter (most relays limit to ~10-20 tags)
      // This ensures we get food-related content from the relay
      const TOP_FOOD_HASHTAGS = [
        'food', 'foodstr', 'cooking', 'recipe', 'recipes', 'chef',
        'farming', 'homesteading', 'gardening', 'foodie', 'homecooking',
        'beef', 'chicken', 'breakfast', 'dinner', 'baking', 'bbq',
        'vegan', 'keto', 'coffee'
      ];
      filter['#t'] = TOP_FOOD_HASHTAGS;
      
      // Log relay query info
      console.log(`[ArticleOutbox] Querying ${relaysToQuery.size} relays for kind:30023...`);
      
      // Create relay set and fetch
      const relaySet = NDKRelaySet.fromRelayUrls([...relaysToQuery], ndk, true);
      
      const relayEvents = await Promise.race([
        ndk.fetchEvents(filter, undefined, relaySet),
        new Promise<Set<NDKEvent>>((resolve) => 
          setTimeout(() => resolve(new Set()), relayTimeoutMs)
        )
      ]);
      
      const rawCount = relayEvents.size;
      const addedCount = addEvents([...relayEvents], 'relay');
      stats.relayTimeMs = Date.now() - relayStart;
      
      // Log results (even in production for debugging)
      console.log(`[ArticleOutbox] Relays returned ${rawCount} events, ${addedCount} valid articles in ${stats.relayTimeMs}ms`);
      
      if (rawCount > 0 && addedCount === 0) {
        console.warn('[ArticleOutbox] All events filtered out - check article validation');
      }
      
    } catch (err) {
      stats.relayTimeMs = Date.now() - relayStart;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      stats.errors.push(`Relays: ${errorMsg}`);
      
      // Log error in production too
      console.error('[ArticleOutbox] Relay fetch failed:', errorMsg);
      if (import.meta.env.DEV && err instanceof Error) {
        console.error('[ArticleOutbox] Relay error details:', err);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FINALIZE
  // ═══════════════════════════════════════════════════════════════
  
  // Sort by timestamp (newest first)
  allEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  
  // Return all events (let the caller decide how many to use)
  // The limit is just a hint for relay requests, not a hard cap on results
  stats.totalEvents = allEvents.length;
  stats.totalTimeMs = Date.now() - startTime;
  
  if (import.meta.env.DEV) {
    console.log(
      `[ArticleOutbox] Complete: ${stats.totalEvents} articles ` +
      `(${stats.primalEvents} Primal, ${stats.relayEvents} relay) ` +
      `in ${stats.totalTimeMs}ms`
    );
  }
  
  if (onComplete) {
    onComplete(stats);
  }
  
  return {
    events: allEvents, // Return all valid events, sorted by date
    stats
  };
}

// ═══════════════════════════════════════════════════════════════
// STREAMING FETCH (for real-time updates)
// ═══════════════════════════════════════════════════════════════

/**
 * Create a subscription for new articles (real-time updates)
 * Returns subscription that can be stopped when component unmounts
 */
export function subscribeToArticles(
  ndk: NDK,
  options: {
    hashtags?: string[];
    onEvent: (event: NDKEvent) => void;
    onEose?: () => void;
  }
): NDKSubscription | null {
  if (!browser) return null;
  
  const { hashtags = ALL_ARTICLE_HASHTAGS.slice(0, 40), onEvent, onEose } = options;
  
  const filter: NDKFilter = {
    kinds: [30023],
    '#t': hashtags,
    since: Math.floor(Date.now() / 1000) - 3600 // Last hour for real-time
  };
  
  // Use default + discovery relays
  const relays = [
    ...(RELAY_SETS.default?.relays || []),
    ...(RELAY_SETS.discovery?.relays || [])
  ];
  
  const relaySet = NDKRelaySet.fromRelayUrls([...new Set(relays)], ndk, true);
  const subscription = ndk.subscribe(filter, { closeOnEose: false }, relaySet);
  
  subscription.on('event', (event: NDKEvent) => {
    if (isValidLongformArticleNoFoodFilter(event)) {
      onEvent(event);
    }
  });
  
  if (onEose) {
    subscription.on('eose', onEose);
  }
  
  return subscription;
}

// ═══════════════════════════════════════════════════════════════
// BACKGROUND REFRESH
// ═══════════════════════════════════════════════════════════════

/**
 * Background refresh function - fetches quietly without blocking UI
 * Returns new events that weren't in the existing set
 */
export async function backgroundArticleRefresh(
  ndk: NDK,
  existingIds: Set<string>,
  options: {
    hashtags?: string[];
    limit?: number;
  } = {}
): Promise<NDKEvent[]> {
  const { hashtags = ALL_ARTICLE_HASHTAGS.slice(0, 40), limit = 50 } = options;
  
  const newEvents: NDKEvent[] = [];
  
  try {
    const { events } = await fetchArticles(ndk, {
      hashtags,
      limit,
      primalTimeoutMs: 4000, // Shorter timeout for background
      relayTimeoutMs: 6000
    });
    
    for (const event of events) {
      if (event.id && !existingIds.has(event.id)) {
        newEvents.push(event);
      }
    }
    
    if (import.meta.env.DEV && newEvents.length > 0) {
      console.log(`[ArticleOutbox] Background refresh found ${newEvents.length} new articles`);
    }
    
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[ArticleOutbox] Background refresh error:', err);
    }
  }
  
  return newEvents;
}
