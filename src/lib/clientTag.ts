/**
 * NIP-89 Client Tag Parser and Handler Info Resolver
 * 
 * NIP-89 defines a client tag on events as:
 * ["client", <name>, <handler-address>, <relay-hint?>]
 * 
 * Where <handler-address> is an "a" coordinate pointing to a kind:31990 handler info event.
 * 
 * This module provides:
 * - Parsing of client tags (both simplified and full NIP-89 format)
 * - Optional enrichment by fetching kind:31990 handler info events
 * - Caching of handler info in memory and localStorage
 * 
 * @see https://github.com/nostr-protocol/nips/blob/master/89.md
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

export interface ClientTagInfo {
  name: string;
  handlerAddress?: string; // "31990:<pubkey>:<d-tag>"
  relayHint?: string;
}

export interface HandlerInfo {
  name: string;
  picture?: string;
  about?: string;
  pubkey: string;
  fetchedAt: number;
}

const HANDLER_CACHE_KEY = 'nip89_handler_cache_v1';
const HANDLER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache for handler info
const handlerMemoryCache = new Map<string, HandlerInfo>();

/**
 * Parse the client tag from an event's tags array.
 * Supports both simplified format ["client", "name"] and full NIP-89 format
 * ["client", "name", "31990:pubkey:d", "wss://relay"].
 * 
 * @param tags - The event's tags array
 * @returns ClientTagInfo if a valid client tag is found, null otherwise
 */
export function parseClientTag(tags: string[][]): ClientTagInfo | null {
  try {
    if (!Array.isArray(tags)) return null;
    
    // Find the first client tag
    const clientTag = tags.find(tag => 
      Array.isArray(tag) && 
      tag.length >= 2 && 
      tag[0] === 'client'
    );
    
    if (!clientTag) return null;
    
    const name = clientTag[1];
    
    // If name is empty or just whitespace, return null
    if (!name || !name.trim()) return null;
    
    const result: ClientTagInfo = {
      name: name.trim()
    };
    
    // Check for handler address (tag[2])
    if (clientTag.length >= 3 && clientTag[2]) {
      const handlerAddr = clientTag[2].trim();
      // Validate it looks like a handler address: "31990:<pubkey>:<d-tag>"
      if (handlerAddr.startsWith('31990:') && handlerAddr.split(':').length >= 3) {
        result.handlerAddress = handlerAddr;
      }
    }
    
    // Check for relay hint (tag[3])
    if (clientTag.length >= 4 && clientTag[3]) {
      const relayHint = clientTag[3].trim();
      // Validate it looks like a websocket URL
      if (relayHint.startsWith('wss://') || relayHint.startsWith('ws://')) {
        result.relayHint = relayHint;
      }
    }
    
    return result;
  } catch {
    // Fail silently on malformed tags
    return null;
  }
}

/**
 * Load handler cache from localStorage
 */
function loadHandlerCache(): Map<string, HandlerInfo> {
  try {
    const stored = localStorage.getItem(HANDLER_CACHE_KEY);
    if (!stored) return new Map();
    
    const parsed = JSON.parse(stored);
    const now = Date.now();
    const cache = new Map<string, HandlerInfo>();
    
    // Filter out expired entries
    for (const [key, value] of Object.entries(parsed)) {
      const info = value as HandlerInfo;
      if (now - info.fetchedAt < HANDLER_CACHE_TTL) {
        cache.set(key, info);
      }
    }
    
    return cache;
  } catch {
    return new Map();
  }
}

/**
 * Save handler cache to localStorage
 */
