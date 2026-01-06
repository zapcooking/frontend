/**
 * Query Batcher for Nostr
 * 
 * Groups authors by shared relays to make fewer, more efficient requests.
 * 
 * Instead of:
 *   Author A → query relay1, relay2
 *   Author B → query relay2, relay3
 *   = 4 queries
 * 
 * We do:
 *   relay1 → authors [A]
 *   relay2 → authors [A, B]
 *   relay3 → authors [B]
 *   = 3 queries (or fewer with optimization)
 * 
 * With set cover optimization, we can further reduce to:
 *   relay2 → authors [A, B]
 *   = 1 query covering both authors!
 */

import { browser } from '$app/environment';
import type { NDK, NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';
import { relayListCache, type RelayList, normalizeRelayUrl } from './relayListCache';
import { relaySelector, recordQuerySuccess, recordQueryFailure } from './relaySelector';
import { getConnectionManager } from './connectionManager';
import { 
  relayHealthTracker, 
  recordRelaySuccess, 
  recordRelayFailure, 
  recordRelayTimeout,
  filterHealthyRelays 
} from './relayHealthTracker';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RelayQueryPlan {
  relay: string;
  authors: string[];
  filter: NDKFilter;
  score: number;        // relay quality score
  coverage: number;     // how many unique authors this query covers
}

export interface QueryPlanOptions {
  maxRelaysPerAuthor?: number;    // default 2 - redundancy per author
  maxAuthorsPerRelay?: number;    // default 50 - relay filter limit
  minCoverage?: number;           // default 1 - minimum relays per author
  maxTotalRelays?: number;        // default 20 - cap total connections
  preferConnected?: boolean;      // default true - prefer already-connected relays
}

export interface QueryExecutionOptions {
  timeoutMs?: number;             // per-relay timeout (default 3000)
  globalTimeoutMs?: number;       // total timeout (default 5000)
  maxConcurrent?: number;         // max parallel requests (default 6)
  earlyStopCount?: number;        // stop early if we have N events (optional)
  onProgress?: (progress: QueryProgress) => void;
  onEvents?: (events: NDKEvent[], relay: string) => void;  // stream events as they arrive
}

export interface QueryProgress {
  completedQueries: number;
  totalQueries: number;
  eventsFound: number;
  relaysSucceeded: string[];
  relaysFailed: string[];
}

export interface QueryResult {
  events: NDKEvent[];
  metrics: QueryMetrics;
  eventRelayHints: Map<string, string[]>;  // eventId -> relays it came from
}

export interface QueryMetrics {
  // Efficiency
  naiveQueryCount: number;      // how many queries naive approach would make
  actualQueryCount: number;     // how many queries we actually made
  connectionsSaved: number;     // naiveQueryCount - actualQueryCount
  savingsPercent: number;       // percentage reduction
  
  // Coverage
  totalAuthors: number;
  authorsCovered: number;
  coveragePercent: number;
  
  // Performance
  totalTimeMs: number;
  planningTimeMs: number;
  executionTimeMs: number;
  avgLatencyMs: number;
  
  // Results
  eventsFound: number;
  uniqueEvents: number;
  duplicatesFiltered: number;
  
  // Relay breakdown
  relaysQueried: string[];
  relaysSucceeded: string[];
  relaysFailed: string[];
  relaysTimedOut: string[];
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  DEFAULT_MAX_RELAYS_PER_AUTHOR: 2,
  DEFAULT_MAX_AUTHORS_PER_RELAY: 50,
  DEFAULT_MIN_COVERAGE: 1,
  DEFAULT_MAX_TOTAL_RELAYS: 10,      // Reduced from 20 - top 10 by coverage
  DEFAULT_TIMEOUT_MS: 3000,
  DEFAULT_GLOBAL_TIMEOUT_MS: 5000,   // 5 second max total
  DEFAULT_MAX_CONCURRENT: 6,
  
  // Fallback relays for authors without NIP-65
  FALLBACK_RELAYS: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://purplepag.es'
  ],
  
  // Blocked relays
  BLOCKED_RELAYS: new Set([
    'wss://relay.nostr.band',
    'wss://nostr.wine',
    'wss://filter.nostr.wine',
    'wss://relay.nostr.bg',
    'wss://nostr.bitcoiner.social',
    'wss://relay.orangepill.dev'
  ])
};

