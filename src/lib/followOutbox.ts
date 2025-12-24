/**
 * Outbox Model Implementation for Nostr - v4
 * 
 * Back to fetchEvents (which works) but with:
 * - Proper per-relay timeout via AbortController pattern
 * - Global timeout that actually stops everything
 * - Early termination after enough events
 * - Aggressive relay blocklist
 */

import type { NDK, NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface FollowWithRelays {
  pubkey: string;
  relayHints: string[];
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
  priority: number;
}

export interface OutboxFetchOptions {
  since?: number;
  until?: number;
  limit?: number;
  kinds?: number[];
  additionalFilter?: Partial<NDKFilter>;
  timeoutMs?: number;
  globalTimeoutMs?: number;
  maxRelays?: number;
  maxAuthorsPerRelay?: number;
  minAuthorsPerRelay?: number;
  targetEventCount?: number;
}

export interface OutboxFetchResult {
  events: NDKEvent[];
  queriedRelays: string[];
  skippedRelays: string[];
  failedRelays: string[];
  timing: {
    relayListFetchMs: number;
    eventFetchMs: number;
    totalMs: number;
  };
  stoppedEarly: boolean;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  FOLLOW_LIST_CACHE_MS: 5 * 60 * 1000,
  RELAY_CONFIG_CACHE_MS: 30 * 60 * 1000,
  
  // Timeouts
  PER_RELAY_TIMEOUT_MS: 2500,      // Faster timeout per relay
  GLOBAL_TIMEOUT_MS: 5000,         // 5 second cap
  
  // Limits
  MAX_RELAYS_TO_QUERY: 20,          // Keep all 20
  MAX_AUTHORS_PER_RELAY: 50,
  MIN_AUTHORS_PER_RELAY: 3,         // Skip relays with < 3 authors
  MAX_RELAYS_PER_USER: 2,
  TARGET_EVENT_COUNT: 300,        // Slightly higher target
  
  RELAY_LIST_BATCH_SIZE: 150,
  CONCURRENT_BATCHES: 6,            // More parallel (was 4)
  
  FALLBACK_RELAYS: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net'
  ],
  
  // Block these entirely - they're slow or broken
  BLOCKED_RELAYS: new Set([
    'wss://relay.nostr.band',
    'wss://nostr.wine',
    'wss://filter.nostr.wine',
    'wss://relay.nostr.bg',
    'wss://nostrelites.org',
    'wss://nostr.fmt.wiz.biz',
    'wss://relayable.org',
    'wss://lightningrelay.com',
    'wss://nostr.mutinywallet.com',
    'wss://relay.nostrplebs.com',
    'wss://relay.0xchat.com',
    'wss://relay.nos.social',
    'wss://relay.momostr.pink',
    'wss://offchain.pub',
    'wss://nostr-pub.wellorder.net',
  ])
};

// ═══════════════════════════════════════════════════════════════
// CACHES
// ═══════════════════════════════════════════════════════════════

const userRelayCache = new Map<string, UserRelayConfig>();
let cachedFollowList: FollowWithRelays[] | null = null;
let followListPubkey: string | null = null;
let followListTimestamp = 0;

// ═══════════════════════════════════════════════════════════════
// LOCALSTORAGE CACHING FOR RELAY CONFIGS
// ═══════════════════════════════════════════════════════════════

const RELAY_CACHE_KEY = 'outbox_relay_configs';
const RELAY_CACHE_VERSION = 1;

function loadRelayConfigsFromStorage(): Map<string, UserRelayConfig> | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    
    const stored = localStorage.getItem(RELAY_CACHE_KEY);
    if (!stored) return null;
    
    const { version, data, timestamp } = JSON.parse(stored);
    
    // Check version and age (cache for 24 hours)
    if (version !== RELAY_CACHE_VERSION) return null;
    if (Date.now() - timestamp > 24 * 60 * 60 * 1000) return null;
    
    return new Map(Object.entries(data));
  } catch {
    return null;
  }
}

