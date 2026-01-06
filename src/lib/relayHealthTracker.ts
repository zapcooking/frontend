/**
 * Relay Health Tracker
 * 
 * Automatically tracks relay health and filters out dead/slow relays.
 * 
 * Features:
 * - Success/failure/timeout tracking
 * - Health status calculation (healthy, degraded, dead, unknown)
 * - Auto-recovery with exponential backoff
 * - Persistence to IndexedDB
 * - Integration with query flow
 */

import { browser } from '$app/environment';
import { normalizeRelayUrl } from './relayListCache';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type RelayStatus = 'healthy' | 'degraded' | 'dead' | 'unknown';

export interface RelayHealthStats {
  url: string;
  
  // Success/failure tracking
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  consecutiveFailures: number;
  
  // Timing
  avgResponseTimeMs: number;
  lastResponseTimeMs: number;
  totalResponseTimeMs: number;  // for weighted average
  
  // Timestamps
  lastSuccessAt: number;
  lastFailureAt: number;
  lastAttemptAt: number;
  firstSeenAt: number;
  
  // Recovery tracking
  recoveryAttempts: number;
  nextRecoveryAt: number;      // when to try again if dead
  
  // Computed (stored for quick access)
  successRate: number;
  status: RelayStatus;
}

export interface RelayHealthFilter {
  minSuccessRate?: number;           // default 0.3
  maxConsecutiveFailures?: number;   // default 5
  maxAvgResponseTimeMs?: number;     // default 8000
  excludeDead?: boolean;             // default true
  excludeDegraded?: boolean;         // default false
  allowRecoveryAttempts?: boolean;   // default true
}

export interface RelayHealthReport {
  url: string;
  status: RelayStatus;
  successRate: string;
  avgResponseTime: string;
  consecutiveFailures: number;
  lastSuccess: string;
  lastFailure: string;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // IndexedDB
  DB_NAME: 'zapcooking-relay-health',
  DB_VERSION: 1,
  STORE_NAME: 'health-stats',
  
  // Health thresholds
  DEAD_CONSECUTIVE_FAILURES: 5,
  DEAD_MIN_ATTEMPTS_FOR_ZERO_RATE: 10,
  DEGRADED_SUCCESS_RATE: 0.5,
  DEGRADED_AVG_RESPONSE_MS: 5000,
  MIN_ATTEMPTS_FOR_STATUS: 3,
  
  // Response time weighting (recent responses matter more)
  RESPONSE_TIME_WEIGHT: 0.3,
  
  // Recovery backoff
  INITIAL_RECOVERY_DELAY_MS: 60 * 60 * 1000,        // 1 hour
  MAX_RECOVERY_DELAY_MS: 24 * 60 * 60 * 1000,       // 24 hours
  RECOVERY_BACKOFF_MULTIPLIER: 2,
  
  // Data management
  MAX_TRACKED_RELAYS: 300,
  STATS_DECAY_AGE_MS: 24 * 60 * 60 * 1000,          // 24 hours
  STATS_DECAY_FACTOR: 0.7,                           // reduce old stats by 30%
  PERSIST_INTERVAL_MS: 30 * 1000,                    // persist every 30 seconds
  
  // Default filter options
  DEFAULT_MIN_SUCCESS_RATE: 0.3,
  DEFAULT_MAX_CONSECUTIVE_FAILURES: 5,
  DEFAULT_MAX_AVG_RESPONSE_MS: 8000
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
        console.warn('[RelayHealth] IndexedDB open failed:', request.error);
        resolve(null);
      };
      
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        
        if (!database.objectStoreNames.contains(CONFIG.STORE_NAME)) {
          const store = database.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'url' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('lastAttemptAt', 'lastAttemptAt', { unique: false });
          store.createIndex('successRate', 'successRate', { unique: false });
        }
      };
      
      request.onsuccess = () => {
        db = request.result;
        
        db.onerror = (event) => {
          console.warn('[RelayHealth] IndexedDB error:', event);
        };
        
        db.onclose = () => {
          db = null;
          dbInitPromise = null;
        };
        
        resolve(db);
      };
    } catch (err) {
      console.warn('[RelayHealth] IndexedDB init error:', err);
      resolve(null);
    }
  });
  
  return dbInitPromise;
}