// ═══════════════════════════════════════════════════════════════
// SET COVER ALGORITHM
// ═══════════════════════════════════════════════════════════════

interface RelayCandidate {
  relay: string;
  authors: Set<string>;
  score: number;
}

/**
 * Greedy weighted set cover algorithm
 * 
 * Selects minimum number of relays that cover all authors,
 * weighted by relay quality score.
 */
function greedySetCover(
  candidates: RelayCandidate[],
  allAuthors: Set<string>,
  options: {
    minCoverage: number;
    maxRelays: number;
    maxAuthorsPerRelay: number;
  }
): RelayCandidate[] {
  const { minCoverage, maxRelays, maxAuthorsPerRelay } = options;
  
  const selected: RelayCandidate[] = [];
  const coverageCount = new Map<string, number>(); // author -> times covered
  
  // Initialize coverage count
  for (const author of allAuthors) {
    coverageCount.set(author, 0);
  }
  
  // Keep selecting relays until we have minimum coverage for all authors
  while (selected.length < maxRelays) {
    // Find authors that still need coverage
    const undercoveredAuthors = new Set(
      [...coverageCount.entries()]
        .filter(([_, count]) => count < minCoverage)
        .map(([author]) => author)
    );
    
    // If all authors have minimum coverage, we're done
    if (undercoveredAuthors.size === 0) break;
    
    // Find best relay: one that covers the most undercovered authors, weighted by score
    let bestRelay: RelayCandidate | null = null;
    let bestValue = -1;
    
    for (const candidate of candidates) {
      // Skip if already selected
      if (selected.some(s => s.relay === candidate.relay)) continue;
      
      // Count how many undercovered authors this relay serves
      const uncoveredCount = [...candidate.authors]
        .filter(a => undercoveredAuthors.has(a))
        .length;
      
      if (uncoveredCount === 0) continue;
      
      // Value = coverage * score (weighted selection)
      const value = uncoveredCount * (0.5 + candidate.score * 0.5);
      
      if (value > bestValue) {
        bestValue = value;
        bestRelay = candidate;
      }
    }
    
    // No more relays can improve coverage
    if (!bestRelay) break;
    
    // Add this relay to selection
    selected.push(bestRelay);
    
    // Update coverage counts
    for (const author of bestRelay.authors) {
      coverageCount.set(author, (coverageCount.get(author) || 0) + 1);
    }
  }
  
  return selected;
}

// ═══════════════════════════════════════════════════════════════
// QUERY BATCHER CLASS
// ═══════════════════════════════════════════════════════════════

export class QueryBatcher {
  private ndk: NDK;
  
  constructor(ndk: NDK) {
    this.ndk = ndk;
  }
  
