/**
 * Outbox Model Implementation for Nostr
 * 
 * Instead of querying random relays hoping to find posts from people you follow,
 * this queries each user's actual write relays (from NIP-65 relay lists).
 * 
 * Flow:
 * 1. Get user's contact list (kind:3) with optional relay hints
 * 2. Fetch NIP-65 relay lists (kind:10002) for all follows
 * 3. Group follows by their write relays
 * 4. Query each relay with only the authors who write there
 * 5. Merge and deduplicate results
 */

import type { NDK, NDKEvent, NDKFilter, NDKRelaySet } from '@nostr-dev-kit/ndk';
import { get } from 'svelte/store';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface FollowWithRelays {
  pubkey: string;
  relayHints: string[];  // From kind:3 contact list
  petname?: string;
}

export interface UserRelayConfig {
  pubkey: string;
  writeRelays: string[];
  readRelays: string[];
  lastUpdated: number;
}

export interface OutboxQueryPlan {
  relay: string;
  authors: string[];
}

export interface OutboxFetchOptions {
  since?: number;
  until?: number;
  limit?: number;
  kinds?: number[];
  additionalFilter?: Partial<NDKFilter>;
  timeoutMs?: number;
  maxRelaysPerUser?: number;
  maxAuthorsPerRelay?: number;
}

export interface OutboxFetchResult {
  events: NDKEvent[];
  queriedRelays: string[];
  failedRelays: string[];
  timing: {
    relayListFetchMs: number;
    eventFetchMs: number;
    totalMs: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// CACHES
// ═══════════════════════════════════════════════════════════════

// Cache relay configs for users (persists across feed loads)
const userRelayCache = new Map<string, UserRelayConfig>();

// Cache the user's follow list
let cachedFollowList: FollowWithRelays[] | null = null;
let followListPubkey: string | null = null;
let followListTimestamp = 0;

// Constants
const FOLLOW_LIST_CACHE_MS = 5 * 60 * 1000;  // 5 minutes
const RELAY_CONFIG_CACHE_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RELAYS_PER_USER = 3;
const MAX_AUTHORS_PER_RELAY = 75;

// Fallback relays when user has no NIP-65 config
const FALLBACK_WRITE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band'
];

// ═══════════════════════════════════════════════════════════════
// FOLLOW LIST FETCHING
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch the user's contact list (kind:3) with relay hints
 */
export async function fetchFollowList(
  ndk: NDK,
  userPubkey: string,
  forceRefresh = false
): Promise<FollowWithRelays[]> {
  const now = Date.now();
  
  // Return cached if valid
  if (
    !forceRefresh &&
    cachedFollowList &&
    followListPubkey === userPubkey &&
    now - followListTimestamp < FOLLOW_LIST_CACHE_MS
  ) {
    return cachedFollowList;
  }
  
  try {
    const contactEvent = await ndk.fetchEvent({
      kinds: [3],
      authors: [userPubkey],
      limit: 1
    });
    
    if (!contactEvent) {
      cachedFollowList = [];
      followListPubkey = userPubkey;
      followListTimestamp = now;
      return [];
    }
    
    // Parse p tags: ["p", "<pubkey>", "<relay-url>?", "<petname>?"]
    const follows: FollowWithRelays[] = contactEvent.tags
      .filter(tag => tag[0] === 'p' && tag[1])
      .map(tag => ({
        pubkey: tag[1],
        relayHints: tag[2] ? [normalizeRelayUrl(tag[2])] : [],
        petname: tag[3] || undefined
      }));
    
    cachedFollowList = follows;
    followListPubkey = userPubkey;
    followListTimestamp = now;
    
    return follows;
    
  } catch (err) {
    console.warn('[Outbox] Failed to fetch contact list:', err);
    return cachedFollowList || [];
  }
}

/**
 * Get just the pubkeys of followed users
 */
export async function getFollowedPubkeys(
  ndk: NDK,
  userPubkey: string
): Promise<string[]> {
  const follows = await fetchFollowList(ndk, userPubkey);
  return follows.map(f => f.pubkey);
}

// ═══════════════════════════════════════════════════════════════
// NIP-65 RELAY LIST FETCHING
// ═══════════════════════════════════════════════════════════════

/**
 * Normalize relay URLs for consistent comparison
 */
function normalizeRelayUrl(url: string): string {
  try {
    let normalized = url.trim().toLowerCase();
    
    // Ensure wss:// prefix
    if (!normalized.startsWith('wss://') && !normalized.startsWith('ws://')) {
      normalized = 'wss://' + normalized;
    }
    
    // Remove trailing slash
    normalized = normalized.replace(/\/+$/, '');
    
    return normalized;
  } catch {
    return url;
  }
}

/**
 * Parse a kind:10002 relay list event
 */
function parseRelayListEvent(event: NDKEvent): UserRelayConfig {
  const writeRelays: string[] = [];
  const readRelays: string[] = [];
  
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    
    const relay = normalizeRelayUrl(tag[1]);
    const marker = tag[2]?.toLowerCase();
    
    if (!marker || marker === 'write') {
      writeRelays.push(relay);
    }
    if (!marker || marker === 'read') {
      readRelays.push(relay);
    }
  }
  
