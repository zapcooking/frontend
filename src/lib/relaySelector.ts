/**
 * Smart Relay Selection System
 * 
 * Selects optimal 2-3 relays per author based on:
 * - Success rate (historical query success)
 * - Response time (latency)
 * - Freshness (recency of successful queries)
 * - Connection reuse (prefer already-connected relays)
 * - Coverage optimization (minimize total connections across authors)
 */

import { browser } from '$app/environment';
import { relayListCache, type RelayList, normalizeRelayUrl } from './relayListCache';
import { getConnectionManager, type RelayHealth } from './connectionManager';
import { standardRelays } from './consts';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RelayStats {
  url: string;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  lastSuccess: number;   // timestamp
  lastFailure: number;   // timestamp
  totalLatencyMs: number; // for calculating rolling average
  queryCount: number;    // total queries for accurate avg
}

export interface RelayScore {
  url: string;
  score: number;
  breakdown: {
    successRate: number;
    latency: number;
    freshness: number;
    connected: number;
    coverage: number;
  };
}

export interface SelectionResult {
  relays: string[];
  scores: RelayScore[];
  fallbackUsed: boolean;
}

export interface CoverageResult {
  plan: Map<string, string[]>;  // pubkey -> selected relays
  relayToAuthors: Map<string, string[]>;  // relay -> covered authors
  totalRelays: number;
  totalAuthors: number;
  coverage: number;  // percentage of authors covered
}

export interface RelaySelector {
  selectForAuthor(pubkey: string, count?: number): Promise<SelectionResult>;
  selectForPublish(): Promise<SelectionResult>;
  selectOptimalCoverage(pubkeys: string[], maxRelaysPerAuthor?: number): Promise<CoverageResult>;
  recordSuccess(relay: string, latencyMs: number): void;
  recordFailure(relay: string): void;
  getConnectedRelays(): string[];
  getRelayStats(relay: string): RelayStats | null;
  getAllStats(): Map<string, RelayStats>;
  clearStats(): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // IndexedDB
  DB_NAME: 'zapcooking-relay-stats',
  DB_VERSION: 1,
  STORE_NAME: 'relay-stats',
  
  // Selection defaults
  DEFAULT_RELAYS_PER_AUTHOR: 2,
  MAX_RELAYS_PER_AUTHOR: 3,
  MIN_RELAYS_PER_AUTHOR: 1,
  
  // Scoring weights (must sum to 1.0)
  WEIGHT_SUCCESS_RATE: 0.30,
  WEIGHT_LATENCY: 0.25,
  WEIGHT_FRESHNESS: 0.15,
  WEIGHT_CONNECTED: 0.20,
  WEIGHT_COVERAGE: 0.10,
  
  // Scoring parameters
  IDEAL_LATENCY_MS: 200,
  MAX_LATENCY_MS: 5000,
  FRESHNESS_DECAY_MS: 60 * 60 * 1000, // 1 hour
  MIN_QUERIES_FOR_STATS: 3, // minimum queries before stats are reliable
  
  // Score decay
  SCORE_DECAY_FACTOR: 0.95, // multiply old scores by this on each query
  SCORE_DECAY_INTERVAL_MS: 24 * 60 * 60 * 1000, // apply decay every 24 hours
  
  // Fallback relays when author has no NIP-65
  FALLBACK_RELAYS: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://purplepag.es'
  ],
  
  // Blocked relays (known slow/unreliable)
  BLOCKED_RELAYS: new Set([
    'wss://relay.nostr.band',
    'wss://nostr.wine',
    'wss://filter.nostr.wine',
    'wss://relay.nostr.bg',
    'wss://nostrelites.org',
    'wss://nostr.fmt.wiz.biz',
    'wss://relayable.org',
    'wss://nostr.bitcoiner.social',
    'wss://relay.orangepill.dev'
  ]),
  
  // Persistence
  STATS_PERSIST_INTERVAL_MS: 30 * 1000, // persist every 30 seconds
  MAX_STORED_RELAYS: 500 // limit stored relays to prevent bloat
};

// ═══════════════════════════════════════════════════════════════
// INDEXEDDB SETUP
// ═══════════════════════════════════════════════════════════════

let db: IDBDatabase | null = null;
let dbInitPromise: Promise<IDBDatabase | null> | null = null;