  /**
   * Create an optimized query plan for fetching events from multiple authors
   */
  async createQueryPlan(
    pubkeys: string[],
    baseFilter: Omit<NDKFilter, 'authors'>,
    options: QueryPlanOptions = {}
  ): Promise<RelayQueryPlan[]> {
    const {
      maxRelaysPerAuthor = CONFIG.DEFAULT_MAX_RELAYS_PER_AUTHOR,
      maxAuthorsPerRelay = CONFIG.DEFAULT_MAX_AUTHORS_PER_RELAY,
      minCoverage = CONFIG.DEFAULT_MIN_COVERAGE,
      maxTotalRelays = CONFIG.DEFAULT_MAX_TOTAL_RELAYS,
      preferConnected = true
    } = options;
    
    if (pubkeys.length === 0) return [];
    
    // 1. Get relay lists for all authors
    const relayLists = await relayListCache.getMany(pubkeys);
    
    // 2. Build relay -> authors mapping
    const relayToAuthors = new Map<string, Set<string>>();
    const authorsWithRelays = new Set<string>();
    const authorsWithoutRelays: string[] = [];
    
    for (const pubkey of pubkeys) {
      const relayList = relayLists.get(pubkey);
      let writeRelays = (relayList?.write || [])
        .map(normalizeRelayUrl)
        .filter(r => !CONFIG.BLOCKED_RELAYS.has(r));
      
      // Filter out unhealthy relays (dead relays with no recovery due)
      writeRelays = filterHealthyRelays(writeRelays);
      
      if (writeRelays.length === 0) {
        authorsWithoutRelays.push(pubkey);
        continue;
      }
      
      authorsWithRelays.add(pubkey);
      
      // Limit relays per author
      const limitedRelays = writeRelays.slice(0, maxRelaysPerAuthor * 2); // get more candidates
      
      for (const relay of limitedRelays) {
        if (!relayToAuthors.has(relay)) {
          relayToAuthors.set(relay, new Set());
        }
        relayToAuthors.get(relay)!.add(pubkey);
      }
    }
    
    // 3. Add fallback relays for authors without NIP-65
    if (authorsWithoutRelays.length > 0) {
      for (const relay of CONFIG.FALLBACK_RELAYS.map(normalizeRelayUrl)) {
        if (!relayToAuthors.has(relay)) {
          relayToAuthors.set(relay, new Set());
        }
        for (const pubkey of authorsWithoutRelays) {
          relayToAuthors.get(relay)!.add(pubkey);
        }
      }
    }
    
    // 4. Get connected relays and scores
    const connectedRelays = new Set(
      (getConnectionManager()?.getConnectedRelays() || []).map(normalizeRelayUrl)
    );
    
    // 5. Build relay candidates with scores
    const candidates: RelayCandidate[] = [];
    
    for (const [relay, authors] of relayToAuthors) {
      // Get relay score from selector
      const stats = relaySelector.getRelayStats(relay);
      let score = 0.5; // default neutral score
      
      if (stats && stats.queryCount >= 3) {
        const successRate = stats.successCount / (stats.successCount + stats.failureCount);
        const latencyScore = stats.avgLatencyMs > 0 
          ? Math.max(0, 1 - stats.avgLatencyMs / 5000) 
          : 0.5;
        score = successRate * 0.7 + latencyScore * 0.3;
      }
      
      // Boost connected relays
      if (preferConnected && connectedRelays.has(relay)) {
        score = Math.min(1, score + 0.2);
      }
      
      candidates.push({ relay, authors, score });
    }
    
    // 6. Run set cover algorithm
    const allAuthors = new Set(pubkeys);
    const selectedRelays = greedySetCover(candidates, allAuthors, {
      minCoverage,
      maxRelays: maxTotalRelays,
      maxAuthorsPerRelay
    });
    
    // 7. Build query plans, splitting large author lists into chunks
    const queryPlans: RelayQueryPlan[] = [];
    
    for (const { relay, authors, score } of selectedRelays) {
      const authorList = [...authors];
      
      // Split into chunks if too many authors
      for (let i = 0; i < authorList.length; i += maxAuthorsPerRelay) {
        const chunk = authorList.slice(i, i + maxAuthorsPerRelay);
        
        queryPlans.push({
          relay,
          authors: chunk,
          filter: { ...baseFilter, authors: chunk } as NDKFilter,
          score,
          coverage: chunk.length
        });
      }
    }
    
    // 8. Sort by score * coverage (most valuable queries first)
    queryPlans.sort((a, b) => {
      const valueA = a.score * Math.sqrt(a.coverage);
      const valueB = b.score * Math.sqrt(b.coverage);
      return valueB - valueA;
    });
    
    return queryPlans;
  }
  
