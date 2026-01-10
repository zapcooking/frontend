import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// In-memory cache with TTL
const countCache = new Map<string, { data: CountData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_BATCH_SIZE = 50;

interface CountData {
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  zaps: number | null;
}

interface BatchResponse {
  counts: Record<string, CountData>;
  cached: string[];
  fetched: string[];
  errors: string[];
}

// Relays to query for counts
const COUNT_RELAYS = [
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.damus.io'
];

// Validate that eventId is exactly 64 hex characters
const EVENT_ID_PATTERN = /^[a-f0-9]{64}$/i;
function isValidEventId(id: unknown): id is string {
  return typeof id === 'string' && EVENT_ID_PATTERN.test(id);
}

/**
 * Send a NIP-45 COUNT query to a relay
 */
async function sendCountQuery(
  relayUrl: string,
  filter: Record<string, unknown>,
  timeout = 3000
): Promise<number | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const subId = `batch_${Math.random().toString(36).slice(2, 10)}`;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, timeout);

    try {
      const ws = new WebSocket(relayUrl);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify(['COUNT', subId, filter]));
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
          // Parse error
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
 * Fallback: Fetch full events and count them
 */
async function fetchCountViaFullEvents(
  relayUrl: string,
  filter: Record<string, unknown>,
  timeout = 3000
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
        ws.send(JSON.stringify(['REQ', subId, filter]));
      });

      ws.addEventListener('message', (event) => {
        if (resolved) return;

        try {
          const data = JSON.parse(event.data as string);
          
          if (data[0] === 'EVENT' && data[1] === subId) {
            count++;
          } else if (data[0] === 'EOSE' && data[1] === subId) {
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

async function getCountFromRelays(filter: Record<string, unknown>): Promise<number | null> {
  // Try NIP-45 COUNT first
  const results = await Promise.all(
    COUNT_RELAYS.slice(0, 2).map(relay => sendCountQuery(relay, filter))
  );
  
  const nip45Result = results.find(r => r !== null);
  if (nip45Result !== null && nip45Result !== undefined) {
    return nip45Result;
  }

  // FALLBACK: Fetch full events and count
  try {
    return await fetchCountViaFullEvents(COUNT_RELAYS[0], filter, 3000);
  } catch {
    return null;
  }
}

async function fetchCountsForEvent(eventId: string): Promise<CountData> {
  const [reactions, comments, reposts, zaps] = await Promise.all([
    getCountFromRelays({ kinds: [7], '#e': [eventId] }),
    getCountFromRelays({ kinds: [1], '#e': [eventId] }),
    getCountFromRelays({ kinds: [6], '#e': [eventId] }),
    getCountFromRelays({ kinds: [9735], '#e': [eventId] })
  ]);

  return { reactions, comments, reposts, zaps };
}

export const POST: RequestHandler = async ({ request, platform }) => {
  let body: { eventIds?: string[] };
  
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { eventIds } = body;

  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return json({ error: 'eventIds array is required' }, { status: 400 });
  }

  if (eventIds.length > MAX_BATCH_SIZE) {
    return json({ error: `Maximum batch size is ${MAX_BATCH_SIZE}` }, { status: 400 });
  }

  // Validate event IDs
  const validIds = eventIds.filter(isValidEventId);
  if (validIds.length === 0) {
    return json({ error: 'No valid event IDs provided' }, { status: 400 });
  }

  const kvCache = platform?.env?.COUNT_CACHE;
  const response: BatchResponse = {
    counts: {},
    cached: [],
    fetched: [],
    errors: []
  };

  const toFetch: string[] = [];

  // Check cache for each event
  for (const eventId of validIds) {
    const cacheKey = `counts:${eventId}`;
    
    // Check in-memory cache
    const cached = countCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      response.counts[eventId] = cached.data;
      response.cached.push(eventId);
      continue;
    }

    // Check KV cache
    if (kvCache) {
      try {
        const kvData = await kvCache.get(cacheKey, 'json');
        if (kvData) {
          response.counts[eventId] = kvData as CountData;
          response.cached.push(eventId);
          countCache.set(cacheKey, { data: kvData as CountData, timestamp: Date.now() });
          continue;
        }
      } catch {
        // KV error, will fetch
      }
    }

    toFetch.push(eventId);
  }

  // Fetch counts for non-cached events (in parallel, with concurrency limit)
  const CONCURRENCY = 10;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const batch = toFetch.slice(i, i + CONCURRENCY);
    
    const results = await Promise.allSettled(
      batch.map(async (eventId) => {
        try {
          const counts = await fetchCountsForEvent(eventId);
          return { eventId, counts };
        } catch (err) {
          throw { eventId, error: err };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { eventId, counts } = result.value;
        response.counts[eventId] = counts;
        response.fetched.push(eventId);

        // Update caches
        const cacheKey = `counts:${eventId}`;
        countCache.set(cacheKey, { data: counts, timestamp: Date.now() });
        
        if (kvCache) {
          try {
            await kvCache.put(cacheKey, JSON.stringify(counts), { expirationTtl: 300 });
          } catch {
            // KV write error, non-fatal
          }
        }
      } else {
        const err = result.reason as { eventId: string };
        response.errors.push(err.eventId);
        response.counts[err.eventId] = {
          reactions: null,
          comments: null,
          reposts: null,
          zaps: null
        };
      }
    }
  }

  return json(response, {
    headers: {
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=60'
    }
  });
};

// Also support GET with query params for simpler use cases
export const GET: RequestHandler = async ({ url, platform }) => {
  const idsParam = url.searchParams.get('ids');
  
  if (!idsParam) {
    return json({ error: 'ids query parameter is required' }, { status: 400 });
  }

  const eventIds = idsParam.split(',').filter(isValidEventId);
  
  if (eventIds.length === 0) {
    return json({ error: 'No valid event IDs provided' }, { status: 400 });
  }

  if (eventIds.length > MAX_BATCH_SIZE) {
    return json({ error: `Maximum batch size is ${MAX_BATCH_SIZE}` }, { status: 400 });
  }

  // Reuse POST logic by creating a mock request
  const mockRequest = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventIds })
  });

  return POST({ request: mockRequest, platform, url } as any);
};