  return {
    pubkey: event.pubkey,
    writeRelays,
    readRelays,
    lastUpdated: Date.now()
  };
}

/**
 * Fetch NIP-65 relay lists for multiple users
 * Returns configs for users we successfully fetched
 */
export async function fetchRelayLists(
  ndk: NDK,
  pubkeys: string[],
  forceRefresh = false
): Promise<Map<string, UserRelayConfig>> {
  const now = Date.now();
  const results = new Map<string, UserRelayConfig>();
  
  // Separate cached vs needs-fetch
  const needsFetch: string[] = [];
  
  for (const pubkey of pubkeys) {
    const cached = userRelayCache.get(pubkey);
    
    if (
      !forceRefresh &&
      cached &&
      now - cached.lastUpdated < RELAY_CONFIG_CACHE_MS
    ) {
      results.set(pubkey, cached);
    } else {
      needsFetch.push(pubkey);
    }
  }
  
  if (needsFetch.length === 0) {
    return results;
  }
  
  try {
    // Batch fetch kind:10002 events
    // Query in batches to avoid huge filter
    const batchSize = 150;
    const allRelayEvents: NDKEvent[] = [];
    
    for (let i = 0; i < needsFetch.length; i += batchSize) {
      const batch = needsFetch.slice(i, i + batchSize);
      
      const events = await ndk.fetchEvents({
        kinds: [10002],
        authors: batch
      });
      
      allRelayEvents.push(...events);
    }
    
    // Parse and cache results
    for (const event of allRelayEvents) {
      const config = parseRelayListEvent(event);
      
      // Only cache if they have write relays
      if (config.writeRelays.length > 0) {
        userRelayCache.set(event.pubkey, config);
        results.set(event.pubkey, config);
      }
    }
    
    // Mark users without relay lists (so we don't keep re-fetching)
    for (const pubkey of needsFetch) {
      if (!results.has(pubkey)) {
        // No relay list found - cache with fallbacks
        const fallbackConfig: UserRelayConfig = {
          pubkey,
          writeRelays: [],  // Empty signals "use fallback"
          readRelays: [],
          lastUpdated: now
        };
        userRelayCache.set(pubkey, fallbackConfig);
      }
    }
    
  } catch (err) {
    console.warn('[Outbox] Failed to fetch relay lists:', err);
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// QUERY PLANNING
// ═══════════════════════════════════════════════════════════════

/**
 * Build an optimized query plan: which relays to query for which authors
 */
export function buildQueryPlan(
  follows: FollowWithRelays[],
  relayConfigs: Map<string, UserRelayConfig>,
  options: {
    maxRelaysPerUser?: number;
    maxAuthorsPerRelay?: number;
  } = {}
): OutboxQueryPlan[] {
  const maxRelaysPerUser = options.maxRelaysPerUser || MAX_RELAYS_PER_USER;
  const maxAuthorsPerRelay = options.maxAuthorsPerRelay || MAX_AUTHORS_PER_RELAY;
  
  // Map: relay -> Set of pubkeys
  const relayToAuthors = new Map<string, Set<string>>();
  
  // Track which users have no known relays (need fallback)
  const usersNeedingFallback: string[] = [];
  
  for (const follow of follows) {
    const config = relayConfigs.get(follow.pubkey);
    
    // Determine write relays for this user
    let writeRelays: string[] = [];
    
    if (config && config.writeRelays.length > 0) {
      // Use NIP-65 write relays
      writeRelays = config.writeRelays.slice(0, maxRelaysPerUser);
    } else if (follow.relayHints.length > 0) {
      // Fall back to relay hints from contact list
      writeRelays = follow.relayHints.slice(0, maxRelaysPerUser);
    } else {
      // No relay info at all - will use fallback
      usersNeedingFallback.push(follow.pubkey);
      continue;
    }
    
    // Add user to each of their write relays
    for (const relay of writeRelays) {
      const existing = relayToAuthors.get(relay) || new Set();
      existing.add(follow.pubkey);
      relayToAuthors.set(relay, existing);
    }
  }
  
  // Add fallback users to fallback relays
  if (usersNeedingFallback.length > 0) {
    for (const relay of FALLBACK_WRITE_RELAYS) {
      const existing = relayToAuthors.get(relay) || new Set();
      for (const pubkey of usersNeedingFallback) {
        existing.add(pubkey);
      }
      relayToAuthors.set(relay, existing);
    }
  }
  
  // Convert to query plan, respecting max authors per relay
  const queryPlan: OutboxQueryPlan[] = [];
  
  for (const [relay, authorSet] of relayToAuthors) {
    const authors = Array.from(authorSet);
    
    // Split into batches if too many authors
    for (let i = 0; i < authors.length; i += maxAuthorsPerRelay) {
      queryPlan.push({
        relay,
        authors: authors.slice(i, i + maxAuthorsPerRelay)
      });
    }
  }
  
  // Sort by author count (query larger batches first for better parallelism)
  queryPlan.sort((a, b) => b.authors.length - a.authors.length);
  
  return queryPlan;
}

// ═══════════════════════════════════════════════════════════════
// EVENT FETCHING
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch events from a specific relay with timeout
 */
async function fetchFromRelay(
  ndk: NDK,
  relay: string,
  filter: NDKFilter,
  timeoutMs: number
): Promise<{ events: NDKEvent[]; success: boolean }> {
  try {
    const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');
    const relaySet = NDKRelaySet.fromRelayUrls([relay], ndk, true);
    
    const timeoutPromise = new Promise<Set<NDKEvent>>((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    );
    
    const fetchPromise = ndk.fetchEvents(filter, undefined, relaySet);
    
    const events = await Promise.race([fetchPromise, timeoutPromise]);
    return { events: Array.from(events), success: true };
    
  } catch (err) {
    // Don't log timeout errors - they're expected
    if (err instanceof Error && err.message !== 'Timeout') {
      console.warn(`[Outbox] Relay ${relay} failed:`, err.message);
    }
    return { events: [], success: false };
  }
}

/**
 * Execute the query plan and fetch events
 */
async function executeQueryPlan(
  ndk: NDK,
  queryPlan: OutboxQueryPlan[],
  baseFilter: Omit<NDKFilter, 'authors'>,
  timeoutMs: number
): Promise<{ events: NDKEvent[]; failedRelays: string[] }> {
  const allEvents: NDKEvent[] = [];
  const seenIds = new Set<string>();
  const failedRelays: string[] = [];
  
  // Execute all queries in parallel
  const fetchPromises = queryPlan.map(async (plan) => {
    const filter: NDKFilter = {
      ...baseFilter,
      authors: plan.authors
    };
    
    const result = await fetchFromRelay(ndk, plan.relay, filter, timeoutMs);
    
    if (!result.success) {
      failedRelays.push(plan.relay);
    }
    
    return { relay: plan.relay, events: result.events };
  });
  
  const results = await Promise.allSettled(fetchPromises);
  
  // Collect and deduplicate events
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const event of result.value.events) {
        if (event.id && !seenIds.has(event.id)) {
          seenIds.add(event.id);
          allEvents.push(event);
        }
      }
    }
  }
  
  return { events: allEvents, failedRelays };
}