  /**
   * Execute a query plan with parallel requests and deduplication
   */
  async executeQueryPlan(
    plan: RelayQueryPlan[],
    options: QueryExecutionOptions = {}
  ): Promise<QueryResult> {
    const {
      timeoutMs = CONFIG.DEFAULT_TIMEOUT_MS,
      globalTimeoutMs = CONFIG.DEFAULT_GLOBAL_TIMEOUT_MS,
      maxConcurrent = CONFIG.DEFAULT_MAX_CONCURRENT,
      earlyStopCount,
      onProgress,
      onEvents  // Stream events as they arrive
    } = options;
    
    const startTime = Date.now();
    
    // Metrics tracking
    const metrics: Partial<QueryMetrics> = {
      actualQueryCount: plan.length,
      eventsFound: 0,
      uniqueEvents: 0,
      duplicatesFiltered: 0,
      relaysQueried: [],
      relaysSucceeded: [],
      relaysFailed: [],
      relaysTimedOut: []
    };
    
    // Deduplication
    const seenEventIds = new Set<string>();
    const events: NDKEvent[] = [];
    const eventRelayHints = new Map<string, string[]>();
    
    // Track relay origins for each event
    const addEvent = (event: NDKEvent, relay: string) => {
      if (!event.id) return false;
      
      metrics.eventsFound!++;
      
      // Track relay hint
      const existingHints = eventRelayHints.get(event.id) || [];
      if (!existingHints.includes(relay)) {
        existingHints.push(relay);
        eventRelayHints.set(event.id, existingHints);
      }
      
      // Dedupe
      if (seenEventIds.has(event.id)) {
        metrics.duplicatesFiltered!++;
        return false;
      }
      
      seenEventIds.add(event.id);
      events.push(event);
      metrics.uniqueEvents!++;
      return true;
    };
    
    // Progress tracking
    let completedQueries = 0;
    const reportProgress = () => {
      if (onProgress) {
        onProgress({
          completedQueries,
          totalQueries: plan.length,
          eventsFound: events.length,
          relaysSucceeded: metrics.relaysSucceeded!,
          relaysFailed: metrics.relaysFailed!
        });
      }
    };
    
    // Execute queries in parallel batches
    const globalDeadline = startTime + globalTimeoutMs;
    let shouldStop = false;
    
    for (let i = 0; i < plan.length && !shouldStop; i += maxConcurrent) {
      // Check global timeout
      if (Date.now() > globalDeadline) {
        console.log(`[QueryBatcher] Global timeout reached`);
        break;
      }
      
      // Check early stop
      if (earlyStopCount && events.length >= earlyStopCount) {
        console.log(`[QueryBatcher] Early stop: ${events.length} events found`);
        shouldStop = true;
        break;
      }
      
      const batch = plan.slice(i, i + maxConcurrent);
      
      const batchResults = await Promise.all(
        batch.map(async (query) => {
          const queryStart = Date.now();
          metrics.relaysQueried!.push(query.relay);
          
          try {
            const relaySet = NDKRelaySet.fromRelayUrls([query.relay], this.ndk, true);
            
            // Timeout handling
            const timeoutPromise = new Promise<null>((resolve) => {
              setTimeout(() => resolve(null), timeoutMs);
            });
            
            const fetchPromise = this.ndk.fetchEvents(query.filter, undefined, relaySet);
            
            const result = await Promise.race([fetchPromise, timeoutPromise]);
            
            const latencyMs = Date.now() - queryStart;
            
            if (result === null) {
              // Timeout
              metrics.relaysTimedOut!.push(query.relay);
              recordQueryFailure(query.relay);
              recordRelayTimeout(query.relay);  // Health tracking
              return { relay: query.relay, events: [], success: false, latencyMs };
            }
            
            // Success
            recordQuerySuccess(query.relay, latencyMs);
            recordRelaySuccess(query.relay, latencyMs);  // Health tracking
            metrics.relaysSucceeded!.push(query.relay);
            
            return { 
              relay: query.relay, 
              events: Array.from(result), 
              success: true, 
              latencyMs 
            };
            
          } catch (err) {
            recordQueryFailure(query.relay);
            recordRelayFailure(query.relay);  // Health tracking
            metrics.relaysFailed!.push(query.relay);
            return { 
              relay: query.relay, 
              events: [], 
              success: false, 
              latencyMs: Date.now() - queryStart 
            };
          }
        })
      );
      
      // Collect events from batch and stream them
      for (const result of batchResults) {
        completedQueries++;
        
        const newEvents: NDKEvent[] = [];
        for (const event of result.events) {
          if (addEvent(event, result.relay)) {
            newEvents.push(event);
          }
        }
        
        // Stream new events immediately as they arrive
        if (onEvents && newEvents.length > 0) {
          onEvents(newEvents, result.relay);
        }
      }
      
      reportProgress();
    }
    
    // Sort events by time (newest first)
    events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    
    // Calculate final metrics
    const totalTimeMs = Date.now() - startTime;
    const latencies = metrics.relaysSucceeded!.map(r => {
      const stats = relaySelector.getRelayStats(r);
      return stats?.avgLatencyMs || 0;
    }).filter(l => l > 0);
    
    const finalMetrics: QueryMetrics = {
      naiveQueryCount: 0, // will be set by caller
      actualQueryCount: plan.length,
      connectionsSaved: 0,
      savingsPercent: 0,
      totalAuthors: 0,
      authorsCovered: 0,
      coveragePercent: 0,
      totalTimeMs,
      planningTimeMs: 0, // will be set by caller
      executionTimeMs: totalTimeMs,
      avgLatencyMs: latencies.length > 0 
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length 
        : 0,
      eventsFound: metrics.eventsFound!,
      uniqueEvents: events.length,
      duplicatesFiltered: metrics.duplicatesFiltered!,
      relaysQueried: metrics.relaysQueried!,
      relaysSucceeded: metrics.relaysSucceeded!,
      relaysFailed: metrics.relaysFailed!,
      relaysTimedOut: metrics.relaysTimedOut!
    };
    
    return { events, metrics: finalMetrics, eventRelayHints };
  }
  
