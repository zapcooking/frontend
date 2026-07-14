import type NDK from '@nostr-dev-kit/ndk';
import { NDKRelaySet, NDKRelayStatus } from '@nostr-dev-kit/ndk';

/**
 * Number of connected relays that counts as "ready" for a pool of `total` relays.
 * All-connected always qualifies (the target is never above `total`); otherwise
 * max(2, ceil(fraction·total)), clamped to `total` so a single-relay pool
 * (members mode) still waits for its one relay rather than an impossible 2.
 */
export function relayQuorumTarget(total: number, fraction = 0.6): number {
  return Math.min(total, Math.max(2, Math.ceil(fraction * total)));
}

export interface RelayHealth {
  status: 'connected' | 'disconnected' | 'degraded' | 'circuit-open';
  lastSeen: number;
  failures: number;
  responseTime?: number;
  circuitBreaker: {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
  };
}

export interface ConnectionMetrics {
  totalConnections: number;
  successfulConnections: number;
  failedConnections: number;
  averageResponseTime: number;
  circuitBreakerTrips: number;
}

export class ConnectionManager {
  /** Reference to the NDK instance this manager is bound to */
  public readonly ndkRef: NDK;
  
  /** Flag to indicate this manager has been destroyed and should not process events */
  private destroyed = false;
  
  private relayHealth = new Map<string, RelayHealth>();
  private heartbeatIntervals = new Map<string, NodeJS.Timeout>();
  private connectionMetrics: ConnectionMetrics = {
    totalConnections: 0,
    successfulConnections: 0,
    failedConnections: 0,
    averageResponseTime: 0,
    circuitBreakerTrips: 0
  };
  
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly MAX_RESPONSE_TIME = 5000; // 5 seconds for degraded status
  private readonly QUORUM_FRACTION = 0.6;
  private readonly QUORUM_TIMEOUT_MS = 4000;

  constructor(ndk: NDK) {
    this.ndkRef = ndk;
    this.initializeRelayHealth();
    this.setupEventListeners();
  }

  private initializeRelayHealth() {
    // Initialize health tracking for all configured relays
    const outboxRelayUrls: string[] = Array.isArray((this.ndkRef as any).outboxRelayUrls)
      ? (this.ndkRef as any).outboxRelayUrls
      : [];
    const relayUrls = [
      ...this.ndkRef.explicitRelayUrls || [],
      ...outboxRelayUrls
    ];

    console.log('🔧 Initializing relay health for URLs:', relayUrls);

    if (relayUrls.length === 0) {
      console.warn('⚠️ No relay URLs configured in NDK instance');
      // Add some default relays if none are configured
      const defaultRelays = [
        'wss://purplepag.es',
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://nostr.mom',
        'wss://relay.primal.net'
      ];
      relayUrls.push(...defaultRelays);
      console.log('🔧 Using default relays:', defaultRelays);
    }

    relayUrls.forEach(url => {
      this.relayHealth.set(url, {
        status: 'disconnected',
        lastSeen: 0,
        failures: 0,
        circuitBreaker: {
          failures: 0,
          lastFailure: 0,
          state: 'closed'
        }
      });
    });

    // Run health checks in BACKGROUND after a 5s delay to avoid competing
    // with feed subscriptions during the critical startup window.
    // Relays are usable as soon as WebSocket connects.
    setTimeout(() => this.runBackgroundHealthChecks(), 5000);
  }

