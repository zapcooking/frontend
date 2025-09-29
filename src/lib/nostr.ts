import { browser } from '$app/environment';
import NDK from '@nostr-dev-kit/ndk';
import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie';
import { writable, type Writable } from 'svelte/store';
import { standardRelays } from './consts';
import { createConnectionManager, getConnectionManager } from './connectionManager';

export const relays = JSON.parse(
  (browser && localStorage.getItem('nostrcooking_relays')) || JSON.stringify(standardRelays)
)

const dexieAdapter = new NDKCacheAdapterDexie({ dbName: 'zapcooking-ndk-cache-db' });
const Ndk: NDK = new NDK({ 
  outboxRelayUrls: ["wss://purplepag.es", "wss://kitchen.zap.cooking"], 
  enableOutboxModel: true, 
  explicitRelayUrls: relays, 
  cacheAdapter: dexieAdapter,
  autoConnectUserRelays: false
});

// Initialize connection manager with circuit breaker and heartbeat monitoring
let connectionManager: any = null;

// Connection retry with exponential backoff and circuit breaker
async function connectWithRetry(ndk: NDK, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔗 Connecting to NDK relays... (attempt ${attempt}/${maxRetries})`);
      
      // Initialize connection manager if not already done
      if (!connectionManager) {
        connectionManager = createConnectionManager(ndk);
      }
      
      // Use connection manager's circuit breaker logic
      await connectionManager.connectWithCircuitBreaker();
      return;
    } catch (error) {
      console.error(`❌ NDK connection failed (attempt ${attempt}):`, error);
      
      if (attempt === maxRetries) {
        console.error('❌ Max retries reached. NDK connection failed.');
        return;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Connect when in browser environment (non-blocking)
if (browser) {
  connectWithRetry(Ndk).catch(error => {
    console.error('🚨 Failed to establish NDK connection:', error);
  });
}

// Export relay health monitoring functions
export function getRelayHealth() {
  const manager = getConnectionManager();
  if (manager) {
    return manager.getRelayHealth();
  }
  return [];
}

export function getConnectedRelays() {
  const manager = getConnectionManager();
  if (manager) {
    return manager.getConnectedRelays();
  }
  return [];
}

export function getConnectionMetrics() {
  const manager = getConnectionManager();
  if (manager) {
    return manager.getConnectionMetrics();
  }
  return {
    totalConnections: 0,
    successfulConnections: 0,
    failedConnections: 0,
    averageResponseTime: 0,
    circuitBreakerTrips: 0
  };
}

export function resetCircuitBreaker(url: string) {
  const manager = getConnectionManager();
  if (manager) {
    manager.resetCircuitBreaker(url);
  }
}

export const ndk: Writable<any> = writable(Ndk);

export const userPublickey: Writable<string> = writable(
  (browser && localStorage.getItem('nostrcooking_loggedInPublicKey')) || ''
);