async function initDB(): Promise<IDBDatabase | null> {
  if (!browser) return null;
  
  if (db) return db;
  if (dbInitPromise) return dbInitPromise;
  
  dbInitPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
      
      request.onerror = () => {
        console.warn('[RelaySelector] IndexedDB open failed:', request.error);
        resolve(null);
      };
      
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        
        if (!database.objectStoreNames.contains(CONFIG.STORE_NAME)) {
          const store = database.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'url' });
          store.createIndex('lastSuccess', 'lastSuccess', { unique: false });
          store.createIndex('successCount', 'successCount', { unique: false });
        }
      };
      
      request.onsuccess = () => {
        db = request.result;
        
        db.onerror = (event) => {
          console.warn('[RelaySelector] IndexedDB error:', event);
        };
        
        db.onclose = () => {
          db = null;
          dbInitPromise = null;
        };
        
        resolve(db);
      };
    } catch (err) {
      console.warn('[RelaySelector] IndexedDB init error:', err);
      resolve(null);
    }
  });
  
  return dbInitPromise;
}

async function loadAllStats(): Promise<Map<string, RelayStats>> {
  const stats = new Map<string, RelayStats>();
  const database = await initDB();
  
  if (!database) return stats;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readonly');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      const request = store.getAll();
      
      request.onsuccess = () => {
        for (const stat of request.result || []) {
          stats.set(stat.url, stat);
        }
        resolve(stats);
      };
      
      request.onerror = () => {
        console.warn('[RelaySelector] Failed to load stats:', request.error);
        resolve(stats);
      };
    } catch (err) {
      console.warn('[RelaySelector] loadAllStats error:', err);
      resolve(stats);
    }
  });
}

async function saveAllStats(stats: Map<string, RelayStats>): Promise<void> {
  const database = await initDB();
  if (!database) return;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      
      // Limit stored relays to prevent IndexedDB bloat
      const sortedStats = [...stats.values()]
        .sort((a, b) => b.lastSuccess - a.lastSuccess)
        .slice(0, CONFIG.MAX_STORED_RELAYS);
      
      // Clear and rewrite
      store.clear();
      
      for (const stat of sortedStats) {
        store.put(stat);
      }
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn('[RelaySelector] Failed to save stats:', tx.error);
        resolve();
      };
    } catch (err) {
      console.warn('[RelaySelector] saveAllStats error:', err);
      resolve();
    }
  });
}

