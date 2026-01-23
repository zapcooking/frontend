import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// In-memory cache with TTL (for edge/serverless)
// In production, consider using Cloudflare KV or Redis
const countCache = new Map<string, { data: CountData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CountData {
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  zaps: number | null;
  source: 'nip45' | 'cache';
  timestamp: number;
}

// Relays to query for counts (prioritize those known to support NIP-45)
const COUNT_RELAYS = [
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.damus.io',
  'wss://relay.primal.net'
];

/**
 * Send a NIP-45 COUNT query to a relay (server-side)
 */
async function sendCountQuery(
  relayUrl: string,
  filter: Record<string, unknown>,
  timeout = 4000
): Promise<number | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const subId = `srv_${Math.random().toString(36).slice(2, 10)}`;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, timeout);

    try {
      // Use native WebSocket (available in Cloudflare Workers and Node 18+)
      const ws = new WebSocket(relayUrl);

      ws.addEventListener('open', () => {
        const message = JSON.stringify(['COUNT', subId, filter]);
        ws.send(message);
      });

      ws.addEventListener('message', (event) => {
        if (resolved) return;

        try {
          const data = JSON.parse(event.data as string);
          
          if (data[0] === 'COUNT' && data[1] === subId && typeof data[2]?.count === 'number') {
            resolved = true;
            clearTimeout(timeoutId);
            ws.close();
            resolve(data[2].count);
          } else if (data[0] === 'CLOSED' && data[1] === subId) {
            resolved = true;
            clearTimeout(timeoutId);
            ws.close();
            resolve(null);
          }
        } catch {
          // Parse error, ignore
        }
      });

      ws.addEventListener('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(null);
        }
      });

      ws.addEventListener('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(null);
        }
      });
    } catch {
      resolved = true;
      clearTimeout(timeoutId);
      resolve(null);
    }
  });
}

/**
 * Fallback: Fetch full events and count them (when NIP-45 fails)
 */
async function fetchCountViaFullEvents(
  relayUrl: string,
  filter: Record<string, unknown>,
  timeout = 4000
): Promise<number> {
  return new Promise((resolve) => {
    let count = 0;
    let resolved = false;
    const subId = `req_${Math.random().toString(36).slice(2, 10)}`;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(count);
      }
    }, timeout);

    try {
      const ws = new WebSocket(relayUrl);

      ws.addEventListener('open', () => {
        // Send REQ (standard NIP-01 subscription)
        ws.send(JSON.stringify(['REQ', subId, filter]));
      });

      ws.addEventListener('message', (event) => {
        if (resolved) return;

        try {
          const data = JSON.parse(event.data as string);
          
          // EVENT response - count it
          if (data[0] === 'EVENT' && data[1] === subId) {
            count++;
          }
          // EOSE - end of stored events
          else if (data[0] === 'EOSE' && data[1] === subId) {
            resolved = true;
            clearTimeout(timeoutId);
            ws.send(JSON.stringify(['CLOSE', subId]));
            ws.close();
            resolve(count);
          }
        } catch {
          // Parse error
        }
      });

      ws.addEventListener('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(count);
        }
      });

      ws.addEventListener('close', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(count);
        }
      });
    } catch {
      resolved = true;
      clearTimeout(timeoutId);
      resolve(count);
    }
  });
}

/**
 * Try to get a count from any relay (NIP-45 first, then fallback to full fetch)
 */
async function getCountFromRelays(filter: Record<string, unknown>): Promise<number | null> {
  // First try NIP-45 COUNT on all relays
  const countResults = await Promise.all(
    COUNT_RELAYS.map(relay => sendCountQuery(relay, filter, 3000))
  );
  
  const nip45Result = countResults.find(r => r !== null);
  if (nip45Result !== null && nip45Result !== undefined) {
    return nip45Result;
  }

  // FALLBACK: Fetch full events and count them
  // Try first two relays
  for (const relay of COUNT_RELAYS.slice(0, 2)) {
    try {
      const count = await fetchCountViaFullEvents(relay, filter, 4000);
      return count;
    } catch {
      // Try next relay
    }
  }

  return null;
}

/**
 * Fetch all engagement counts for an event
 */
async function fetchEngagementCounts(eventId: string): Promise<CountData> {
  // Use Promise.allSettled to handle individual failures gracefully
  const results = await Promise.allSettled([
    getCountFromRelays({ kinds: [7], '#e': [eventId] }),
    getCountFromRelays({ kinds: [1], '#e': [eventId] }),
    getCountFromRelays({ kinds: [6], '#e': [eventId] }),
    getCountFromRelays({ kinds: [9735], '#e': [eventId] })
  ]);

  // Extract results, defaulting to null on failure
  const reactions = results[0].status === 'fulfilled' ? results[0].value : null;
  const comments = results[1].status === 'fulfilled' ? results[1].value : null;
  const reposts = results[2].status === 'fulfilled' ? results[2].value : null;
  const zaps = results[3].status === 'fulfilled' ? results[3].value : null;

  return {
    reactions,
    comments,
    reposts,
    zaps,
    source: 'nip45',
    timestamp: Date.now()
  };
}

export const GET: RequestHandler = async ({ params, url, platform }) => {
  const { eventId } = params;

  const isValidNostrEventId = typeof eventId === 'string' && /^[a-f0-9]{64}$/i.test(eventId);
  if (!isValidNostrEventId) {
    return json({ error: 'Invalid event ID' }, { status: 400 });
  }

  // Check for Cloudflare KV cache first (if available)
  const kvCache = platform?.env?.COUNT_CACHE;
  const cacheKey = `counts:${eventId}`;

  // Check in-memory cache
  const cached = countCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return json({
      ...cached.data,
      source: 'cache'
    }, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        'X-Cache': 'HIT'
      }
    });
  }

  // Check KV cache (Cloudflare)
  if (kvCache) {
    try {
      const kvData = await kvCache.get(cacheKey, 'json');
      if (kvData) {
        // Also update in-memory cache
        countCache.set(cacheKey, { data: kvData as CountData, timestamp: Date.now() });
        return json({
          ...kvData,
          source: 'cache'
        }, {
          headers: {
            'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
            'X-Cache': 'HIT-KV'
          }
        });
      }
    } catch (err) {
      // KV read error, continue to fetch from relays
      console.error('[CountCache] KV read error:', err);
    }
  }

  try {
    // Fetch fresh counts from relays
    const counts = await fetchEngagementCounts(eventId);

    // Update in-memory cache
    countCache.set(cacheKey, { data: counts, timestamp: Date.now() });

    // Update KV cache (if available)
    if (kvCache) {
      try {
        await kvCache.put(cacheKey, JSON.stringify(counts), {
          expirationTtl: 300 // 5 minutes in KV
        });
      } catch (err) {
        // KV write error, non-fatal
        console.error('[CountCache] KV write error:', err);
      }
    }

    // Return success even if some counts are null (partial data is better than error)
    return json(counts, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        'X-Cache': 'MISS'
      }
    });
  } catch (err) {
    console.error('[Counts API] Error fetching counts:', err);
    // Return 200 with null counts instead of 500 - allows client to handle gracefully
    return json({ 
      reactions: null,
      comments: null,
      reposts: null,
      zaps: null,
      source: 'error',
      timestamp: Date.now()
    }, { 
      status: 200, // Changed from 500 to 200 - partial data is acceptable
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
  }
};

// Clean up old cache entries periodically
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of countCache.entries()) {
      if (now - value.timestamp > CACHE_TTL * 2) {
        countCache.delete(key);
      }
    }
  }, CACHE_TTL);
}