  /**
   * Convenience method: create plan and execute in one call
   */
  async batchQuery(
    pubkeys: string[],
    baseFilter: Omit<NDKFilter, 'authors'>,
    options: QueryPlanOptions & QueryExecutionOptions = {}
  ): Promise<QueryResult> {
    const planStart = Date.now();
    
    const plan = await this.createQueryPlan(pubkeys, baseFilter, options);
    
    const planningTimeMs = Date.now() - planStart;
    
    const result = await this.executeQueryPlan(plan, options);
    
    // Calculate efficiency metrics
    const naiveQueryCount = pubkeys.length * (options.maxRelaysPerAuthor || CONFIG.DEFAULT_MAX_RELAYS_PER_AUTHOR);
    const connectionsSaved = naiveQueryCount - plan.length;
    
    // Count covered authors
    const coveredAuthors = new Set(plan.flatMap(p => p.authors));
    
    // Update metrics
    result.metrics.naiveQueryCount = naiveQueryCount;
    result.metrics.connectionsSaved = connectionsSaved;
    result.metrics.savingsPercent = naiveQueryCount > 0 
      ? Math.round((connectionsSaved / naiveQueryCount) * 100) 
      : 0;
    result.metrics.totalAuthors = pubkeys.length;
    result.metrics.authorsCovered = coveredAuthors.size;
    result.metrics.coveragePercent = pubkeys.length > 0 
      ? Math.round((coveredAuthors.size / pubkeys.length) * 100) 
      : 100;
    result.metrics.planningTimeMs = planningTimeMs;
    result.metrics.totalTimeMs = planningTimeMs + result.metrics.executionTimeMs;
    
    console.log(
      `[QueryBatcher] Completed: ${plan.length} queries (saved ${connectionsSaved} connections, ` +
      `${result.metrics.savingsPercent}% reduction), ` +
      `${result.metrics.uniqueEvents} unique events in ${result.metrics.totalTimeMs}ms`
    );
    
    return result;
  }
  
