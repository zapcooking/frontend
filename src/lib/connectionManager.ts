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

  constructor(private ndk: NDK) {
    this.initializeRelayHealth();
    this.setupEventListeners();
  }

  private initializeRelayHealth() {
    // Initialize health tracking for all configured relays
    const relayUrls = [
      ...this.ndk.explicitRelayUrls || [],
      ...this.ndk.outboxRelayUrls || []
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
        'wss://relay.nostr.band'
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

    // Perform initial health check
    this.performInitialHealthCheck();
  }

  private async performInitialHealthCheck() {
    console.log('🔍 Performing initial relay health check...');
    
    const healthCheckPromises = Array.from(this.relayHealth.keys()).map(async (url) => {
      try {
        const startTime = Date.now();
        
        // Create a simple test filter
        const testFilter = { kinds: [1], limit: 1 };
        
        // Try to fetch events with a timeout
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        );

        const relay_set = NDKRelaySet.fromRelayUrls([url], this.ndk, true);
        
        await Promise.race([
          this.ndk.fetchEvents(testFilter, undefined, relay_set),
          timeoutPromise
        ]);
        
        const responseTime = Date.now() - startTime;
        const health = this.relayHealth.get(url);
        
        if (health) {
          health.status = 'connected';
          health.lastSeen = Date.now();
          health.responseTime = responseTime;
          health.failures = 0;
          
          console.log(`✅ Initial health check passed for ${url} (${responseTime}ms)`);
        }
        
      } catch (error) {
        const health = this.relayHealth.get(url);
        if (health) {
          health.status = 'disconnected';
          health.failures++;
          health.circuitBreaker.failures++;
          health.circuitBreaker.lastFailure = Date.now();
          
          console.log(`❌ Initial health check failed for ${url}:`, error.message);
        }
      }
    });

    await Promise.allSettled(healthCheckPromises);
    
    const healthyCount = this.getHealthyRelays().length;
    console.log(`🔍 Initial health check complete: ${healthyCount}/${this.relayHealth.size} relays healthy`);
  }

  private setupEventListeners() {
    this.ndk.pool.on('relay:connect', (relay) => {
      this.handleRelayConnect(relay);
    });
    
    this.ndk.pool.on('relay:disconnect', (relay) => {
      this.handleRelayDisconnect(relay);
    });

    this.ndk.pool.on('relay:notice', (relay, notice) => {
      this.handleRelayNotice(relay, notice);
    });
  }

  private handleRelayConnect(relay: any) {
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

  private handleRelayDisconnect(relay: any) {
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
          if (health.circuitBreaker.state !== 'open') {
            console.log(`🔄 Attempting reconnection to ${url}`);
            const relayInstance = this.ndk.pool.relays.get(url);
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

  private handleRelayNotice(relay: any, notice: string) {
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

  private startHeartbeat(relay: any) {
    const url = relay.url;
    
    // Clear existing heartbeat if any
    this.stopHeartbeat(url);
    
    const interval = setInterval(async () => {
      try {
        const startTime = Date.now();
        
        // Send a simple ping by requesting a single event
        const testFilter = { kinds: [1], limit: 1 };
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Heartbeat timeout')), this.MAX_RESPONSE_TIME)
        );
        
        await Promise.race([
          new Promise((resolve, reject) => {
            const subscription = this.ndk.subscribe(testFilter, { closeOnEose: false });
            let resolved = false;
            
            subscription.on('event', () => {
              if (!resolved) {
                resolved = true;
                subscription.stop();
                resolve(null);
              }
            });
            
            subscription.on('eose', () => {
              if (!resolved) {
                resolved = true;
                subscription.stop();
                resolve(null);
              }
            });
            
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                subscription.stop();
                reject(new Error('Heartbeat timeout'));
              }
            }, this.MAX_RESPONSE_TIME);
          }),
          timeoutPromise
        ]);
        
        const responseTime = Date.now() - startTime;
        const health = this.relayHealth.get(url);
        
        if (health) {
          health.lastSeen = Date.now();
          health.responseTime = responseTime;
          
          // Mark as degraded if response time is too high
          if (responseTime > this.MAX_RESPONSE_TIME && health.status === 'connected') {
            health.status = 'degraded';
            console.warn(`⚠️ Relay ${url} response time: ${responseTime}ms`);
          }
        }
        
      } catch (error) {
        console.warn(`💔 Heartbeat failed for ${url}:`, error);
        this.handleRelayDisconnect({ url });
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
    // Wait a bit for initial health check to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const healthyRelays = this.getHealthyRelays();
    
    console.log(`🔗 Available relays for connection:`, healthyRelays);
    
    // If no healthy relays, try connecting anyway - NDK will handle relay selection
    if (healthyRelays.length === 0) {
      console.log('⚠️ No healthy relays detected, attempting connection anyway...');
    } else {
      console.log(`🔗 Connecting to ${healthyRelays.length} healthy relays...`);
    }
    
    try {
      await this.ndk.connect();
      console.log('✅ NDK connected successfully');
    } catch (error) {
      console.error('❌ NDK connection failed:', error);
      throw error;
    }
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
    return Array.from(this.relayHealth.entries())
      .filter(([, health]) => health.status === 'connected')
      .map(([url]) => url);
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

  // Cleanup method
  destroy(): void {
    // Clear all heartbeats
    this.heartbeatIntervals.forEach((interval, url) => {
      clearInterval(interval);
    });
    this.heartbeatIntervals.clear();
    
    // Clear health tracking
    this.relayHealth.clear();
  }
}

// Singleton instance
let connectionManager: ConnectionManager | null = null;

export function createConnectionManager(ndk: NDK): ConnectionManager {
  if (!connectionManager) {
    connectionManager = new ConnectionManager(ndk);
  }
  return connectionManager;
}

export function getConnectionManager(): ConnectionManager | null {
  return connectionManager;
}