async function clearStatsDB(): Promise<void> {
  const database = await initDB();
  if (!database) return;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// RELAY SELECTOR IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

class RelaySelectorImpl implements RelaySelector {
  private stats = new Map<string, RelayStats>();
  private statsLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private persistTimeout: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private lastDecayTime = 0;
  
  constructor() {
    if (browser) {
      this.loadStats();
      
      // Setup periodic persistence
      setInterval(() => {
        if (this.dirty) {
          this.persistStats();
        }
      }, CONFIG.STATS_PERSIST_INTERVAL_MS);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STATS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  private async loadStats(): Promise<void> {
    if (this.statsLoaded) return;
    if (this.loadPromise) return this.loadPromise;
    
    this.loadPromise = (async () => {
      this.stats = await loadAllStats();
      this.statsLoaded = true;
      this.lastDecayTime = Date.now();
      console.debug(`[RelaySelector] Loaded stats for ${this.stats.size} relays`);
    })();
    
    return this.loadPromise;
  }
  
  private async persistStats(): Promise<void> {
    if (!this.dirty) return;
    
    await saveAllStats(this.stats);
    this.dirty = false;
    console.debug(`[RelaySelector] Persisted stats for ${this.stats.size} relays`);
  }
  
  private getOrCreateStats(relay: string): RelayStats {
    const normalized = normalizeRelayUrl(relay);
    
    if (!this.stats.has(normalized)) {
      this.stats.set(normalized, {
        url: normalized,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
        lastSuccess: 0,
        lastFailure: 0,
        totalLatencyMs: 0,
        queryCount: 0
      });
    }
    
    return this.stats.get(normalized)!;
  }
  
  private applyDecay(): void {
    const now = Date.now();
    
    // Only decay once per interval
    if (now - this.lastDecayTime < CONFIG.SCORE_DECAY_INTERVAL_MS) return;
    
    for (const stats of this.stats.values()) {
      stats.successCount = Math.floor(stats.successCount * CONFIG.SCORE_DECAY_FACTOR);
      stats.failureCount = Math.floor(stats.failureCount * CONFIG.SCORE_DECAY_FACTOR);
      stats.queryCount = Math.floor(stats.queryCount * CONFIG.SCORE_DECAY_FACTOR);
      stats.totalLatencyMs = Math.floor(stats.totalLatencyMs * CONFIG.SCORE_DECAY_FACTOR);
      
      // Recalculate average
      if (stats.queryCount > 0) {
        stats.avgLatencyMs = stats.totalLatencyMs / stats.queryCount;
      }
    }
    
    this.lastDecayTime = now;
    this.dirty = true;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API - Recording
  // ═══════════════════════════════════════════════════════════════
  
  recordSuccess(relay: string, latencyMs: number): void {
    const stats = this.getOrCreateStats(relay);
    
    stats.successCount++;
    stats.queryCount++;
    stats.totalLatencyMs += latencyMs;
    stats.avgLatencyMs = stats.totalLatencyMs / stats.queryCount;
    stats.lastSuccess = Date.now();
    
    this.dirty = true;
    this.applyDecay();
  }
  
  recordFailure(relay: string): void {
    const stats = this.getOrCreateStats(relay);
    
    stats.failureCount++;
    stats.queryCount++;
    stats.lastFailure = Date.now();
    
    this.dirty = true;
    this.applyDecay();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SCORING
  // ═══════════════════════════════════════════════════════════════
  
  private calculateScore(
    relay: string,
    coverageBonus: number = 0
  ): RelayScore {
    const normalized = normalizeRelayUrl(relay);
    const stats = this.stats.get(normalized);
    const connectionManager = getConnectionManager();
    
    // Get connection status from ConnectionManager
    const connectedRelays = connectionManager?.getConnectedRelays() || [];
    const isConnected = connectedRelays.includes(normalized);
    
    // Get health info if available
    const healthInfo = connectionManager?.getRelayHealth().find(h => h.url === normalized);
    
    // Default scores
    let successRateScore = 0.5; // neutral default
    let latencyScore = 0.5;
    let freshnessScore = 0.3;
    let connectedScore = isConnected ? 1.0 : 0;
    let coverageScore = coverageBonus;
    
    if (stats && stats.queryCount >= CONFIG.MIN_QUERIES_FOR_STATS) {
      // Success rate: successCount / totalQueries
      const totalQueries = stats.successCount + stats.failureCount;
      if (totalQueries > 0) {
        successRateScore = stats.successCount / totalQueries;
      }
      
      // Latency: inverse scale from ideal to max
      if (stats.avgLatencyMs > 0) {
        if (stats.avgLatencyMs <= CONFIG.IDEAL_LATENCY_MS) {
          latencyScore = 1.0;
        } else if (stats.avgLatencyMs >= CONFIG.MAX_LATENCY_MS) {
          latencyScore = 0;
        } else {
          latencyScore = 1 - (stats.avgLatencyMs - CONFIG.IDEAL_LATENCY_MS) / 
                            (CONFIG.MAX_LATENCY_MS - CONFIG.IDEAL_LATENCY_MS);
        }
      }
      
      // Freshness: exponential decay from last success
      if (stats.lastSuccess > 0) {
        const age = Date.now() - stats.lastSuccess;
        freshnessScore = Math.exp(-age / CONFIG.FRESHNESS_DECAY_MS);
      }
    } else if (healthInfo) {
      // Use ConnectionManager health data if no query stats
      if (healthInfo.responseTime) {
        if (healthInfo.responseTime <= CONFIG.IDEAL_LATENCY_MS) {
          latencyScore = 1.0;
        } else if (healthInfo.responseTime >= CONFIG.MAX_LATENCY_MS) {
          latencyScore = 0;
        } else {
          latencyScore = 1 - (healthInfo.responseTime - CONFIG.IDEAL_LATENCY_MS) / 
                            (CONFIG.MAX_LATENCY_MS - CONFIG.IDEAL_LATENCY_MS);
        }
      }
      
      // Use health status
      if (healthInfo.status === 'connected') {
        successRateScore = 0.8;
        freshnessScore = 0.8;
      } else if (healthInfo.status === 'degraded') {
        successRateScore = 0.5;
        freshnessScore = 0.5;
      } else if (healthInfo.status === 'circuit-open') {
        successRateScore = 0.1;
        freshnessScore = 0.1;
      }
    }
    
    // Calculate weighted score
    const score = 
      CONFIG.WEIGHT_SUCCESS_RATE * successRateScore +
      CONFIG.WEIGHT_LATENCY * latencyScore +
      CONFIG.WEIGHT_FRESHNESS * freshnessScore +
      CONFIG.WEIGHT_CONNECTED * connectedScore +
      CONFIG.WEIGHT_COVERAGE * coverageScore;
    
    return {
      url: normalized,
      score,
      breakdown: {
        successRate: successRateScore,
        latency: latencyScore,
        freshness: freshnessScore,
        connected: connectedScore,
        coverage: coverageScore
      }
    };
  }
  
  private rankRelays(relays: string[], coverageBonuses?: Map<string, number>): RelayScore[] {
    return relays
      .filter(r => !CONFIG.BLOCKED_RELAYS.has(normalizeRelayUrl(r)))
      .map(r => this.calculateScore(r, coverageBonuses?.get(normalizeRelayUrl(r)) || 0))
      .sort((a, b) => b.score - a.score);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API - Selection
  // ═══════════════════════════════════════════════════════════════
  
  async selectForAuthor(pubkey: string, count: number = CONFIG.DEFAULT_RELAYS_PER_AUTHOR): Promise<SelectionResult> {
    await this.loadStats();
    
    // Get author's relay list
    const relayList = await relayListCache.get(pubkey);
    
    // Use write relays (outbox) for fetching author's events
    let candidateRelays = relayList?.write || [];
    let fallbackUsed = false;
    
    // Fallback if no NIP-65
    if (candidateRelays.length === 0) {
      candidateRelays = CONFIG.FALLBACK_RELAYS;
      fallbackUsed = true;
    }
    
    // Rank and select top N
    const ranked = this.rankRelays(candidateRelays);
    const selected = ranked.slice(0, Math.min(count, CONFIG.MAX_RELAYS_PER_AUTHOR));
    
    return {
      relays: selected.map(s => s.url),
      scores: selected,
      fallbackUsed
    };
  }
  
  async selectForPublish(): Promise<SelectionResult> {
    await this.loadStats();
    
    // For publishing, use our standard relays + any connected relays
    const connectedRelays = this.getConnectedRelays();
    const allCandidates = [...new Set([...standardRelays, ...connectedRelays])];
    
    // Rank by reliability for publishing (higher bar)
    const ranked = this.rankRelays(allCandidates);
    
    // For publishing, select more relays for redundancy
    const selected = ranked.slice(0, 4);
    
    return {
      relays: selected.map(s => s.url),
      scores: selected,
      fallbackUsed: false
    };
  }
  
  /**
   * Optimal relay coverage across multiple authors
   * 
   * Uses a greedy set cover algorithm to minimize total relay connections
   * while ensuring each author has at least minRelaysPerAuthor coverage.
   */
  async selectOptimalCoverage(
    pubkeys: string[],
    maxRelaysPerAuthor: number = CONFIG.DEFAULT_RELAYS_PER_AUTHOR
  ): Promise<CoverageResult> {
    await this.loadStats();
    
    if (pubkeys.length === 0) {
      return {
        plan: new Map(),
        relayToAuthors: new Map(),
        totalRelays: 0,
        totalAuthors: 0,
        coverage: 1.0
      };
    }
    
    // Get relay lists for all authors
    const relayLists = await relayListCache.getMany(pubkeys);
    
    // Build relay -> authors mapping
    const relayToAuthors = new Map<string, Set<string>>();
    const authorToRelays = new Map<string, string[]>();
    const authorsNeedingFallback: string[] = [];
    
    for (const pubkey of pubkeys) {
      const relayList = relayLists.get(pubkey);
      const writeRelays = (relayList?.write || [])
        .filter(r => !CONFIG.BLOCKED_RELAYS.has(normalizeRelayUrl(r)))
        .map(normalizeRelayUrl);
      
      if (writeRelays.length === 0) {
        authorsNeedingFallback.push(pubkey);
        continue;
      }
      
      authorToRelays.set(pubkey, writeRelays);
      
      for (const relay of writeRelays) {
        if (!relayToAuthors.has(relay)) {
          relayToAuthors.set(relay, new Set());
        }
        relayToAuthors.get(relay)!.add(pubkey);
      }
    }
    
    // Add fallback relays for authors without NIP-65
    for (const relay of CONFIG.FALLBACK_RELAYS.map(normalizeRelayUrl)) {
      if (!relayToAuthors.has(relay)) {
        relayToAuthors.set(relay, new Set());
      }
      for (const pubkey of authorsNeedingFallback) {
        relayToAuthors.get(relay)!.add(pubkey);
      }
    }
    
    // Also set up authorToRelays for fallback authors
    for (const pubkey of authorsNeedingFallback) {
      authorToRelays.set(pubkey, CONFIG.FALLBACK_RELAYS.map(normalizeRelayUrl));
    }
    
    // Calculate coverage bonus for each relay (0-1 based on how many authors it covers)
    const maxCoverage = Math.max(...[...relayToAuthors.values()].map(s => s.size), 1);
    const coverageBonuses = new Map<string, number>();
    for (const [relay, authors] of relayToAuthors) {
      coverageBonuses.set(relay, authors.size / maxCoverage);
    }
    
    // Greedy set cover with scoring
    const plan = new Map<string, string[]>(); // pubkey -> assigned relays
    const selectedRelays = new Set<string>();
    const coveredAuthors = new Map<string, Set<string>>(); // pubkey -> relays assigned
    
    // Initialize coverage tracking
    for (const pubkey of pubkeys) {
      coveredAuthors.set(pubkey, new Set());
    }
    
    // Prioritize connected relays first
    const connectedRelays = new Set(this.getConnectedRelays().map(normalizeRelayUrl));
    
    // Score all relays
    const allRelays = [...relayToAuthors.keys()];
    const scoredRelays = this.rankRelays(allRelays, coverageBonuses);
    
    // Boost connected relays in the ranking
    scoredRelays.sort((a, b) => {
      const aConnected = connectedRelays.has(a.url) ? 0.5 : 0;
      const bConnected = connectedRelays.has(b.url) ? 0.5 : 0;
      return (b.score + bConnected) - (a.score + aConnected);
    });
    
    // Greedy selection: pick relays that cover the most uncovered authors
    for (const { url: relay } of scoredRelays) {
      const authorsThisRelayCovers = relayToAuthors.get(relay) || new Set();
      
      // Find uncovered authors that need more relays
      const uncoveredAuthors = [...authorsThisRelayCovers].filter(pubkey => {
        const assigned = coveredAuthors.get(pubkey);
        return assigned && assigned.size < maxRelaysPerAuthor;
      });
      
      if (uncoveredAuthors.length === 0) continue;
      
      // Select this relay
      selectedRelays.add(relay);
      
      // Assign to authors
      for (const pubkey of uncoveredAuthors) {
        const assigned = coveredAuthors.get(pubkey)!;
        if (assigned.size < maxRelaysPerAuthor) {
          assigned.add(relay);
        }
      }
      
      // Check if all authors have enough coverage
      const allCovered = [...coveredAuthors.values()].every(
        assigned => assigned.size >= CONFIG.MIN_RELAYS_PER_AUTHOR
      );
      
      if (allCovered) {
        // Continue to try to get more coverage for authors who have less than max
        const allMaxed = [...coveredAuthors.values()].every(
          assigned => assigned.size >= maxRelaysPerAuthor
        );
        if (allMaxed) break;
      }
    }
    
    // Build final plan
    for (const [pubkey, relays] of coveredAuthors) {
      plan.set(pubkey, [...relays]);
    }
    
    // Build relay -> authors result (as arrays)
    const relayToAuthorsResult = new Map<string, string[]>();
    for (const relay of selectedRelays) {
      const authors = [...(relayToAuthors.get(relay) || [])]
        .filter(pk => coveredAuthors.get(pk)?.has(relay));
      relayToAuthorsResult.set(relay, authors);
    }
    
    // Calculate coverage percentage
    const authorsWithCoverage = [...coveredAuthors.values()].filter(s => s.size > 0).length;
    const coverage = pubkeys.length > 0 ? authorsWithCoverage / pubkeys.length : 1.0;
    
    console.debug(
      `[RelaySelector] Coverage: ${selectedRelays.size} relays for ${pubkeys.length} authors ` +
      `(${(coverage * 100).toFixed(1)}% coverage)`
    );
    
    return {
      plan,
      relayToAuthors: relayToAuthorsResult,
      totalRelays: selectedRelays.size,
      totalAuthors: pubkeys.length,
      coverage
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API - Utilities
  // ═══════════════════════════════════════════════════════════════
  
  getConnectedRelays(): string[] {
    const connectionManager = getConnectionManager();
    return connectionManager?.getConnectedRelays() || [];
  }
  
  getRelayStats(relay: string): RelayStats | null {
    return this.stats.get(normalizeRelayUrl(relay)) || null;
  }
  
  getAllStats(): Map<string, RelayStats> {
    return new Map(this.stats);
  }
  
  async clearStats(): Promise<void> {
    this.stats.clear();
    this.dirty = false;
    await clearStatsDB();
    console.debug('[RelaySelector] Stats cleared');
  }
  
  /**
   * Get best relays for a batch query (optimized for the outbox pattern)
   * 
   * Returns a query plan: which relays to query for which authors
   */
  async buildQueryPlan(
    pubkeys: string[],
    options: {
      maxRelaysTotal?: number;
      maxRelaysPerAuthor?: number;
      minAuthorsPerRelay?: number;
    } = {}
  ): Promise<{
    queries: Array<{ relay: string; authors: string[]; score: number }>;
    coverage: number;
    skippedAuthors: string[];
  }> {
    const {
      maxRelaysTotal = 20,
      maxRelaysPerAuthor = 2,
      minAuthorsPerRelay = 2
    } = options;
    
    const coverage = await this.selectOptimalCoverage(pubkeys, maxRelaysPerAuthor);
    
    // Convert to query plan format
    const queries: Array<{ relay: string; authors: string[]; score: number }> = [];
    
    for (const [relay, authors] of coverage.relayToAuthors) {
      if (authors.length < minAuthorsPerRelay && coverage.totalRelays > maxRelaysTotal) {
        // Skip low-coverage relays if we have too many
        continue;
      }
      
      const score = this.calculateScore(relay).score;
      queries.push({ relay, authors, score });
    }
    
    // Sort by coverage * score (prioritize high-coverage, high-quality relays)
    queries.sort((a, b) => {
      const aValue = a.authors.length * a.score;
      const bValue = b.authors.length * b.score;
      return bValue - aValue;
    });
    
    // Limit total relays
    const selectedQueries = queries.slice(0, maxRelaysTotal);
    
    // Find authors not covered
    const coveredAuthors = new Set(selectedQueries.flatMap(q => q.authors));
    const skippedAuthors = pubkeys.filter(pk => !coveredAuthors.has(pk));
    
    return {
      queries: selectedQueries,
      coverage: (pubkeys.length - skippedAuthors.length) / pubkeys.length,
      skippedAuthors
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const relaySelector = new RelaySelectorImpl();

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Quick selection of best relays for a single author
 */
export async function selectRelaysForAuthor(
  pubkey: string,
  count: number = 2
): Promise<string[]> {
  const result = await relaySelector.selectForAuthor(pubkey, count);
  return result.relays;
}

/**
 * Build an optimized query plan for fetching events from multiple authors
 */
export async function buildOptimizedQueryPlan(
  pubkeys: string[],
  maxRelays: number = 15
): Promise<Array<{ relay: string; authors: string[] }>> {
  const { queries } = await relaySelector.buildQueryPlan(pubkeys, {
    maxRelaysTotal: maxRelays,
    maxRelaysPerAuthor: 2,
    minAuthorsPerRelay: 2
  });
  
  return queries.map(q => ({ relay: q.relay, authors: q.authors }));
}

/**
 * Record query outcomes (call from fetch functions)
 */
export function recordQuerySuccess(relay: string, latencyMs: number): void {
  relaySelector.recordSuccess(relay, latencyMs);
}

export function recordQueryFailure(relay: string): void {
  relaySelector.recordFailure(relay);
}