  /**
   * Execute query plan with streaming - fires all queries at once and 
   * streams results as they arrive (doesn't wait for batches)
   * 
   * This provides the fastest time-to-first-result for UI updates.
   */
  async executeQueryPlanStreaming(
    plan: RelayQueryPlan[],
    options: {
      timeoutMs?: number;
      globalTimeoutMs?: number;
      onEvents: (events: NDKEvent[], relay: string, isComplete: boolean) => void;
      onComplete?: (metrics: QueryMetrics) => void;
    }
  ): Promise<void> {
    const {
      timeoutMs = CONFIG.DEFAULT_TIMEOUT_MS,
      globalTimeoutMs = CONFIG.DEFAULT_GLOBAL_TIMEOUT_MS,
      onEvents,
      onComplete
    } = options;
    
    const startTime = Date.now();
    
    // Metrics tracking
    const metrics: Partial<QueryMetrics> = {
      actualQueryCount: plan.length,
      eventsFound: 0,
      uniqueEvents: 0,
      duplicatesFiltered: 0,
      relaysQueried: plan.map(p => p.relay),
      relaysSucceeded: [],
      relaysFailed: [],
      relaysTimedOut: []
    };
    
    // Deduplication
    const seenEventIds = new Set<string>();
    let totalEvents = 0;
    
    // Track completion
    let completedQueries = 0;
    let timedOut = false;
    
    // Global timeout
    const globalTimeout = setTimeout(() => {
      timedOut = true;
      console.log(`[QueryBatcher] Streaming global timeout`);
      finalize();
    }, globalTimeoutMs);
    
    const finalize = () => {
      clearTimeout(globalTimeout);
      
      if (onComplete) {
        const finalMetrics: QueryMetrics = {
          naiveQueryCount: 0,
          actualQueryCount: plan.length,
          connectionsSaved: 0,
          savingsPercent: 0,
          totalAuthors: 0,
          authorsCovered: 0,
          coveragePercent: 0,
          totalTimeMs: Date.now() - startTime,
          planningTimeMs: 0,
          executionTimeMs: Date.now() - startTime,
          avgLatencyMs: 0,
          eventsFound: metrics.eventsFound!,
          uniqueEvents: totalEvents,
          duplicatesFiltered: metrics.duplicatesFiltered!,
          relaysQueried: metrics.relaysQueried!,
          relaysSucceeded: metrics.relaysSucceeded!,
          relaysFailed: metrics.relaysFailed!,
          relaysTimedOut: metrics.relaysTimedOut!
        };
        
        onComplete(finalMetrics);
      }
    };
    
    // Fire ALL queries at once (no batching for fastest results)
    const queryPromises = plan.map(async (query) => {
      if (timedOut) return;
      
      const queryStart = Date.now();
      
      try {
        const relaySet = NDKRelaySet.fromRelayUrls([query.relay], this.ndk, true);
        
        // Timeout handling
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), timeoutMs);
        });
        
        const fetchPromise = this.ndk.fetchEvents(query.filter, undefined, relaySet);
        
        const result = await Promise.race([fetchPromise, timeoutPromise]);
        
        const latencyMs = Date.now() - queryStart;
        
        if (timedOut) return; // Global timeout hit while waiting
        
        if (result === null) {
          // Per-relay timeout
          metrics.relaysTimedOut!.push(query.relay);
          recordQueryFailure(query.relay);
          recordRelayTimeout(query.relay);  // Health tracking
        } else {
          // Success - stream events immediately!
          recordQuerySuccess(query.relay, latencyMs);
          recordRelaySuccess(query.relay, latencyMs);  // Health tracking
          metrics.relaysSucceeded!.push(query.relay);
          
          const events = Array.from(result);
          const newEvents: NDKEvent[] = [];
          
          for (const event of events) {
            if (!event.id) continue;
            
            metrics.eventsFound!++;
            
            if (seenEventIds.has(event.id)) {
              metrics.duplicatesFiltered!++;
              continue;
            }
            
            seenEventIds.add(event.id);
            newEvents.push(event);
            totalEvents++;
          }
          
          // Stream to UI immediately!
          if (newEvents.length > 0) {
            onEvents(newEvents, query.relay, false);
          }
        }
        
      } catch (err) {
        if (!timedOut) {
          metrics.relaysFailed!.push(query.relay);
          recordQueryFailure(query.relay);
          recordRelayFailure(query.relay);  // Health tracking
        }
      } finally {
        completedQueries++;
        
        // Check if all queries complete
        if (completedQueries >= plan.length && !timedOut) {
          // Final callback with empty array to signal completion
          onEvents([], '', true);
          finalize();
        }
      }
    });
    
    // Don't await - let them all run in parallel
    Promise.allSettled(queryPromises);
  }
  
  /**
   * Convenience method: streaming batch query
   * 
   * Creates plan and executes with streaming in one call.
   */
  async batchQueryStreaming(
    pubkeys: string[],
    baseFilter: Omit<NDKFilter, 'authors'>,
    options: QueryPlanOptions & {
      timeoutMs?: number;
      globalTimeoutMs?: number;
      onEvents: (events: NDKEvent[], relay: string, isComplete: boolean) => void;
      onComplete?: (metrics: QueryMetrics) => void;
    }
  ): Promise<void> {
    const plan = await this.createQueryPlan(pubkeys, baseFilter, options);
    
    console.log(`[QueryBatcher] Streaming ${plan.length} queries for ${pubkeys.length} authors`);
    
    await this.executeQueryPlanStreaming(plan, options);
  }
}