function saveHandlerCache(cache: Map<string, HandlerInfo>): void {
  try {
    const obj = Object.fromEntries(cache);
    localStorage.setItem(HANDLER_CACHE_KEY, JSON.stringify(obj));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Parse the handler address to extract kind, pubkey, and d-tag
 */
function parseHandlerAddress(address: string): { kind: number; pubkey: string; dTag: string } | null {
  try {
    const parts = address.split(':');
    if (parts.length < 3) return null;
    
    const kind = parseInt(parts[0], 10);
    if (isNaN(kind) || kind !== 31990) return null;
    
    const pubkey = parts[1];
    if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) return null;
    
    // d-tag can contain colons, so join remaining parts
    const dTag = parts.slice(2).join(':');
    if (!dTag) return null;
    
    return { kind, pubkey, dTag };
  } catch {
    return null;
  }
}

/**
 * Fetch handler info from a kind:31990 event.
 * Uses relay hint if provided, otherwise uses NDK's default relays.
 * 
 * @param ndk - NDK instance
 * @param handlerAddress - Handler address like "31990:pubkey:d-tag"
 * @param relayHint - Optional relay hint to prioritize
 * @returns HandlerInfo if found, null otherwise
 */
export async function fetchHandlerInfo(
  ndk: NDK,
  handlerAddress: string,
  relayHint?: string
): Promise<HandlerInfo | null> {
  // Check memory cache first
  if (handlerMemoryCache.has(handlerAddress)) {
    return handlerMemoryCache.get(handlerAddress)!;
  }
  
  // Load from localStorage cache
  const storageCache = loadHandlerCache();
  if (storageCache.has(handlerAddress)) {
    const cached = storageCache.get(handlerAddress)!;
    handlerMemoryCache.set(handlerAddress, cached);
    return cached;
  }
  
  // Parse the handler address
  const parsed = parseHandlerAddress(handlerAddress);
  if (!parsed) return null;
  
  try {
    // Build filter for kind:31990 event
    const filter = {
      kinds: [31990],
      authors: [parsed.pubkey],
      '#d': [parsed.dTag]
    };

    // Timeout (in milliseconds) for fetching the handler event
    const HANDLER_FETCH_TIMEOUT_MS = 10000;
    
    // Fetch the handler event
    let handlerEvent: NDKEvent | null = null;
    
    // Fetch handler event from default relays with a timeout
    // Note: relay hint is parsed but not used for relay selection to keep implementation simple
    const events = await new Promise<Set<NDKEvent>>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Handler info fetch timed out'));
      }, HANDLER_FETCH_TIMEOUT_MS);

      ndk.fetchEvents(filter, { closeOnEose: true })
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
    if (events.size > 0) {
      handlerEvent = Array.from(events)[0] as NDKEvent;
    }
    
    if (!handlerEvent) return null;
    
    // Parse the handler event content
    let handlerInfo: HandlerInfo = {
      name: parsed.dTag, // Default to d-tag as name
      pubkey: parsed.pubkey,
      fetchedAt: Date.now()
    };
    
    // Try to parse content as kind:0-style metadata JSON
    if (handlerEvent.content) {
      try {
        const metadata = JSON.parse(handlerEvent.content);
        // Prefer display_name over name if both are present
        const preferredName = metadata.display_name ?? metadata.name;
        if (preferredName) handlerInfo.name = preferredName;
        if (metadata.picture) handlerInfo.picture = metadata.picture;
        if (metadata.about) handlerInfo.about = metadata.about;
      } catch {
        // Content is not JSON, use default name
      }
    }
    
    // Cache the result
    handlerMemoryCache.set(handlerAddress, handlerInfo);
    storageCache.set(handlerAddress, handlerInfo);
    saveHandlerCache(storageCache);
    
    return handlerInfo;
  } catch {
    return null;
  }
}

/**
 * Get the display name for a client tag, optionally enriching with handler info.
 * 
 * @param clientInfo - Parsed client tag info
 * @param ndk - Optional NDK instance for enrichment
 * @returns Promise resolving to display name
 */
export async function getClientDisplayName(
  clientInfo: ClientTagInfo,
  ndk?: NDK
): Promise<string> {
  // If no handler address or no NDK, just return the tag name
  if (!clientInfo.handlerAddress || !ndk) {
    return clientInfo.name;
  }
  
  // Try to fetch enriched handler info
  const handlerInfo = await fetchHandlerInfo(
    ndk,
    clientInfo.handlerAddress,
    clientInfo.relayHint
  );
  
  return handlerInfo?.name || clientInfo.name;
}

/**
 * Clear the handler cache (useful for testing or cache invalidation)
 */
export function clearHandlerCache(): void {
  handlerMemoryCache.clear();
  if (typeof window !== 'undefined' && 'localStorage' in window) {
    try {
      localStorage.removeItem(HANDLER_CACHE_KEY);
    } catch {
      // Ignore localStorage errors
    }
  }
}

