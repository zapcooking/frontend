/**
 * NIP-45 COUNT Query Utility
 * 
 * Provides fast count queries using:
 * 1. Server-side API cache (fastest)
 * 2. NIP-45 COUNT verb (fast)
 * 3. Falls back to full event fetch for relays that don't support it
 */

import { browser } from '$app/environment';
import { standardRelays } from './consts';

export interface CountResult {
  count: number;
  approximate?: boolean;
  source: 'api' | 'nip45' | 'fallback' | 'cache';
}

export interface CountFilter {
  kinds?: number[];
  authors?: string[];
  '#e'?: string[];
  '#a'?: string[];
  '#p'?: string[];
  '#A'?: string[];
  since?: number;
  until?: number;
}

export interface EngagementCounts {
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  zaps: number | null;
  source?: string;
}

// Cache for count results (short TTL since counts change)
const countCache = new Map<string, { result: CountResult; timestamp: number }>();
const COUNT_CACHE_TTL = 60 * 1000; // 1 minute cache for counts

// Track relays that support NIP-45
const nip45SupportedRelays = new Set<string>();
const nip45UnsupportedRelays = new Set<string>();

// Relays known to support NIP-45 COUNT - prioritize fastest/most reliable
const KNOWN_NIP45_RELAYS = [
  'wss://relay.damus.io',      // 394ms - fast and reliable
  'wss://nos.lol',              // 342ms - fastest
  'wss://relay.nostr.band'      // 514ms - slower but reliable
  // Note: nostr.wine (305ms) removed as it's in blocked relays list
];

// Server API configuration
const USE_SERVER_API = true; // Toggle server API usage
const API_TIMEOUT = 3000; // 3 seconds for API calls (increased for batch endpoint)

/**
 * Deterministically stringify a value by sorting object keys.
 * This ensures that semantically equivalent filters produce the same cache key
 * even if their object key insertion order differs.
 */
function stableStringify(value: unknown): string {
  function normalize(val: unknown): unknown {
    if (val === null || typeof val !== 'object') {
      return val;
    }

    if (Array.isArray(val)) {
      // Preserve array order; just normalize elements.
      return val.map((item) => normalize(item));
    }

    const obj = val as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const normalizedObj: Record<string, unknown> = {};

    for (const key of sortedKeys) {
      normalizedObj[key] = normalize(obj[key]);
    }

    return normalizedObj;
  }

  return JSON.stringify(normalize(value));
}

/**
 * Generate a cache key from a filter
 */
function getCacheKey(filter: CountFilter): string {
  return stableStringify(filter);
}

// Track failed relay connections to avoid retrying too often
const failedRelays = new Map<string, number>(); // relay -> timestamp of last failure
const RELAY_RETRY_DELAY = 60000; // 1 minute before retrying failed relay

/**
 * Send a NIP-45 COUNT query to a relay
 */
async function sendCountQuery(
  relayUrl: string,
  filter: CountFilter,
  timeout = 5000
): Promise<CountResult | null> {
  if (!browser) return null;
  
  // Skip relays known not to support NIP-45
  if (nip45UnsupportedRelays.has(relayUrl)) {
    return null;
  }

  // Skip recently failed relays
  const lastFailure = failedRelays.get(relayUrl);
  if (lastFailure && Date.now() - lastFailure < RELAY_RETRY_DELAY) {
    return null;
  }

  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let resolved = false;
    const subId = `count_${Math.random().toString(36).slice(2, 10)}`;

    const cleanup = () => {
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          // Ignore close errors
        }
        ws = null;
      }
    };

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(null);
      }
    }, timeout);

    try {
      ws = new WebSocket(relayUrl);

      ws.onopen = () => {
        if (resolved || !ws) return;
        try {
          // Send COUNT request: ["COUNT", <subscription_id>, <filter>]
          const message = JSON.stringify(['COUNT', subId, filter]);
          ws.send(message);
        } catch {
          resolved = true;
          clearTimeout(timeoutId);
          cleanup();
          resolve(null);
        }
      };

      ws.onmessage = (event) => {
        if (resolved) return;

        try {
          const data = JSON.parse(event.data);
          
          // COUNT response: ["COUNT", <subscription_id>, {"count": <number>, "approximate"?: boolean}]
          if (data[0] === 'COUNT' && data[1] === subId && typeof data[2]?.count === 'number') {
            resolved = true;
            clearTimeout(timeoutId);
            nip45SupportedRelays.add(relayUrl);
            failedRelays.delete(relayUrl); // Clear failure state on success
            cleanup();
            resolve({
              count: data[2].count,
              approximate: data[2].approximate,
              source: 'nip45'
            });
          }
          // CLOSED response means relay doesn't support COUNT or rejected the request
          else if (data[0] === 'CLOSED' && data[1] === subId) {
            resolved = true;
            clearTimeout(timeoutId);
            nip45UnsupportedRelays.add(relayUrl);
            cleanup();
            resolve(null);
          }
          // NOTICE with error about COUNT
          else if (data[0] === 'NOTICE' && typeof data[1] === 'string' && 
                   data[1].toLowerCase().includes('count')) {
            resolved = true;
            clearTimeout(timeoutId);
            nip45UnsupportedRelays.add(relayUrl);
            cleanup();
            resolve(null);
          }
        } catch {
          // Parse error, ignore
        }
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          failedRelays.set(relayUrl, Date.now()); // Mark relay as failed
          cleanup();
          resolve(null);
        }
      };

      ws.onclose = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(null);
        }
      };
    } catch {
      resolved = true;
      clearTimeout(timeoutId);
      failedRelays.set(relayUrl, Date.now());
      resolve(null);
    }
  });
}