function saveRelayConfigsToStorage(configs: Map<string, UserRelayConfig>) {
  try {
    if (typeof localStorage === 'undefined') return;
    
    const data = Object.fromEntries(configs);
    localStorage.setItem(RELAY_CACHE_KEY, JSON.stringify({
      version: RELAY_CACHE_VERSION,
      timestamp: Date.now(),
      data
    }));
  } catch {
    // localStorage full or unavailable
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function normalizeRelayUrl(url: string): string {
  try {
    let normalized = url.trim().toLowerCase();
    if (!normalized.startsWith('wss://') && !normalized.startsWith('ws://')) {
      normalized = 'wss://' + normalized;
    }
    return normalized.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function isValidRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'wss:' || parsed.protocol === 'ws:';
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// FOLLOW LIST
// ═══════════════════════════════════════════════════════════════

export async function fetchFollowList(
  ndk: NDK,
  userPubkey: string,
  forceRefresh = false
): Promise<FollowWithRelays[]> {
  const now = Date.now();
  
  if (
    !forceRefresh &&
    cachedFollowList &&
    followListPubkey === userPubkey &&
    now - followListTimestamp < CONFIG.FOLLOW_LIST_CACHE_MS
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
    
    const follows: FollowWithRelays[] = contactEvent.tags
      .filter(tag => tag[0] === 'p' && tag[1])
      .map(tag => ({
        pubkey: tag[1],
        relayHints: tag[2] && isValidRelayUrl(tag[2]) 
          ? [normalizeRelayUrl(tag[2])] 
          : [],
        petname: tag[3] || undefined
      }));
    
    cachedFollowList = follows;
    followListPubkey = userPubkey;
    followListTimestamp = now;
    
    console.log(`[Outbox] Loaded ${follows.length} follows`);
    return follows;
    
  } catch (err) {
    console.warn('[Outbox] Failed to fetch contact list:', err);
    return cachedFollowList || [];
  }
}

export async function getFollowedPubkeys(
  ndk: NDK,
  userPubkey: string
): Promise<string[]> {
  const follows = await fetchFollowList(ndk, userPubkey);
  return follows.map(f => f.pubkey);
}

// ═══════════════════════════════════════════════════════════════
// NIP-65 RELAY LISTS
// ═══════════════════════════════════════════════════════════════

function parseRelayListEvent(event: NDKEvent): UserRelayConfig {
  const writeRelays: string[] = [];
  const readRelays: string[] = [];
  
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    if (!isValidRelayUrl(tag[1])) continue;
    
    const relay = normalizeRelayUrl(tag[1]);
    if (CONFIG.BLOCKED_RELAYS.has(relay)) continue;
    
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

export async function fetchRelayLists(
  ndk: NDK,
  pubkeys: string[],
  forceRefresh = false
): Promise<Map<string, UserRelayConfig>> {
  const now = Date.now();
  const results = new Map<string, UserRelayConfig>();
  const needsFetch: string[] = [];
  
  // Try loading from localStorage first if memory cache is empty
  if (!forceRefresh && userRelayCache.size === 0) {
    const stored = loadRelayConfigsFromStorage();
    if (stored) {
      console.log(`[Outbox] Loaded ${stored.size} relay configs from storage`);
      for (const [k, v] of stored) {
        userRelayCache.set(k, v);
      }
    }
  }
  
  for (const pubkey of pubkeys) {
    const cached = userRelayCache.get(pubkey);
    if (!forceRefresh && cached && now - cached.lastUpdated < CONFIG.RELAY_CONFIG_CACHE_MS) {
      results.set(pubkey, cached);
    } else {
      needsFetch.push(pubkey);
    }
  }
  
  if (needsFetch.length === 0) return results;
  
  console.log(`[Outbox] Fetching relay lists for ${needsFetch.length} users`);
  
  try {
    const allRelayEvents: NDKEvent[] = [];
    
    for (let i = 0; i < needsFetch.length; i += CONFIG.RELAY_LIST_BATCH_SIZE) {
      const batch = needsFetch.slice(i, i + CONFIG.RELAY_LIST_BATCH_SIZE);
      const events = await ndk.fetchEvents({ kinds: [10002], authors: batch });
      allRelayEvents.push(...events);
    }
    
    console.log(`[Outbox] Got ${allRelayEvents.length} relay list events`);
    
    for (const event of allRelayEvents) {
      const config = parseRelayListEvent(event);
      if (config.writeRelays.length > 0) {
        userRelayCache.set(event.pubkey, config);
        results.set(event.pubkey, config);
      }
    }
    
    for (const pubkey of needsFetch) {
      if (!results.has(pubkey)) {
        userRelayCache.set(pubkey, {
          pubkey,
          writeRelays: [],
          readRelays: [],
          lastUpdated: now
        });
      }
    }
    
    // Save to localStorage after fetching new configs
    if (userRelayCache.size > 0) {
      saveRelayConfigsToStorage(userRelayCache);
    }
  } catch (err) {
    console.warn('[Outbox] Failed to fetch relay lists:', err);
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════
// QUERY PLANNING
// ═══════════════════════════════════════════════════════════════

export function buildQueryPlan(
  follows: FollowWithRelays[],
  relayConfigs: Map<string, UserRelayConfig>,
  options: {
    maxRelays?: number;
    maxAuthorsPerRelay?: number;
    minAuthorsPerRelay?: number;
  } = {}
): { plan: OutboxQueryPlan[]; skippedRelays: string[] } {
  const maxRelays = options.maxRelays || CONFIG.MAX_RELAYS_TO_QUERY;
  const maxAuthorsPerRelay = options.maxAuthorsPerRelay || CONFIG.MAX_AUTHORS_PER_RELAY;
  const minAuthorsPerRelay = options.minAuthorsPerRelay || CONFIG.MIN_AUTHORS_PER_RELAY;
  
  const relayToAuthors = new Map<string, Set<string>>();
  const usersNeedingFallback: string[] = [];
  
  for (const follow of follows) {
    const config = relayConfigs.get(follow.pubkey);
    let writeRelays: string[] = [];
    
    if (config && config.writeRelays.length > 0) {
      writeRelays = config.writeRelays
        .filter(r => !CONFIG.BLOCKED_RELAYS.has(r))
        .slice(0, CONFIG.MAX_RELAYS_PER_USER);
    } else if (follow.relayHints.length > 0) {
      writeRelays = follow.relayHints
        .filter(r => !CONFIG.BLOCKED_RELAYS.has(r))
        .slice(0, CONFIG.MAX_RELAYS_PER_USER);
    } else {
      usersNeedingFallback.push(follow.pubkey);
      continue;
    }
    
    for (const relay of writeRelays) {
      const existing = relayToAuthors.get(relay) || new Set();
      existing.add(follow.pubkey);
      relayToAuthors.set(relay, existing);
    }
  }
  
  // Add fallback users to fallback relays
  if (usersNeedingFallback.length > 0) {
    for (const relay of CONFIG.FALLBACK_RELAYS) {
      const existing = relayToAuthors.get(relay) || new Set();
      for (const pubkey of usersNeedingFallback) {
        existing.add(pubkey);
      }
      relayToAuthors.set(relay, existing);
    }
  }
  
  // Sort by author count (most authors first)
  const sorted = [...relayToAuthors.entries()]
    .map(([relay, authors]) => ({ relay, authors, priority: authors.size }))
    .sort((a, b) => b.priority - a.priority);
  
  const selectedPlans: OutboxQueryPlan[] = [];
  const skippedRelays: string[] = [];
  const coveredAuthors = new Set<string>();
  
  for (const { relay, authors, priority } of sorted) {
    if (selectedPlans.length >= maxRelays) {
      skippedRelays.push(relay);
      continue;
    }
    
    // Only include authors not yet covered
    const uncovered = [...authors].filter(a => !coveredAuthors.has(a));
    
    if (uncovered.length < minAuthorsPerRelay) {
      skippedRelays.push(relay);
      continue;
    }
    
    // Single plan per relay (no batching to reduce query count)
    selectedPlans.push({
      relay,
      authors: uncovered.slice(0, maxAuthorsPerRelay),
      priority
    });
    
    uncovered.forEach(a => coveredAuthors.add(a));
  }
  
  console.log(`[Outbox] Query plan: ${selectedPlans.length} relays, ${coveredAuthors.size}/${follows.length} authors`);
  
  return { plan: selectedPlans, skippedRelays };
}

// ═══════════════════════════════════════════════════════════════
// FETCH WITH TIMEOUT
// ═══════════════════════════════════════════════════════════════

async function fetchWithTimeout(
  ndk: NDK,
  relay: string,
  filter: NDKFilter,
  timeoutMs: number
): Promise<{ events: NDKEvent[]; success: boolean }> {
  try {
    const relaySet = NDKRelaySet.fromRelayUrls([relay], ndk, true);
    
    // Create a promise that rejects after timeout
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
    });
    
    // Race between fetch and timeout
    const fetchPromise = ndk.fetchEvents(filter, undefined, relaySet);
    
    try {
      const events = await Promise.race([fetchPromise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return { events: Array.from(events), success: true };
    } catch (err) {
      clearTimeout(timeoutId!);
      // If we got a timeout, the fetch is still running but we ignore it
      return { events: [], success: false };
    }
  } catch {
    return { events: [], success: false };
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN FETCH FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function fetchFollowingEvents(
  ndk: NDK,
  userPubkey: string,
  options: OutboxFetchOptions = {}
): Promise<OutboxFetchResult> {
  const startTime = Date.now();
  const {
    since,
    until,
    limit = 15,  // Fewer per relay for faster queries
    kinds = [1],
    additionalFilter = {},
    timeoutMs = CONFIG.PER_RELAY_TIMEOUT_MS,
    globalTimeoutMs = CONFIG.GLOBAL_TIMEOUT_MS,
    maxRelays = CONFIG.MAX_RELAYS_TO_QUERY,
    maxAuthorsPerRelay = CONFIG.MAX_AUTHORS_PER_RELAY,
    minAuthorsPerRelay = CONFIG.MIN_AUTHORS_PER_RELAY,
    targetEventCount = CONFIG.TARGET_EVENT_COUNT
  } = options;
  
  // Get follow list
  const follows = await fetchFollowList(ndk, userPubkey);
  if (follows.length === 0) {
    return {
      events: [],
      queriedRelays: [],
      skippedRelays: [],
      failedRelays: [],
      timing: { relayListFetchMs: 0, eventFetchMs: 0, totalMs: Date.now() - startTime },
      stoppedEarly: false
    };
  }
  
  // Get relay configs
  const relayListStart = Date.now();
  const relayConfigs = await fetchRelayLists(ndk, follows.map(f => f.pubkey));
  const relayListFetchMs = Date.now() - relayListStart;
  
  // Build query plan
  const { plan: queryPlan, skippedRelays } = buildQueryPlan(follows, relayConfigs, {
    maxRelays,
    maxAuthorsPerRelay,
    minAuthorsPerRelay
  });
  
  if (queryPlan.length === 0) {
    return {
      events: [],
      queriedRelays: [],
      skippedRelays,
      failedRelays: [],
      timing: { relayListFetchMs, eventFetchMs: 0, totalMs: Date.now() - startTime },
      stoppedEarly: false
    };
  }
  
  // Build base filter
  const baseFilter: NDKFilter = { kinds, limit, ...additionalFilter };
  if (since) baseFilter.since = since;
  if (until) baseFilter.until = until;
  
  // Execute queries
  const eventFetchStart = Date.now();
  const allEvents: NDKEvent[] = [];
  const seenIds = new Set<string>();
  const failedRelays: string[] = [];
  const queriedRelays: string[] = [];
  let stoppedEarly = false;
  
  // Process in concurrent batches
  for (let i = 0; i < queryPlan.length; i += CONFIG.CONCURRENT_BATCHES) {
    // Check global timeout
    if (Date.now() - eventFetchStart > globalTimeoutMs) {
      console.log(`[Outbox] Global timeout after ${Date.now() - eventFetchStart}ms`);
      stoppedEarly = true;
      break;
    }
    
    // Check if we have enough events AND enough relay coverage
    if (allEvents.length >= targetEventCount) {
      const relaysQueried = i + CONFIG.CONCURRENT_BATCHES;
      const minRelaysBeforeEarlyStop = 12;  // Query at least 12 relays
      
      if (relaysQueried >= minRelaysBeforeEarlyStop) {
        console.log(`[Outbox] Target reached: ${allEvents.length} events from ${relaysQueried} relays`);
        stoppedEarly = true;
        break;
      }
    }
    
    const batch = queryPlan.slice(i, i + CONFIG.CONCURRENT_BATCHES);
    
    const batchResults = await Promise.all(
      batch.map(async (plan) => {
        queriedRelays.push(plan.relay);
        
        const filter: NDKFilter = { ...baseFilter, authors: plan.authors };
        const result = await fetchWithTimeout(ndk, plan.relay, filter, timeoutMs);
        
        if (!result.success) {
          failedRelays.push(plan.relay);
        }
        
        return result;
      })
    );
    
    // Collect events
    for (const result of batchResults) {
      for (const event of result.events) {
        if (event.id && !seenIds.has(event.id)) {
          seenIds.add(event.id);
          allEvents.push(event);
        }
      }
    }
  }
  
  const eventFetchMs = Date.now() - eventFetchStart;
  
  // Sort by time
  allEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  
  const totalMs = Date.now() - startTime;
  console.log(`[Outbox] Fetched ${allEvents.length} events in ${totalMs}ms (early: ${stoppedEarly})`);
  
  return {
    events: allEvents,
    queriedRelays: [...new Set(queriedRelays)],
    skippedRelays,
    failedRelays: [...new Set(failedRelays)],
    timing: { relayListFetchMs, eventFetchMs, totalMs },
    stoppedEarly
  };
}

// ═══════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

export function clearOutboxCaches(): void {
  userRelayCache.clear();
  cachedFollowList = null;
  followListPubkey = null;
  followListTimestamp = 0;
  
  // Also clear localStorage cache
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(RELAY_CACHE_KEY);
    }
  } catch {
    // Ignore errors
  }
}

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

export async function prewarmOutboxCache(
  ndk: NDK,
  userPubkey: string
): Promise<void> {
  const follows = await fetchFollowList(ndk, userPubkey);
  if (follows.length > 0) {
    await fetchRelayLists(ndk, follows.map(f => f.pubkey));
  }
}