  /**
   * Run health checks in background for quality scoring.
   * Does NOT block relay usage - relays are usable immediately on WebSocket connect.
   */
  private runBackgroundHealthChecks() {
    if (this.destroyed) return;
    
    console.log('🔍 Starting background relay health checks...');
    
    // Run health checks async - don't await
    Promise.allSettled(
      Array.from(this.relayHealth.keys()).map(async (url) => {
        // Bail if destroyed during iteration
        if (this.destroyed) return;
        
        try {
          const startTime = Date.now();
          const testFilter = { kinds: [1], limit: 1 };
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          );

          const relay_set = NDKRelaySet.fromRelayUrls([url], this.ndkRef, true);
          
          // Bail if destroyed before fetch
          if (this.destroyed) return;
          
          await Promise.race([
            this.ndkRef.fetchEvents(testFilter, undefined, relay_set),
            timeoutPromise
          ]);
          
          // Bail if destroyed after fetch
          if (this.destroyed) return;
          
          const responseTime = Date.now() - startTime;
          const health = this.relayHealth.get(url);
          
          if (health) {
            health.lastSeen = Date.now();
            health.responseTime = responseTime;
            // Don't override 'connected' status - WebSocket connect already set it
            if (health.status === 'disconnected') {
              health.status = 'connected';
            }
            health.failures = 0;
          }
          
        } catch (error: unknown) {
          // Bail if destroyed
          if (this.destroyed) return;
          
          // Health check failed - but don't mark relay as disconnected
          // if WebSocket is still connected. Just note the failure for scoring.
          const health = this.relayHealth.get(url);
          if (health && health.status === 'disconnected') {
            health.failures++;
          }
        }
      })
    ).then(() => {
      if (this.destroyed) return;
      const connectedCount = this.getConnectedRelays().length;
      console.log(`🔍 Background health checks complete: ${connectedCount} relays connected`);
    });
  }

  private setupEventListeners() {
    this.ndkRef.pool.on('relay:connect', (relay) => {
      this.handleRelayConnect(relay);
    });
    
    this.ndkRef.pool.on('relay:disconnect', (relay) => {
      this.handleRelayDisconnect(relay);
    });

    (this.ndkRef.pool as any).on('relay:notice', (relay: { url: string }, notice: string) => {
      this.handleRelayNotice(relay, notice);
    });
  }

  private handleRelayConnect(relay: { url: string }) {
    // Bail if destroyed - prevents zombie reconnects
    if (this.destroyed) return;
    
    const url = relay.url;
    const startTime = Date.now();
    
    console.log(`✅ Connected to ${url}`);
    
    const health = this.relayHealth.get(url);
    if (health) {
      health.status = 'connected';
      health.lastSeen = Date.now();
      health.failures = 0;
      health.responseTime = Date.now() - startTime;
      
      // Reset circuit breaker on successful connection
      health.circuitBreaker.state = 'closed';
      health.circuitBreaker.failures = 0;
      
      this.updateMetrics(true, health.responseTime);
    }
    
    // Start heartbeat for this relay
    this.startHeartbeat(relay);
  }

  private handleRelayDisconnect(relay: { url: string }) {
    // Bail if destroyed - prevents zombie reconnects
    if (this.destroyed) return;
    
    const url = relay.url;
    
    const health = this.relayHealth.get(url);
    if (health) {
      health.status = 'disconnected';
      health.failures++;
      
      // Only log disconnections if they're frequent (potential issues)
      if (health.failures > 3) {
        console.warn(`⚠️ Frequent disconnections from ${url} (${health.failures} failures)`);
      } else {
        console.log(`❌ Disconnected from ${url}`);
      }
      
      // Update circuit breaker
      health.circuitBreaker.failures++;
      health.circuitBreaker.lastFailure = Date.now();
      
      if (health.circuitBreaker.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
        health.circuitBreaker.state = 'open';
        health.status = 'circuit-open';
        this.connectionMetrics.circuitBreakerTrips++;
        console.warn(`🚨 Circuit breaker opened for ${url}`);
      } else {
        // Attempt reconnection for minor failures
        setTimeout(() => {
          // Bail if destroyed during timeout
          if (this.destroyed) return;
          
          if (health.circuitBreaker.state !== 'open') {
            console.log(`🔄 Attempting reconnection to ${url}`);
            const relayInstance = this.ndkRef.pool.relays.get(url);
            if (relayInstance) {
              relayInstance.connect();
            } else {
              console.warn(`⚠️ Relay instance for ${url} not found in pool. Cannot attempt reconnection.`);
            }
          }
        }, Math.min(1000 * Math.pow(2, health.failures), 30000)); // Exponential backoff, max 30s
      }
      
      this.updateMetrics(false);
    }
    
    // Stop heartbeat
    this.stopHeartbeat(url);
  }

  private handleRelayNotice(relay: { url: string }, notice: string) {
    // Bail if destroyed
    if (this.destroyed) return;
    
    const url = relay.url;
    console.log(`📢 Notice from ${url}: ${notice}`);
    
    // Check for degraded performance indicators
    if (notice.includes('rate limit') || notice.includes('slow')) {
      const health = this.relayHealth.get(url);
      if (health && health.status === 'connected') {
        health.status = 'degraded';
        console.warn(`⚠️ Relay ${url} marked as degraded`);
      }
    }
  }

  private startHeartbeat(relay: { url: string }) {
    const url = relay.url;
    
    // Clear existing heartbeat if any
    this.stopHeartbeat(url);
    
    // Simplified heartbeat: just check if relay is still in pool and update lastSeen
    // Avoids creating new subscriptions which can cause "No filters to merge" errors
    const interval = setInterval(() => {
      // Bail if destroyed - prevents zombie heartbeats
      if (this.destroyed) {
        this.stopHeartbeat(url);
        return;
      }
      
      try {
        const health = this.relayHealth.get(url);
        if (!health) return;
        
        // Check if relay is still connected via the pool (see enum note in
        // getPoolConnectedRelays — the old `=== 1` matched DISCONNECTED)
        const relayInstance = this.ndkRef.pool.relays.get(url);
        const isConnected = relayInstance !== undefined && relayInstance.status >= NDKRelayStatus.CONNECTED;
        
        if (isConnected) {
          health.lastSeen = Date.now();
          // Keep status as connected if WebSocket is open
          if (health.status === 'disconnected') {
            health.status = 'connected';
          }
        } else {
          // WebSocket closed - just update status and stop heartbeat
          // Let the real relay:disconnect event handle failures/reconnect
          if (health.status === 'connected' || health.status === 'degraded') {
            health.status = 'disconnected';
            this.stopHeartbeat(url);
          }
        }
      } catch (error) {
        // Silently ignore heartbeat errors
      }
    }, this.HEARTBEAT_INTERVAL);
    
    this.heartbeatIntervals.set(url, interval);
  }

  private stopHeartbeat(url: string) {
    const interval = this.heartbeatIntervals.get(url);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(url);
    }
  }

  private updateMetrics(success: boolean, responseTime?: number) {
    this.connectionMetrics.totalConnections++;
    
    if (success) {
      this.connectionMetrics.successfulConnections++;
      if (responseTime) {
        // Update rolling average response time
        const currentAvg = this.connectionMetrics.averageResponseTime;
        const totalSuccessful = this.connectionMetrics.successfulConnections;
        this.connectionMetrics.averageResponseTime = 
          (currentAvg * (totalSuccessful - 1) + responseTime) / totalSuccessful;
      }
    } else {
      this.connectionMetrics.failedConnections++;
    }
  }

  // Public API methods
  async connectWithCircuitBreaker(): Promise<void> {
    // Don't wait for health checks - connect immediately
    // Health checks run in background for quality scoring
    console.log(`🔗 Connecting to relays (health checks running in background)...`);
    
    try {
      await this.ndkRef.connect();
      console.log('✅ NDK.connect() completed');

      // Wait for a quorum of relay WebSockets, not just the first one.
      // A first-relay gate let cold-start fetches race a mostly-unconnected
      // pool (see docs/ndk-readiness-discovery.md).
      await this.waitForRelayQuorum(this.QUORUM_TIMEOUT_MS);
    } catch (error) {
      console.error('❌ NDK connection failed:', error);
      throw error;
    }
  }

  /**
   * Count connected relays against the pool's target size.
   * Counts from the NDK pool (authoritative WebSocket status); falls back to
   * the health-tracking map for the total only while the pool is unpopulated,
   * so an empty pool never reads as a trivially-satisfied quorum of 0.
   */
  private getQuorumCounts(): { connected: number; total: number } {
    let connected = 0;
    let total = 0;
    try {
      for (const relay of this.ndkRef.pool.relays.values()) {
        total++;
        // >= CONNECTED so relays mid-NIP-42 auth (AUTH_REQUESTED..AUTHENTICATED) count
        if (relay.status >= NDKRelayStatus.CONNECTED) {
          connected++;
        }
      }
    } catch (e) {
      // Pool might not be ready yet
    }
    if (total === 0) {
      total = this.relayHealth.size;
    }
    return { connected, total };
  }

  /**
   * Wait for a quorum of relay WebSockets to be connected (with timeout).
   * Resolves as soon as connected >= relayQuorumTarget(total) — which is
   * satisfied immediately when all relays connect — and resolves anyway at
   * the timeout so callers never hang (same contract as the old first-relay
   * wait, and as ndkReady has always guaranteed).
   */
  async waitForRelayQuorum(timeoutMs: number = this.QUORUM_TIMEOUT_MS): Promise<void> {
    const startTime = Date.now();

    const quorumReached = (): boolean => {
      const { connected, total } = this.getQuorumCounts();
      if (total === 0) return false;
      return connected >= relayQuorumTarget(total, this.QUORUM_FRACTION);
    };

    const logOutcome = (reached: boolean) => {
      const { connected, total } = this.getQuorumCounts();
      const elapsed = Date.now() - startTime;
      if (reached) {
        console.log(`✅ Relay quorum reached: ${connected}/${total} connected in ${elapsed}ms`);
      } else {
        console.warn(`⚠️ Timeout waiting for relay quorum (${connected}/${total} connected after ${elapsed}ms), proceeding anyway`);
      }
    };

    if (quorumReached()) {
      logOutcome(true);
      return;
    }

    return new Promise((resolve) => {
      // Poll frequently for fast response
      const checkInterval = setInterval(() => {
        // Bail if destroyed
        if (this.destroyed) {
          clearInterval(checkInterval);
          resolve();
          return;
        }

        if (quorumReached()) {
          clearInterval(checkInterval);
          logOutcome(true);
          resolve();
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          logOutcome(false);
          resolve();
          return;
        }
      }, 50); // Check every 50ms for fast response
    });
  }

  /**
   * Check NDK pool directly for connected relays
   */
  private getPoolConnectedRelays(): string[] {
    const connected: string[] = [];
    try {
      for (const [url, relay] of this.ndkRef.pool.relays) {
        // Check if relay WebSocket is open. NOTE: in NDK 2.10 the status enum
        // is DISCONNECTED=1, CONNECTED=5..AUTHENTICATED=8 — the old `=== 1`
        // check here dated from a pre-2.x enum and matched DISCONNECTED.
        if (relay.status >= NDKRelayStatus.CONNECTED) {
          connected.push(url);
        }
      }
    } catch (e) {
      // Pool might not be ready yet
    }
    return connected;
  }

  getHealthyRelays(): string[] {
    const now = Date.now();
    const healthyRelays: string[] = [];
    
    for (const [url, health] of this.relayHealth.entries()) {
      // Check circuit breaker state
      if (health.circuitBreaker.state === 'open') {
        // Check if timeout has passed to allow half-open state
        if (now - health.circuitBreaker.lastFailure > this.CIRCUIT_BREAKER_TIMEOUT) {
          health.circuitBreaker.state = 'half-open';
          console.log(`🔄 Circuit breaker half-open for ${url}`);
        } else {
          continue; // Skip this relay
        }
      }
      
      // Prefer connected relays, but allow degraded ones
      if (health.status === 'connected' || health.status === 'degraded') {
        healthyRelays.push(url);
      }
    }
    
    return healthyRelays;
  }

  getRelayHealth(): Array<{ url: string } & RelayHealth> {
    return Array.from(this.relayHealth.entries()).map(([url, health]) => ({
      url,
      ...health
    }));
  }

  getConnectionMetrics(): ConnectionMetrics {
    return { ...this.connectionMetrics };
  }

  getConnectedRelays(): string[] {
    // Check both our health tracking and actual NDK pool status
    const fromHealth = Array.from(this.relayHealth.entries())
      .filter(([, health]) => health.status === 'connected' || health.status === 'degraded')
      .map(([url]) => url);
    
    const fromPool = this.getPoolConnectedRelays();
    
    // Return union of both sources
    return [...new Set([...fromHealth, ...fromPool])];
  }

  // Force circuit breaker reset for testing/recovery
  resetCircuitBreaker(url: string): void {
    const health = this.relayHealth.get(url);
    if (health) {
      health.circuitBreaker.state = 'closed';
      health.circuitBreaker.failures = 0;
      health.status = 'disconnected';
      console.log(`🔄 Circuit breaker reset for ${url}`);
    }
  }

  /**
   * Check if this manager has been destroyed
   */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  // Cleanup method
  destroy(): void {
    // Mark as destroyed first to prevent any new operations
    this.destroyed = true;
    
    console.log('🧹 Destroying ConnectionManager...');
    
    // Clear all heartbeats
    this.heartbeatIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.heartbeatIntervals.clear();
    
    // Clear health tracking
    this.relayHealth.clear();
    
    // Reset metrics
    this.connectionMetrics = {
      totalConnections: 0,
      successfulConnections: 0,
      failedConnections: 0,
      averageResponseTime: 0,
      circuitBreakerTrips: 0
    };
  }
}

// Singleton instance
let connectionManager: ConnectionManager | null = null;

export function createConnectionManager(ndk: NDK): ConnectionManager {
  // If existing manager is for a different NDK instance, destroy it
  if (connectionManager && connectionManager.ndkRef !== ndk) {
    console.log('🔄 NDK instance changed, destroying old ConnectionManager');
    connectionManager.destroy();
    connectionManager = null;
  }
  
  // Create new manager if needed
  if (!connectionManager) {
    connectionManager = new ConnectionManager(ndk);
  }
  
  return connectionManager;
}

export function getConnectionManager(): ConnectionManager | null {
  return connectionManager;
}

/**
 * Reset the connection manager singleton.
 * Call this before switching to a new NDK instance.
 * Cleans up heartbeats and health tracking from the old instance.
 */
export function resetConnectionManagerSingleton(): void {
  if (connectionManager) {
    connectionManager.destroy();
    connectionManager = null;
  }
}

// Backward compatibility alias
export const resetConnectionManager = resetConnectionManagerSingleton;