/**
 * Fetch count from multiple relays using NIP-45
 * Returns the first successful result
 */
export async function fetchCount(
  filter: CountFilter,
  options: {
    relays?: string[];
    timeout?: number;
    useCache?: boolean;
  } = {}
): Promise<CountResult | null> {
  if (!browser) return null;

  // Use only 2 best relays for COUNT queries (reduces fan-out significantly)
  // Server API handles batching, so client-side COUNT queries should be minimal
  const { 
    relays = KNOWN_NIP45_RELAYS.slice(0, 2), // Only 2 relays instead of 6
    timeout = 3000,
    useCache = true
  } = options;

  // Check cache first
  if (useCache) {
    const cacheKey = getCacheKey(filter);
    const cached = countCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < COUNT_CACHE_TTL) {
      return { ...cached.result, source: 'cache' };
    }
  }

  // Try relays known to support NIP-45 first
  const sortedRelays = relays.sort((a, b) => {
    const aSupported = nip45SupportedRelays.has(a) ? -1 : nip45UnsupportedRelays.has(a) ? 1 : 0;
    const bSupported = nip45SupportedRelays.has(b) ? -1 : nip45UnsupportedRelays.has(b) ? 1 : 0;
    return aSupported - bSupported;
  });

  // Race only 2 relays for fastest response (reduced from 3 to limit fan-out)
  const results = await Promise.all(
    sortedRelays.slice(0, 2).map(relay => sendCountQuery(relay, filter, timeout))
  );

  const successResult = results.find(r => r !== null);
  
  if (successResult && useCache) {
    const cacheKey = getCacheKey(filter);
    countCache.set(cacheKey, { result: successResult, timestamp: Date.now() });
  }

  return successResult;
}

/**
 * Batch fetch counts for multiple event IDs
 * More efficient than individual queries
 */
export async function batchFetchCounts(
  eventIds: string[],
  kinds: number[] = [7, 1, 6, 9735],
  options: { relays?: string[]; timeout?: number } = {}
): Promise<Map<string, Partial<Record<number, number>>>> {
  if (!browser || eventIds.length === 0) {
    return new Map();
  }

  const results = new Map<string, Partial<Record<number, number>>>();
  
  // Initialize results
  eventIds.forEach(id => results.set(id, {}));

  // For each kind, fetch counts
  await Promise.all(
    kinds.map(async (kind) => {
      // Try to get counts for all events at once per kind
      // Note: Some relays may not support multiple '#e' values efficiently
      for (const eventId of eventIds) {
        const filter: CountFilter = {
          kinds: [kind],
          '#e': [eventId]
        };

        const count = await fetchCount(filter, options);
        if (count) {
          const existing = results.get(eventId) || {};
          existing[kind] = count.count;
          results.set(eventId, existing);
        }
      }
    })
  );

  return results;
}

/**
 * Fetch engagement counts from server API
 */
