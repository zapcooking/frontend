/**
 * Built-in relay sets for different use cases.
 * These are SSR-safe - no browser APIs used.
 */

export interface RelaySet {
  id: string;
  name: string;
  description: string;
  relays: string[];
}

/**
 * Built-in relay sets
 */
export const RELAY_SETS: Record<string, RelaySet> = {
  default: {
    id: 'default',
    name: 'Default',
    description: 'Standard relay configuration for general use',
    relays: [
      'wss://kitchen.zap.cooking',
      'wss://garden.zap.cooking',
      'wss://nos.lol',
      'wss://relay.damus.io'
    ]
  },
  garden: {
    id: 'garden',
    name: 'Garden',
    description: 'Focused on Zap.Cooking garden relay',
    relays: [
      'wss://garden.zap.cooking',
      'wss://nos.lol'
    ]
  },
  members: {
    id: 'members',
    name: 'Members',
    description: 'Private members relay for Zap.Cooking members',
    relays: [
      'wss://pantry.zap.cooking'
    ]
  },
  discovery: {
    id: 'discovery',
    name: 'Discovery',
    description: 'Optimized for discovering new content and profiles',
    relays: [
      'wss://nostr.wine',
      'wss://relay.primal.net',
      'wss://purplepag.es'
    ]
  },
  profiles: {
    id: 'profiles',
    name: 'Profiles',
    description: 'Focused on profile resolution',
    relays: [
      'wss://purplepag.es'
    ]
  },
  articles: {
    id: 'articles',
    name: 'Articles',
    description: 'Optimized for longform content (kind:30023)',
    relays: [
      'wss://relay.primal.net',     // Primal - aggregated from 100+ relays
      'wss://nos.lol',               // Popular with good uptime
      'wss://relay.damus.io',        // Large general relay
      'wss://nostr.wine',            // Quality content focus
      'wss://purplepag.es',          // Good for content discovery
      'wss://relay.nostr.band'       // Search-optimized
    ]
  }
};

/**
 * Get a relay set by ID
 */
export function getRelaySet(id: string): RelaySet | undefined {
  return RELAY_SETS[id];
}

/**
 * Get all available relay set IDs
 */
export function getRelaySetIds(): string[] {
  return Object.keys(RELAY_SETS);
}

/**
 * Get all relay sets as an array
 */
export function getAllRelaySets(): RelaySet[] {
  return Object.values(RELAY_SETS);
}