// ═══════════════════════════════════════════════════════════════
// MAIN PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch events from followed users using the outbox model
 * 
 * This is the main function to use. It:
 * 1. Gets the user's follow list
 * 2. Fetches relay configs for all follows
 * 3. Builds an optimized query plan
 * 4. Fetches events from the right relays
 * 
 * @example
 * const result = await fetchFollowingEvents(ndk, userPubkey, {
 *   since: Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60,
 *   kinds: [1],
 *   limit: 50
 * });
 */
export async function fetchFollowingEvents(
  ndk: NDK,
  userPubkey: string,
  options: OutboxFetchOptions = {}
): Promise<OutboxFetchResult> {
  const startTime = Date.now();
  const {
    since,
    until,
    limit = 50,
    kinds = [1],
    additionalFilter = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRelaysPerUser = MAX_RELAYS_PER_USER,
    maxAuthorsPerRelay = MAX_AUTHORS_PER_RELAY
  } = options;
  
  // Step 1: Get follow list
  const follows = await fetchFollowList(ndk, userPubkey);
  
  if (follows.length === 0) {
    return {
      events: [],
      queriedRelays: [],
      failedRelays: [],
      timing: {
        relayListFetchMs: 0,
        eventFetchMs: 0,
        totalMs: Date.now() - startTime
      }
    };
  }
  
  // Step 2: Fetch relay configurations
  const relayListStart = Date.now();
  const pubkeys = follows.map(f => f.pubkey);
  const relayConfigs = await fetchRelayLists(ndk, pubkeys);
  const relayListFetchMs = Date.now() - relayListStart;
  
  // Step 3: Build query plan
  const queryPlan = buildQueryPlan(follows, relayConfigs, {
    maxRelaysPerUser,
    maxAuthorsPerRelay
  });
  
  if (queryPlan.length === 0) {
    return {
      events: [],
      queriedRelays: [],
      failedRelays: [],
      timing: {
        relayListFetchMs,
        eventFetchMs: 0,
        totalMs: Date.now() - startTime
      }
    };
  }
  
  // Step 4: Build base filter
  const baseFilter: NDKFilter = {
    kinds,
    limit,
    ...additionalFilter
  };
  
  if (since) baseFilter.since = since;
  if (until) baseFilter.until = until;
  
  // Step 5: Execute query plan
  const eventFetchStart = Date.now();
  const { events, failedRelays } = await executeQueryPlan(
    ndk,
    queryPlan,
    baseFilter,
    timeoutMs
  );
  const eventFetchMs = Date.now() - eventFetchStart;
  
  // Sort by created_at descending
  events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  
  return {
    events,
    queriedRelays: queryPlan.map(p => p.relay),
    failedRelays,
    timing: {
      relayListFetchMs,
      eventFetchMs,
      totalMs: Date.now() - startTime
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Clear all caches (useful when user logs out)
 */
export function clearOutboxCaches(): void {
  userRelayCache.clear();
  cachedFollowList = null;
  followListPubkey = null;
  followListTimestamp = 0;
}

/**
 * Get cache stats for debugging
 */
export function getOutboxCacheStats(): {
  followListCached: boolean;
  followCount: number;
  relayConfigsCached: number;
} {
  return {
    followListCached: cachedFollowList !== null,
    followCount: cachedFollowList?.length || 0,
    relayConfigsCached: userRelayCache.size
  };
}

/**
 * Pre-warm the cache by fetching relay lists for all follows
 * Call this on app startup for faster initial feed load
 */
export async function prewarmOutboxCache(
  ndk: NDK,
  userPubkey: string
): Promise<void> {
  const follows = await fetchFollowList(ndk, userPubkey);
  if (follows.length > 0) {
    await fetchRelayLists(ndk, follows.map(f => f.pubkey));
  }
}