async function fetchFromServerAPI(eventId: string): Promise<EngagementCounts | null> {
  if (!browser || !USE_SERVER_API) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    const response = await fetch(`/api/counts/${eventId}`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      reactions: data.reactions,
      comments: data.comments,
      reposts: data.reposts,
      zaps: data.zaps,
      source: data.source || 'api'
    };
  } catch {
    // API failed (timeout, network error, etc.)
    return null;
  }
}

/**
 * Batch fetch engagement counts from server API
 */
export async function batchFetchFromServerAPI(
  eventIds: string[]
): Promise<Map<string, EngagementCounts>> {
  const results = new Map<string, EngagementCounts>();
  
  if (!browser || !USE_SERVER_API || eventIds.length === 0) {
    return results;
  }

  try {
    const controller = new AbortController();
    // Longer timeout for batch endpoint since it handles multiple events
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds for batch

    const response = await fetch('/api/counts/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventIds }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return results;
    }

    const data = await response.json();
    
    if (data.counts) {
      for (const [id, counts] of Object.entries(data.counts)) {
        results.set(id, counts as EngagementCounts);
      }
    }
  } catch {
    // API failed
  }

  return results;
}

/**
 * Fallback: Fetch full events and count them (when NIP-45 fails)
 * Uses NDK-style WebSocket subscription with REQ
 */
async function fetchCountViaFullEvents(
  filter: CountFilter,
  relayUrl: string,
  timeout = 5000
): Promise<number> {
  // Skip recently failed relays
  const lastFailure = failedRelays.get(relayUrl);
  if (lastFailure && Date.now() - lastFailure < RELAY_RETRY_DELAY) {
    return 0;
  }

  return new Promise((resolve) => {
    let count = 0;
    let resolved = false;
    let ws: WebSocket | null = null;
    const subId = `req_${Math.random().toString(36).slice(2, 10)}`;

    const cleanup = () => {
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(['CLOSE', subId]));
          }
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          // Ignore close errors
        }
        ws = null;
      }
    };
    
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(count);
      }
    }, timeout);

    try {
      ws = new WebSocket(relayUrl);

      ws.onopen = () => {
        if (resolved || !ws) return;
        try {
          // Send REQ (standard NIP-01 subscription)
          ws.send(JSON.stringify(['REQ', subId, filter]));
        } catch {
          resolved = true;
          clearTimeout(timeoutId);
          cleanup();
          resolve(count);
        }
      };

      ws.onmessage = (event) => {
        if (resolved) return;
        
        try {
          const data = JSON.parse(event.data);
          
          // EVENT response - count it
          if (data[0] === 'EVENT' && data[1] === subId) {
            count++;
          }
          // EOSE - end of stored events
          else if (data[0] === 'EOSE' && data[1] === subId) {
            resolved = true;
            clearTimeout(timeoutId);
            failedRelays.delete(relayUrl); // Clear failure on success
            cleanup();
            resolve(count);
          }
        } catch {
          // Parse error
        }
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          failedRelays.set(relayUrl, Date.now());
          cleanup();
          resolve(count);
        }
      };

      ws.onclose = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(count);
        }
      };
    } catch {
      resolved = true;
      clearTimeout(timeoutId);
      failedRelays.set(relayUrl, Date.now());
      resolve(count);
    }
  });
}

/**
 * Get count with automatic fallback to full event fetch
 */
async function getCountWithFallback(
  filter: CountFilter,
  options: { relays?: string[]; timeout?: number } = {}
): Promise<CountResult> {
  // Use only 2 best relays for COUNT queries (reduces fan-out)
  const { 
    relays = KNOWN_NIP45_RELAYS.slice(0, 2), // Only 2 relays
    timeout = 3000 
  } = options;

  // Try NIP-45 COUNT first
  const countResult = await fetchCount(filter, { ...options, relays, timeout });
  
  if (countResult) {
    return countResult;
  }

  // FALLBACK: Fetch full events and count them
  // Try first available relay
  for (const relay of relays.slice(0, 2)) {
    try {
      const count = await fetchCountViaFullEvents(filter, relay, timeout);
      return {
        count,
        source: 'fallback'
      };
    } catch {
      // Try next relay
    }
  }

  // All failed, return 0
  return { count: 0, source: 'fallback' };
}