async function loadAllStats(): Promise<Map<string, RelayHealthStats>> {
  const stats = new Map<string, RelayHealthStats>();
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
        console.warn('[RelayHealth] Failed to load stats:', request.error);
        resolve(stats);
      };
    } catch (err) {
      console.warn('[RelayHealth] loadAllStats error:', err);
      resolve(stats);
    }
  });
}

async function saveAllStats(stats: Map<string, RelayHealthStats>): Promise<void> {
  const database = await initDB();
  if (!database) return;
  
  return new Promise((resolve) => {
    try {
      const tx = database.transaction(CONFIG.STORE_NAME, 'readwrite');
      const store = tx.objectStore(CONFIG.STORE_NAME);
      
      // Limit stored relays
      const sortedStats = [...stats.values()]
        .sort((a, b) => b.lastAttemptAt - a.lastAttemptAt)
        .slice(0, CONFIG.MAX_TRACKED_RELAYS);
      
      store.clear();
      
      for (const stat of sortedStats) {
        store.put(stat);
      }
      
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn('[RelayHealth] Failed to save stats:', tx.error);
        resolve();
      };
    } catch (err) {
      console.warn('[RelayHealth] saveAllStats error:', err);
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
// HEALTH CALCULATION
// ═══════════════════════════════════════════════════════════════

function calculateSuccessRate(stats: RelayHealthStats): number {
  const total = stats.successCount + stats.failureCount + stats.timeoutCount;
  if (total === 0) return 0;
  return stats.successCount / total;
}

function calculateStatus(stats: RelayHealthStats): RelayStatus {
  const totalAttempts = stats.successCount + stats.failureCount + stats.timeoutCount;
  
  // Dead: 5+ consecutive failures
  if (stats.consecutiveFailures >= CONFIG.DEAD_CONSECUTIVE_FAILURES) {
    return 'dead';
  }
  
  // Dead: 0% success rate with 10+ attempts
  if (stats.successRate === 0 && totalAttempts >= CONFIG.DEAD_MIN_ATTEMPTS_FOR_ZERO_RATE) {
    return 'dead';
  }
  
  // Unknown: fewer than 3 attempts
  if (totalAttempts < CONFIG.MIN_ATTEMPTS_FOR_STATUS) {
    return 'unknown';
  }
  
  // Degraded: < 50% success rate
  if (stats.successRate < CONFIG.DEGRADED_SUCCESS_RATE) {
    return 'degraded';
  }
  
  // Degraded: avg response > 5000ms
  if (stats.avgResponseTimeMs > CONFIG.DEGRADED_AVG_RESPONSE_MS) {
    return 'degraded';
  }
  
  return 'healthy';
}

function calculateNextRecoveryTime(stats: RelayHealthStats): number {
  if (stats.status !== 'dead') return 0;
  
  // Exponential backoff: 1hr, 2hr, 4hr, 8hr, 16hr, max 24hr
  const attempts = stats.recoveryAttempts || 0;
  const delay = Math.min(
    CONFIG.INITIAL_RECOVERY_DELAY_MS * Math.pow(CONFIG.RECOVERY_BACKOFF_MULTIPLIER, attempts),
    CONFIG.MAX_RECOVERY_DELAY_MS
  );
  
  return (stats.lastFailureAt || Date.now()) + delay;
}

function updateAvgResponseTime(current: number, newTime: number): number {
  if (current === 0) return newTime;
  // Exponential moving average - recent times weighted more
  return current * (1 - CONFIG.RESPONSE_TIME_WEIGHT) + newTime * CONFIG.RESPONSE_TIME_WEIGHT;
}

// ═══════════════════════════════════════════════════════════════
// RELAY HEALTH TRACKER CLASS
// ═══════════════════════════════════════════════════════════════

class RelayHealthTrackerImpl {
  private stats = new Map<string, RelayHealthStats>();
  private statsLoaded = false;
  private loadPromise: Promise<void> | null = null;
  private dirty = false;
  private lastDecayTime = 0;
  
  constructor() {
    if (browser) {
      this.loadStats();
      
      // Periodic persistence
      setInterval(() => {
        if (this.dirty) {
          this.persistStats();
        }
      }, CONFIG.PERSIST_INTERVAL_MS);
      
      // Periodic decay of old stats
      setInterval(() => {
        this.decayOldStats();
      }, CONFIG.STATS_DECAY_AGE_MS);
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
      console.debug(`[RelayHealth] Loaded stats for ${this.stats.size} relays`);
    })();
    
    return this.loadPromise;
  }
  
  private async persistStats(): Promise<void> {
    if (!this.dirty) return;
    
    await saveAllStats(this.stats);
    this.dirty = false;
    console.debug(`[RelayHealth] Persisted stats for ${this.stats.size} relays`);
  }
  
  private getOrCreateStats(url: string): RelayHealthStats {
    const normalized = normalizeRelayUrl(url);
    
    if (!this.stats.has(normalized)) {
      const now = Date.now();
      this.stats.set(normalized, {
        url: normalized,
        successCount: 0,
        failureCount: 0,
        timeoutCount: 0,
        consecutiveFailures: 0,
        avgResponseTimeMs: 0,
        lastResponseTimeMs: 0,
        totalResponseTimeMs: 0,
        lastSuccessAt: 0,
        lastFailureAt: 0,
        lastAttemptAt: 0,
        firstSeenAt: now,
        recoveryAttempts: 0,
        nextRecoveryAt: 0,
        successRate: 0,
        status: 'unknown'
      });
    }
    
    return this.stats.get(normalized)!;
  }
  
  private decayOldStats(): void {
    const now = Date.now();
    const cutoff = now - CONFIG.STATS_DECAY_AGE_MS;
    
    for (const stats of this.stats.values()) {
      // Only decay if last attempt was more than 24 hours ago
      if (stats.lastAttemptAt < cutoff && stats.lastAttemptAt > 0) {
        stats.successCount = Math.floor(stats.successCount * CONFIG.STATS_DECAY_FACTOR);
        stats.failureCount = Math.floor(stats.failureCount * CONFIG.STATS_DECAY_FACTOR);
        stats.timeoutCount = Math.floor(stats.timeoutCount * CONFIG.STATS_DECAY_FACTOR);
        
        // Recalculate
        stats.successRate = calculateSuccessRate(stats);
        stats.status = calculateStatus(stats);
        
        this.dirty = true;
      }
    }
    
    this.lastDecayTime = now;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API - Recording
  // ═══════════════════════════════════════════════════════════════
  
  recordSuccess(url: string, responseTimeMs: number): void {
    const stats = this.getOrCreateStats(url);
    const now = Date.now();
    
    stats.successCount++;
    stats.consecutiveFailures = 0;
    stats.lastResponseTimeMs = responseTimeMs;
    stats.totalResponseTimeMs += responseTimeMs;
    stats.avgResponseTimeMs = updateAvgResponseTime(stats.avgResponseTimeMs, responseTimeMs);
    stats.lastSuccessAt = now;
    stats.lastAttemptAt = now;
    
    // Recovery successful - reset recovery tracking
    if (stats.status === 'dead') {
      console.log(`[RelayHealth] 🔄 ${url} recovered!`);
      stats.recoveryAttempts = 0;
      stats.nextRecoveryAt = 0;
    }
    
    // Update computed fields
    stats.successRate = calculateSuccessRate(stats);
    stats.status = calculateStatus(stats);
    
    this.dirty = true;
  }
  
  recordFailure(url: string, error?: string): void {
    const stats = this.getOrCreateStats(url);
    const now = Date.now();
    
    stats.failureCount++;
    stats.consecutiveFailures++;
    stats.lastFailureAt = now;
    stats.lastAttemptAt = now;
    
    // Update computed fields
    stats.successRate = calculateSuccessRate(stats);
    const previousStatus = stats.status;
    stats.status = calculateStatus(stats);
    
    // If became dead, calculate next recovery time
    if (stats.status === 'dead' && previousStatus !== 'dead') {
      stats.nextRecoveryAt = calculateNextRecoveryTime(stats);
      console.warn(`[RelayHealth] ☠️ ${url} marked dead. Next recovery at: ${new Date(stats.nextRecoveryAt).toLocaleTimeString()}`);
    }
    
    // If was already dead and failed again during recovery attempt
    if (previousStatus === 'dead') {
      stats.recoveryAttempts++;
      stats.nextRecoveryAt = calculateNextRecoveryTime(stats);
      console.warn(`[RelayHealth] ☠️ ${url} recovery failed (attempt ${stats.recoveryAttempts}). Next try: ${new Date(stats.nextRecoveryAt).toLocaleTimeString()}`);
    }
    
    this.dirty = true;
  }
  
  recordTimeout(url: string): void {
    const stats = this.getOrCreateStats(url);
    const now = Date.now();
    
    stats.timeoutCount++;
    stats.failureCount++;  // Timeouts count as failures
    stats.consecutiveFailures++;
    stats.lastFailureAt = now;
    stats.lastAttemptAt = now;
    
    // Update computed fields
    stats.successRate = calculateSuccessRate(stats);
    const previousStatus = stats.status;
    stats.status = calculateStatus(stats);
    
    // Same dead/recovery logic as recordFailure
    if (stats.status === 'dead' && previousStatus !== 'dead') {
      stats.nextRecoveryAt = calculateNextRecoveryTime(stats);
      console.warn(`[RelayHealth] ☠️ ${url} marked dead (timeout). Next recovery: ${new Date(stats.nextRecoveryAt).toLocaleTimeString()}`);
    }
    
    if (previousStatus === 'dead') {
      stats.recoveryAttempts++;
      stats.nextRecoveryAt = calculateNextRecoveryTime(stats);
    }
    
    this.dirty = true;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API - Query Health
  // ═══════════════════════════════════════════════════════════════
  
  getHealth(url: string): RelayHealthStats | null {
    const normalized = normalizeRelayUrl(url);
    return this.stats.get(normalized) || null;
  }
  
  isHealthy(url: string): boolean {
    const stats = this.getHealth(url);
    if (!stats) return true; // Unknown relays are given a chance
    return stats.status === 'healthy' || stats.status === 'unknown';
  }
  
  isDead(url: string): boolean {
    const stats = this.getHealth(url);
    return stats?.status === 'dead' || false;
  }
  
  /**
   * Check if a dead relay is due for a recovery attempt
   */
  shouldAttemptRecovery(url: string): boolean {
    const stats = this.getHealth(url);
    if (!stats || stats.status !== 'dead') return false;
    
    return Date.now() >= stats.nextRecoveryAt;
  }
  
  /**
   * Get healthy relays from a list
   */
  getHealthyRelays(urls: string[]): string[] {
    return urls.filter(url => this.isHealthy(url));
  }
  
  /**
   * Filter relays by health criteria
   */
  filterByHealth(urls: string[], options: RelayHealthFilter = {}): string[] {
    const {
      minSuccessRate = CONFIG.DEFAULT_MIN_SUCCESS_RATE,
      maxConsecutiveFailures = CONFIG.DEFAULT_MAX_CONSECUTIVE_FAILURES,
      maxAvgResponseTimeMs = CONFIG.DEFAULT_MAX_AVG_RESPONSE_MS,
      excludeDead = true,
      excludeDegraded = false,
      allowRecoveryAttempts = true
    } = options;
    
    const now = Date.now();
    
    return urls.filter(url => {
      const normalized = normalizeRelayUrl(url);
      const stats = this.stats.get(normalized);
      
      // Unknown relays pass (give them a chance)
      if (!stats) return true;
      
      // Check if dead relay is due for recovery attempt
      if (stats.status === 'dead') {
        if (allowRecoveryAttempts && now >= stats.nextRecoveryAt) {
          console.log(`[RelayHealth] 🔄 Attempting recovery for ${url}`);
          return true; // Allow one recovery attempt
        }
        return !excludeDead;
      }
      
      // Exclude degraded if requested
      if (excludeDegraded && stats.status === 'degraded') {
        return false;
      }
      
      // Check success rate
      const totalAttempts = stats.successCount + stats.failureCount + stats.timeoutCount;
      if (totalAttempts >= CONFIG.MIN_ATTEMPTS_FOR_STATUS && stats.successRate < minSuccessRate) {
        return false;
      }
      
      // Check consecutive failures
      if (stats.consecutiveFailures >= maxConsecutiveFailures) {
        return false;
      }
      
      // Check response time
      if (stats.avgResponseTimeMs > 0 && stats.avgResponseTimeMs > maxAvgResponseTimeMs) {
        return false;
      }
      
      return true;
    });
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API - Manual Controls
  // ═══════════════════════════════════════════════════════════════
  
  markDead(url: string): void {
    const stats = this.getOrCreateStats(url);
    stats.status = 'dead';
    stats.consecutiveFailures = CONFIG.DEAD_CONSECUTIVE_FAILURES;
    stats.nextRecoveryAt = calculateNextRecoveryTime(stats);
    this.dirty = true;
    
    console.warn(`[RelayHealth] ☠️ ${url} manually marked dead`);
  }
  
  resetStats(url: string): void {
    const normalized = normalizeRelayUrl(url);
    this.stats.delete(normalized);
    this.dirty = true;
    
    console.log(`[RelayHealth] 🔄 Stats reset for ${url}`);
  }
  
  async resetAll(): Promise<void> {
    this.stats.clear();
    this.dirty = false;
    await clearStatsDB();
    
    console.log(`[RelayHealth] 🔄 All stats reset`);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API - Reporting
  // ═══════════════════════════════════════════════════════════════
  
  getAllStats(): Map<string, RelayHealthStats> {
    return new Map(this.stats);
  }
  
  getHealthReport(): RelayHealthReport[] {
    return [...this.stats.values()]
      .sort((a, b) => b.successRate - a.successRate)
      .map(stats => ({
        url: stats.url,
        status: stats.status,
        successRate: `${(stats.successRate * 100).toFixed(1)}%`,
        avgResponseTime: stats.avgResponseTimeMs > 0 ? `${stats.avgResponseTimeMs.toFixed(0)}ms` : 'N/A',
        consecutiveFailures: stats.consecutiveFailures,
        lastSuccess: stats.lastSuccessAt ? new Date(stats.lastSuccessAt).toISOString() : 'never',
        lastFailure: stats.lastFailureAt ? new Date(stats.lastFailureAt).toISOString() : 'never'
      }));
  }
  
  getSummary(): {
    total: number;
    healthy: number;
    degraded: number;
    dead: number;
    unknown: number;
  } {
    const summary = { total: 0, healthy: 0, degraded: 0, dead: 0, unknown: 0 };
    
    for (const stats of this.stats.values()) {
      summary.total++;
      summary[stats.status]++;
    }
    
    return summary;
  }
  
  /**
   * Log health report to console (for debugging)
   */
  logHealthReport(): void {
    const report = this.getHealthReport();
    const summary = this.getSummary();
    
    console.log(`\n[RelayHealth] ══════════════════════════════════════`);
    console.log(`Total: ${summary.total} | Healthy: ${summary.healthy} | Degraded: ${summary.degraded} | Dead: ${summary.dead} | Unknown: ${summary.unknown}`);
    console.table(report);
    console.log(`══════════════════════════════════════════════════════\n`);
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const relayHealthTracker = new RelayHealthTrackerImpl();

// ═══════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Filter relays by health before making queries
 */
export function filterHealthyRelays(urls: string[], options?: RelayHealthFilter): string[] {
  return relayHealthTracker.filterByHealth(urls, options);
}

/**
 * Check if a relay should be used
 */
export function isRelayHealthy(url: string): boolean {
  return relayHealthTracker.isHealthy(url);
}

/**
 * Record a successful query (call from fetch functions)
 */
export function recordRelaySuccess(url: string, responseTimeMs: number): void {
  relayHealthTracker.recordSuccess(url, responseTimeMs);
}

/**
 * Record a failed query
 */
export function recordRelayFailure(url: string, error?: string): void {
  relayHealthTracker.recordFailure(url, error);
}

/**
 * Record a timeout
 */
export function recordRelayTimeout(url: string): void {
  relayHealthTracker.recordTimeout(url);
}

/**
 * Get health summary for debugging
 */
export function getRelayHealthSummary() {
  return relayHealthTracker.getSummary();
}

/**
 * Log health report to console
 */
export function logRelayHealth(): void {
  relayHealthTracker.logHealthReport();
}

/**
 * Get list of dead relays (for debugging)
 */
export function getDeadRelays(): string[] {
  const stats = relayHealthTracker.getAllStats();
  return [...stats.values()]
    .filter(s => s.status === 'dead')
    .map(s => s.url);
}

/**
 * Get list of healthy relays from the tracked set
 */
export function getKnownHealthyRelays(): string[] {
  const stats = relayHealthTracker.getAllStats();
  return [...stats.values()]
    .filter(s => s.status === 'healthy')
    .map(s => s.url);
}

/**
 * Wrapper for NDK queries that automatically tracks health
 * 
 * Usage:
 * ```typescript
 * const result = await queryWithHealthTracking(
 *   relay,
 *   async () => ndk.fetchEvents(filter, undefined, relaySet),
 *   5000 // timeout
 * );
 * ```
 */
export async function queryWithHealthTracking<T>(
  relayUrl: string,
  queryFn: () => Promise<T>,
  timeoutMs: number = 5000
): Promise<{ success: true; data: T; latencyMs: number } | { success: false; error: string; latencyMs: number }> {
  const startTime = Date.now();
  
  try {
    // Race against timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
    });
    
    const result = await Promise.race([queryFn(), timeoutPromise]);
    
    const latencyMs = Date.now() - startTime;
    relayHealthTracker.recordSuccess(relayUrl, latencyMs);
    
    return { success: true, data: result, latencyMs };
    
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    
    if (errorMessage === 'TIMEOUT') {
      relayHealthTracker.recordTimeout(relayUrl);
    } else {
      relayHealthTracker.recordFailure(relayUrl, errorMessage);
    }
    
    return { success: false, error: errorMessage, latencyMs };
  }
}

/**
 * Filter and sort relays by health before making a query
 * Returns relays sorted by health score (best first)
 */
export function sortRelaysByHealth(urls: string[]): string[] {
  const stats = relayHealthTracker.getAllStats();
  
  return [...urls].sort((a, b) => {
    const statsA = stats.get(a);
    const statsB = stats.get(b);
    
    // Unknown relays go to the middle
    if (!statsA && !statsB) return 0;
    if (!statsA) return 0;
    if (!statsB) return 0;
    
    // Status priority: healthy > unknown > degraded > dead
    const statusOrder = { healthy: 0, unknown: 1, degraded: 2, dead: 3 };
    const statusDiff = statusOrder[statsA.status] - statusOrder[statsB.status];
    if (statusDiff !== 0) return statusDiff;
    
    // Within same status, sort by success rate
    const rateDiff = statsB.successRate - statsA.successRate;
    if (Math.abs(rateDiff) > 0.1) return rateDiff;
    
    // Then by latency
    return statsA.avgResponseTimeMs - statsB.avgResponseTimeMs;
  });
}

/**
 * Create optimized relay list:
 * 1. Filter out dead relays (unless recovery due)
 * 2. Sort by health score
 * 3. Limit to specified count
 */
export function getOptimizedRelays(urls: string[], maxCount: number = 10): string[] {
  const healthy = filterHealthyRelays(urls);
  const sorted = sortRelaysByHealth(healthy);
  return sorted.slice(0, maxCount);
}