// ═══════════════════════════════════════════════════════════════
// STANDALONE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a query batcher with the global NDK instance
 */
export function createQueryBatcher(ndk: NDK): QueryBatcher {
  return new QueryBatcher(ndk);
}

/**
 * Analyze potential savings for a set of pubkeys without executing
 */
export async function analyzeQueryEfficiency(
  pubkeys: string[],
  maxRelaysPerAuthor: number = 2
): Promise<{
  naiveQueries: number;
  optimizedQueries: number;
  savingsPercent: number;
  relayBreakdown: Array<{ relay: string; authorCount: number }>;
}> {
  // Get relay lists
  const relayLists = await relayListCache.getMany(pubkeys);
  
  // Build relay -> authors mapping
  const relayToAuthors = new Map<string, Set<string>>();
  
  for (const [pubkey, relayList] of relayLists) {
    const writeRelays = (relayList?.write || [])
      .map(normalizeRelayUrl)
      .filter(r => !CONFIG.BLOCKED_RELAYS.has(r))
      .slice(0, maxRelaysPerAuthor);
    
    for (const relay of writeRelays) {
      if (!relayToAuthors.has(relay)) {
        relayToAuthors.set(relay, new Set());
      }
      relayToAuthors.get(relay)!.add(pubkey);
    }
  }
  
  // Add fallback for authors without relays
  const authorsWithoutRelays = pubkeys.filter(pk => {
    const list = relayLists.get(pk);
    return !list || list.write.length === 0;
  });
  
  if (authorsWithoutRelays.length > 0) {
    for (const relay of CONFIG.FALLBACK_RELAYS.map(normalizeRelayUrl)) {
      if (!relayToAuthors.has(relay)) {
        relayToAuthors.set(relay, new Set());
      }
      for (const pubkey of authorsWithoutRelays) {
        relayToAuthors.get(relay)!.add(pubkey);
      }
    }
  }
  
  // Naive: each author queries maxRelaysPerAuthor relays
  const naiveQueries = pubkeys.length * maxRelaysPerAuthor;
  
  // Optimized: use set cover
  const candidates: RelayCandidate[] = [...relayToAuthors.entries()].map(([relay, authors]) => ({
    relay,
    authors,
    score: 0.5
  }));
  
  const selected = greedySetCover(candidates, new Set(pubkeys), {
    minCoverage: 1,
    maxRelays: 20,
    maxAuthorsPerRelay: 50
  });
  
  const optimizedQueries = selected.length;
  const savingsPercent = naiveQueries > 0 
    ? Math.round(((naiveQueries - optimizedQueries) / naiveQueries) * 100) 
    : 0;
  
  // Build breakdown
  const relayBreakdown = selected
    .map(s => ({ relay: s.relay, authorCount: s.authors.size }))
    .sort((a, b) => b.authorCount - a.authorCount);
  
  return {
    naiveQueries,
    optimizedQueries,
    savingsPercent,
    relayBreakdown
  };
}

/**
 * Get relay hints for an event (which relays to use for fetching related content)
 */
export function getRelayHintsForEvent(
  eventId: string,
  eventRelayHints: Map<string, string[]>
): string[] {
  return eventRelayHints.get(eventId) || [];
}

/**
 * Deduplicate events by ID
 */
export function deduplicateEvents(events: NDKEvent[]): NDKEvent[] {
  const seen = new Set<string>();
  const unique: NDKEvent[] = [];
  
  for (const event of events) {
    if (event.id && !seen.has(event.id)) {
      seen.add(event.id);
      unique.push(event);
    }
  }
  
  return unique;
}

/**
 * Merge events from multiple sources with deduplication
 */
export function mergeEventArrays(...arrays: NDKEvent[][]): NDKEvent[] {
  const all = arrays.flat();
  const deduped = deduplicateEvents(all);
  
  // Sort by time (newest first)
  deduped.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  
  return deduped;
}