/**
 * Convenience function to get engagement counts for a regular event (kind 1, etc.)
 * Uses #e tag for filtering
 * Tries: 1) Server API, 2) NIP-45 COUNT, 3) Full event fetch
 */
export async function getEngagementCounts(
  eventId: string,
  options: { relays?: string[]; timeout?: number; skipApi?: boolean } = {}
): Promise<EngagementCounts | null> {
  if (!browser) return null;

  // FAST PATH: Try server API first (has server-side caching)
  if (!options.skipApi) {
    const apiResult = await fetchFromServerAPI(eventId);
    if (apiResult) {
      return apiResult;
    }
  }

  // FALLBACK PATH: NIP-45 COUNT with fallback to full event fetch
  // Uses #e tag for regular events
  const [reactions, comments, reposts, zaps] = await Promise.all([
    getCountWithFallback({ kinds: [7], '#e': [eventId] }, options),
    getCountWithFallback({ kinds: [1], '#e': [eventId] }, options),
    getCountWithFallback({ kinds: [6], '#e': [eventId] }, options),
    getCountWithFallback({ kinds: [9735], '#e': [eventId] }, options)
  ]);

  // Determine source (nip45 if any succeeded via nip45, otherwise fallback)
  const source = [reactions, comments, reposts, zaps].some(r => r.source === 'nip45') 
    ? 'nip45' 
    : 'fallback';

  return {
    reactions: reactions.count,
    comments: comments.count,
    reposts: reposts.count,
    zaps: zaps.count,
    source
  };
}

/**
 * Get engagement counts for addressable events (recipes - kind 30023)
 * Uses #a tag for reactions/reposts/zaps per NIP-25 spec
 */
export async function getAddressableEngagementCounts(
  kind: number,
  pubkey: string,
  dTag: string,
  options: { relays?: string[]; timeout?: number } = {}
): Promise<EngagementCounts | null> {
  if (!browser) return null;

  const addressTag = `${kind}:${pubkey}:${dTag}`;
  
  // Fetch all engagement types using #a tag (correct for addressable events)
  const [reactions, nip22Comments, legacyComments, reposts, zaps] = await Promise.all([
    // Reactions use #a for addressable events
    getCountWithFallback({ kinds: [7], '#a': [addressTag] }, options),
    // NIP-22 comments use #A (uppercase) for root address
    getCountWithFallback({ kinds: [1111], '#A': [addressTag] }, options),
    // Legacy comments might use #a
    getCountWithFallback({ kinds: [1], '#a': [addressTag] }, options),
    // Reposts use #a for addressable events
    getCountWithFallback({ kinds: [6], '#a': [addressTag] }, options),
    // Zaps use #a for addressable events  
    getCountWithFallback({ kinds: [9735], '#a': [addressTag] }, options)
  ]);

  // Combine NIP-22 and legacy comment counts
  const totalComments = nip22Comments.count + legacyComments.count;

  const source = [reactions, nip22Comments, reposts, zaps].some(r => r.source === 'nip45') 
    ? 'nip45' 
    : 'fallback';

  return {
    reactions: reactions.count,
    comments: totalComments,
    reposts: reposts.count,
    zaps: zaps.count,
    source
  };
}

/**
 * Get comment count for addressable events (recipes)
 */
export async function getAddressableCommentCount(
  kind: number,
  pubkey: string,
  dTag: string,
  options: { relays?: string[]; timeout?: number } = {}
): Promise<number | null> {
  if (!browser) return null;

  const addressTag = `${kind}:${pubkey}:${dTag}`;
  
  // Try NIP-22 comments (kind 1111) first
  const nip22Count = await fetchCount(
    { kinds: [1111], '#A': [addressTag] },
    options
  );
  
  if (nip22Count) {
    return nip22Count.count;
  }

  // Fall back to kind 1 replies with #a tag
  const legacyCount = await fetchCount(
    { kinds: [1], '#a': [addressTag] },
    options
  );

  return legacyCount?.count ?? null;
}

/**
 * Clear the count cache
 */
export function clearCountCache(): void {
  countCache.clear();
}

/**
 * Get stats about NIP-45 relay support
 */
export function getNip45Stats(): {
  supported: string[];
  unsupported: string[];
} {
  return {
    supported: Array.from(nip45SupportedRelays),
    unsupported: Array.from(nip45UnsupportedRelays)
  };
}
