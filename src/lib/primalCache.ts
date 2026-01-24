import { browser } from '$app/environment';
import { NDKEvent, type NDK } from '@nostr-dev-kit/ndk';

export interface PrimalProfile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
  about?: string;
}

export interface PrimalEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface PrimalFeedResult {
  events: NDKEvent[];
  profiles: Map<string, PrimalProfile>;
}

export interface PrimalFeedOptions {
  limit?: number;
  since?: number;
  until?: number;
  includeReplies?: boolean;
}

interface PrimalSearchResult {
  profiles: PrimalProfile[];
}

interface PrimalFeedResponse {
  events: PrimalEvent[];
  profiles: PrimalProfile[];
}

interface PendingRequest {
  resolve: (value: PrimalSearchResult | PrimalFeedResponse | string[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  profiles: PrimalProfile[];
  events: PrimalEvent[];
  follows: string[];
  type: 'search' | 'feed' | 'contacts' | 'global';
}

export class PrimalCacheService {
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private currentEndpoint = 0;
  private endpoints = ['wss://cache2.primal.net/v1', 'wss://cache1.primal.net/v1'];
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    if (browser) {
      this.connect();
    }
  }

  private connect(): Promise<void> {
    if (!browser || typeof WebSocket === 'undefined') {
      return Promise.reject(new Error('WebSocket unavailable'));
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      const endpoint = this.endpoints[this.currentEndpoint];
      if (!endpoint) {
        reject(new Error('No endpoint available'));
        return;
      }

      try {
        this.ws = new WebSocket(endpoint);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.connectionPromise = null;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (error) {
            console.error('[PrimalCache] Error parsing message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[PrimalCache] WebSocket error:', error);
        };

        this.ws.onclose = () => {
          this.connectionPromise = null;
          this.handleDisconnect();
        };

        setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            this.ws?.close();
            reject(new Error('Connection timeout'));
          }
        }, 5000);
      } catch (error) {
        this.connectionPromise = null;
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  private handleDisconnect() {
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('WebSocket disconnected'));
    });
    this.pendingRequests.clear();

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts += 1;
      this.currentEndpoint = (this.currentEndpoint + 1) % this.endpoints.length;
      setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
    } else {
      console.error('[PrimalCache] Max reconnect attempts reached');
    }
  }

  private handleMessage(data: unknown) {
    if (!Array.isArray(data) || data.length < 2) return;

    const [messageType, requestId, ...rest] = data;

    if (messageType === 'EVENT' && requestId && rest.length > 0) {
      const event = rest[0] as PrimalEvent;
      const pending = this.pendingRequests.get(requestId as string);

      if (!pending) return;

      if (event.kind === 0) {
        // Profile metadata
        try {
          const metadata = JSON.parse(event.content);
          pending.profiles.push({
            pubkey: event.pubkey,
            name: metadata.name,
            display_name: metadata.display_name,
            picture: metadata.picture,
            nip05: metadata.nip05,
            about: metadata.about
          });
        } catch (error) {
          console.error('[PrimalCache] Error parsing profile metadata:', error);
        }
      } else if (event.kind === 1) {
        // Note event
        pending.events.push(event);
      } else if (event.kind === 3) {
        // Contact list - extract followed pubkeys
        const follows = event.tags
          .filter((tag: string[]) => tag[0] === 'p' && tag[1])
          .map((tag: string[]) => tag[1]);
        pending.follows.push(...follows);
      }
    } else if (messageType === 'EOSE' && requestId) {
      const pending = this.pendingRequests.get(requestId as string);
      if (pending) {
        clearTimeout(pending.timeout);
        
        if (pending.type === 'search') {
          (pending.resolve as (value: PrimalSearchResult) => void)({ profiles: pending.profiles });
        } else if (pending.type === 'feed' || pending.type === 'global') {
          (pending.resolve as (value: PrimalFeedResponse) => void)({ 
            events: pending.events, 
            profiles: pending.profiles 
          });
        } else if (pending.type === 'contacts') {
          (pending.resolve as (value: string[]) => void)(pending.follows);
        }
        
        this.pendingRequests.delete(requestId as string);
      }
    } else if (messageType === 'NOTICE') {
      console.warn('[PrimalCache] Notice:', rest);
    }
  }

  private generateRequestId(): string {
    return `search_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  public async searchProfiles(query: string, limit: number = 10, timeoutMs: number = 5000): Promise<PrimalProfile[]> {
    if (!query || query.length < 2) {
      return [];
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const requestId = this.generateRequestId();
    const request = [
      'REQ',
      requestId,
      {
        cache: ['user_search', { query, limit }]
      }
    ];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Search request timed out'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (result) => resolve((result as PrimalSearchResult).profiles),
        reject,
        timeout,
        profiles: [],
        events: [],
        follows: [],
        type: 'search'
      });

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error as Error);
      }
    });
  }

  /**
   * Fetch contact list (follows) for a user from Primal cache
   * Much faster than fetching kind:3 from relays
   */
  public async fetchContactList(pubkey: string, timeoutMs: number = 3000): Promise<string[]> {
    if (!pubkey) return [];

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const requestId = this.generateRequestId();
    // Request the user's contact list (kind:3)
    const request = [
      'REQ',
      requestId,
      {
        cache: ['contact_list', { pubkey }]
      }
    ];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Contact list request timed out'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: PrimalSearchResult | PrimalFeedResponse | string[]) => void,
        reject,
        timeout,
        profiles: [],
        events: [],
        follows: [],
        type: 'contacts'
      });

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error as Error);
      }
    });
  }

  /**
   * Fetch feed events for a list of followed pubkeys from Primal cache
   * Returns events from all the followed users, aggregated from 100+ relays
   */
  public async fetchFeed(
    pubkeys: string[], 
    options: { limit?: number; since?: number; until?: number; includeReplies?: boolean } = {},
    timeoutMs: number = 5000
  ): Promise<PrimalFeedResponse> {
    if (!pubkeys || pubkeys.length === 0) {
      return { events: [], profiles: [] };
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const { limit = 100, since, until, includeReplies = false } = options;

    const requestId = this.generateRequestId();
    
    // Build the feed request
    // Primal's feed cache returns notes from specified authors
    const cacheParams: Record<string, unknown> = {
      pubkeys,
      limit,
      include_replies: includeReplies
    };
    
    if (since) cacheParams.since = since;
    if (until) cacheParams.until = until;

    const request = [
      'REQ',
      requestId,
      {
        cache: ['feed', cacheParams]
      }
    ];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Feed request timed out'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: PrimalSearchResult | PrimalFeedResponse | string[]) => void,
        reject,
        timeout,
        profiles: [],
        events: [],
        follows: [],
        type: 'feed'
      });

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error as Error);
      }
    });
  }

  /**
   * Fetch global/explore feed from Primal cache
   * Returns trending/recent notes from across Nostr
   */
  public async fetchGlobal(
    options: { limit?: number; since?: number; until?: number } = {},
    timeoutMs: number = 5000
  ): Promise<PrimalFeedResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const { limit = 200, since, until } = options;

    const requestId = this.generateRequestId();
    
    // Build the global feed request
    const cacheParams: Record<string, unknown> = {
      limit
    };
    
    if (since) cacheParams.since = since;
    if (until) cacheParams.until = until;

    // Use explore_global_latest for recent global content
    const request = [
      'REQ',
      requestId,
      {
        cache: ['explore_global_latest', cacheParams]
      }
    ];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Global feed request timed out'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: PrimalSearchResult | PrimalFeedResponse | string[]) => void,
        reject,
        timeout,
        profiles: [],
        events: [],
        follows: [],
        type: 'global'
      });

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error as Error);
      }
    });
  }

  public async fetchProfile(pubkey: string, timeoutMs: number = 5000): Promise<PrimalProfile | null> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const requestId = this.generateRequestId();
    const request = [
      'REQ',
      requestId,
      {
        cache: ['user_infos', { pubkeys: [pubkey] }]
      }
    ];

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Profile fetch timed out'));
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (result) => resolve((result as PrimalSearchResult).profiles[0] || null),
        reject,
        timeout,
        profiles: [],
        events: [],
        follows: [],
        type: 'search'
      });

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error as Error);
      }
    });
  }

  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

let primalCache: PrimalCacheService | null = null;

export const getPrimalCache = (): PrimalCacheService | null => {
  if (!browser) return null;
  if (!primalCache) {
    primalCache = new PrimalCacheService();
  }
  return primalCache;
};

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS FOR FEED INTEGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Convert a Primal event to an NDK-like event object
 * This allows Primal events to work with existing feed filtering/display code
 */
function primalEventToNDKLike(event: PrimalEvent, ndk: NDK): NDKEvent {
  const ndkEvent = new NDKEvent(ndk);
  ndkEvent.id = event.id;
  ndkEvent.pubkey = event.pubkey;
  ndkEvent.created_at = event.created_at;
  ndkEvent.kind = event.kind;
  ndkEvent.tags = event.tags;
  ndkEvent.content = event.content;
  ndkEvent.sig = event.sig;
  return ndkEvent;
}

/**
 * Fetch contact list (follows) for a user from Primal cache
 * Convenience wrapper that handles connection and errors
 */
export async function fetchContactListFromPrimal(pubkey: string): Promise<string[]> {
  const cache = getPrimalCache();
  if (!cache) {
    throw new Error('Primal cache not available');
  }
  
  return cache.fetchContactList(pubkey);
}

/**
 * Fetch feed events for followed users from Primal cache
 * Converts Primal events to NDKEvent format for compatibility
 */
export async function fetchFeedFromPrimal(
  ndk: NDK,
  followedPubkeys: string[],
  options: PrimalFeedOptions = {}
): Promise<PrimalFeedResult> {
  const cache = getPrimalCache();
  if (!cache) {
    throw new Error('Primal cache not available');
  }
  
  const { limit = 100, since, until, includeReplies = false } = options;
  
  const response = await cache.fetchFeed(followedPubkeys, {
    limit,
    since,
    until,
    includeReplies
  });
  
  // Convert Primal events to NDKEvent format
  const events = response.events.map(e => primalEventToNDKLike(e, ndk));
  
  // Build profile map
  const profiles = new Map<string, PrimalProfile>();
  for (const profile of response.profiles) {
    profiles.set(profile.pubkey, profile);
  }
  
  return { events, profiles };
}

/**
 * Fetch global feed from Primal cache
 * Converts Primal events to NDKEvent format for compatibility
 */
export async function fetchGlobalFromPrimal(
  ndk: NDK,
  options: { limit?: number; since?: number; until?: number } = {}
): Promise<PrimalFeedResult> {
  const cache = getPrimalCache();
  if (!cache) {
    throw new Error('Primal cache not available');
  }
  
  const { limit = 200, since, until } = options;
  
  const response = await cache.fetchGlobal({ limit, since, until });
  
  // Convert Primal events to NDKEvent format
  const events = response.events.map(e => primalEventToNDKLike(e, ndk));
  
  // Build profile map
  const profiles = new Map<string, PrimalProfile>();
  for (const profile of response.profiles) {
    profiles.set(profile.pubkey, profile);
  }
  
  return { events, profiles };
}

/**
 * Helper to calculate "7 days ago" timestamp
 */
export function sevenDaysAgo(): number {
  return Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
}
