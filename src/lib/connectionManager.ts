import type NDK from '@nostr-dev-kit/ndk';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';

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

  constructor(ndk: NDK) {
    this.ndkRef = ndk;
    this.initializeRelayHealth();
    this.setupEventListeners();
  }

  private initializeRelayHealth() {
    // Initialize health tracking for all configured relays
    const relayUrls = [
      ...this.ndkRef.explicitRelayUrls || [],
      ...this.ndkRef.outboxRelayUrls || []
    ];

    console.log('🔧 Initializing relay health for URLs:', relayUrls);

    if (relayUrls.length === 0) {
      console.warn('⚠️ No relay URLs configured in NDK instance');
      // Add some default relays if none are configured
      const defaultRelays = [
        'wss://purplepag.es',
        'wss://kitchen.zap.cooking',
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

    // Run health checks in BACKGROUND - don't block connection
    // Relays are usable as soon as WebSocket connects
    this.runBackgroundHealthChecks();
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

    this.ndkRef.pool.on('relay:notice', (relay, notice) => {
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
        
        // Check if relay is still connected via the pool
        const relayInstance = this.ndkRef.pool.relays.get(url);
        const isConnected = relayInstance?.connectivity?.status === 1; // 1 = OPEN
        
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
      
      // Wait for at least one relay WebSocket to be connected (fast - typically <500ms)
      await this.waitForFirstRelay(3000); // Reduced timeout since we're not waiting for health checks
    } catch (error) {
      console.error('❌ NDK connection failed:', error);
      throw error;
    }
  }

  /**
   * Wait for at least one relay WebSocket to be connected (with timeout)
   * This is fast - just waits for WebSocket open, not health check
   */
  async waitForFirstRelay(timeoutMs: number = 3000): Promise<void> {
    // Check if already connected (via relay:connect event)
    if (this.getConnectedRelays().length > 0) {
      console.log('✅ Relay already connected');
      return;
    }

    // Also check NDK pool directly for connected relays
    const poolConnected = this.getPoolConnectedRelays();
    if (poolConnected.length > 0) {
      console.log(`✅ Relay connected (from pool): ${poolConnected[0]}`);
      return;
    }
    
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      // Poll frequently for fast response
      const checkInterval = setInterval(() => {
        // Bail if destroyed
        if (this.destroyed) {
          clearInterval(checkInterval);
          resolve();
          return;
        }
        
        const connected = this.getConnectedRelays();
        const poolRelays = this.getPoolConnectedRelays();
        
        if (connected.length > 0 || poolRelays.length > 0) {
          clearInterval(checkInterval);
          const firstRelay = connected[0] || poolRelays[0];
          console.log(`✅ First relay connected: ${firstRelay}`);
          resolve();
          return;
        }
        
        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          console.warn('⚠️ Timeout waiting for relay connections, proceeding anyway');
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
        // Check if relay WebSocket is open
        if (relay.connectivity?.status === 1) { // 1 = OPEN
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
