import { browser } from '$app/environment';
import NDK from '@nostr-dev-kit/ndk';
import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie';
import { writable, get, type Writable } from 'svelte/store';
import { standardRelays } from './consts';
import { createConnectionManager, getConnectionManager, resetConnectionManagerSingleton } from './connectionManager';

// Storage keys
const RELAYS_STORAGE_KEY = 'nostrcooking_relays';
const RELAY_SET_STORAGE_KEY = 'zap_active_relay_set';

// Only create Dexie adapter in browser (IndexedDB not available in SSR)
const dexieAdapter = browser ? new NDKCacheAdapterDexie({ dbName: 'zapcooking-ndk-cache-db' }) : undefined;

// Default outbox relays (used in standard/default mode)
const DEFAULT_OUTBOX_RELAY_URLS = ["wss://purplepag.es", "wss://kitchen.zap.cooking"];

// ═══════════════════════════════════════════════════════════════
// RELAY GENERATION - Prevents stale async results from overriding state
// ═══════════════════════════════════════════════════════════════

let relayGeneration = 0;

/**
 * Get the current relay generation ID.
 * Use this at the start of async operations to detect stale results.
 */
export function getCurrentRelayGeneration(): number {
  return relayGeneration;
}

/**
 * Bump the relay generation ID.
 * Called when switching relays to invalidate in-flight operations.
 */
export function bumpRelayGeneration(): number {
  relayGeneration++;
  console.log(`🔄 Relay generation bumped to ${relayGeneration}`);
  return relayGeneration;
}

// ═══════════════════════════════════════════════════════════════
// SUBSCRIPTION STOP CALLBACKS - Allow components to register cleanup
// ═══════════════════════════════════════════════════════════════

type StopSubscriptionsCallback = () => void;
const stopSubscriptionsCallbacks: Set<StopSubscriptionsCallback> = new Set();

/**
 * Register a callback to stop subscriptions when relays are switched.
 * Returns an unregister function.
 */
export function onRelaySwitchStopSubscriptions(callback: StopSubscriptionsCallback): () => void {
  stopSubscriptionsCallbacks.add(callback);
  return () => {
    stopSubscriptionsCallbacks.delete(callback);
  };
}

/**
 * Call all registered stop subscription callbacks.
 */
function notifyStopSubscriptions(): void {
  console.log(`🛑 Stopping ${stopSubscriptionsCallbacks.size} subscription callbacks...`);
  for (const callback of stopSubscriptionsCallbacks) {
    try {
      callback();
    } catch (e) {
      console.warn('Error in stop subscriptions callback:', e);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// RELAY MODE TYPES
// ═══════════════════════════════════════════════════════════════

export type RelayMode = 'default' | 'garden' | 'members' | 'discovery';

// ═══════════════════════════════════════════════════════════════
// URL NORMALIZATION & VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Normalize a relay URL: trim whitespace and strip trailing slashes.
 * This ensures consistent URL format across the app.
 */
export function normalizeRelayUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Validate and sanitize relay URLs
 * - Normalizes URLs (trim, strip trailing slashes)
 * - Deduplicates
 * - Ensures wss:// protocol
 */
function validateRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const validated: string[] = [];
  
  for (const url of urls) {
    const normalized = normalizeRelayUrl(url);
    
    // Must start with wss://
    if (!normalized.startsWith('wss://')) {
      console.warn(`Skipping invalid relay URL (must start with wss://): ${normalized}`);
      continue;
    }
    
    // Dedupe using lowercase for comparison
    const lowerNormalized = normalized.toLowerCase();
    if (seen.has(lowerNormalized)) {
      continue;
    }
    seen.add(lowerNormalized);
    validated.push(normalized);
  }
  
  return validated;
}

// ═══════════════════════════════════════════════════════════════
// NDK FACTORY
// ═══════════════════════════════════════════════════════════════

interface NdkConfig {
  explicitRelayUrls: string[];
  enableOutboxModel: boolean;
  outboxRelayUrls: string[];
}

/**
 * Get NDK config based on relay mode.
 * - default: standard config with outbox model enabled
 * - garden: outbox disabled, only garden relay
 * - members: outbox disabled, only members relay
 * - discovery: outbox enabled with discovery relays
 */
function getNdkConfigForMode(mode: RelayMode, relayUrls: string[]): NdkConfig {
  switch (mode) {
    case 'garden':
      // Garden mode: NO outbox model - only connect to garden relay
      return {
        explicitRelayUrls: relayUrls,
        enableOutboxModel: false,
        outboxRelayUrls: []
      };
    
    case 'members':
      // Members mode: NO outbox model - only connect to members relay
      return {
        explicitRelayUrls: relayUrls,
        enableOutboxModel: false,
        outboxRelayUrls: []
      };
    
    case 'discovery':
      // Discovery mode: outbox enabled for profile resolution
      return {
        explicitRelayUrls: relayUrls,
        enableOutboxModel: true,
        outboxRelayUrls: DEFAULT_OUTBOX_RELAY_URLS
      };
    
    case 'default':
    default:
      // Default mode: standard config with outbox model
      return {
        explicitRelayUrls: relayUrls,
        enableOutboxModel: true,
        outboxRelayUrls: DEFAULT_OUTBOX_RELAY_URLS
      };
  }
}

/**
 * Factory function to create a new NDK instance with mode-specific config.
 */
function createNdk(mode: RelayMode, relayUrls: string[]): NDK {
  const config = getNdkConfigForMode(mode, relayUrls);
  
  console.log(`📡 Creating NDK instance [mode=${mode}]:`, {
    explicitRelayUrls: config.explicitRelayUrls,
    enableOutboxModel: config.enableOutboxModel,
    outboxRelayUrls: config.outboxRelayUrls
  });
  
  return new NDK({
    outboxRelayUrls: config.outboxRelayUrls,
    enableOutboxModel: config.enableOutboxModel,
    explicitRelayUrls: config.explicitRelayUrls,
    cacheAdapter: dexieAdapter,
    autoConnectUserRelays: false
  });
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

/**
 * Get current relay URLs from localStorage (with fallback to standardRelays)
 */
export function getCurrentRelays(): string[] {
  if (!browser) return standardRelays;
  try {
    const stored = localStorage.getItem(RELAYS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse stored relays:', e);
  }
  return standardRelays;
}

/**
 * Get the current active relay set ID (if any)
 */
export function getActiveRelaySetId(): string | null {
  if (!browser) return null;
  return localStorage.getItem(RELAY_SET_STORAGE_KEY);
}

// Initial relay configuration
const initialRelays = getCurrentRelays();

// Export relays as a getter for backward compatibility
// Note: This is now a snapshot; for dynamic relays use getCurrentRelays()
export const relays = initialRelays;

// Create initial NDK instance (default mode)
let currentNdk: NDK = createNdk('default', initialRelays);
let currentRelayMode: RelayMode = 'default';

// NDK ready state - resolves when NDK is connected
let ndkReadyResolve!: () => void;
let ndkReadyReject!: (error: Error) => void;
export const ndkReady: Promise<void> = new Promise((resolve, reject) => {
  ndkReadyResolve = resolve;
  ndkReadyReject = reject;
});

// Track connection state
export const ndkConnected = writable(false);

// Track relay switching state
export const ndkSwitching = writable(false);

// ═══════════════════════════════════════════════════════════════
// CONNECTION
// ═══════════════════════════════════════════════════════════════

// Connection retry with exponential backoff and circuit breaker
async function connectWithRetry(ndkInstance: NDK, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔗 Connecting to NDK relays... (attempt ${attempt}/${maxRetries})`);
      
      // Create new connection manager for this NDK instance
      const connectionManager = createConnectionManager(ndkInstance);
      
      // Use connection manager's circuit breaker logic (waits for first relay)
      await connectionManager.connectWithCircuitBreaker();
      
      // Mark as connected - relays are now ready
      ndkConnected.set(true);
      console.log('✅ NDK ready - relays connected');
      return;
    } catch (error) {
      console.error(`❌ NDK connection failed (attempt ${attempt}):`, error);
      
      if (attempt === maxRetries) {
        console.error('❌ Max retries reached. NDK connection failed.');
        // Still mark connection state appropriately
        ndkConnected.set(false);
        return;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// RELAY SWITCHING (TRANSACTIONAL)
// ═══════════════════════════════════════════════════════════════

/**
 * Switch to a new set of relays at runtime (transactional).
 * 
 * This function is atomic - it:
 * 1. Bumps generation ID (invalidates in-flight operations)
 * 2. Validates/sanitizes relay URLs
 * 3. Stops all feed subscriptions
 * 4. Cleans up old NDK instance and connection manager
 * 5. Creates a new NDK instance with mode-specific config
 * 6. Updates the ndk store
 * 7. Connects to the new relays
 * 
 * @param mode - Relay mode ('default', 'garden', 'members', 'discovery')
 * @param nextRelayUrls - Array of relay URLs to switch to
 * @returns Promise that resolves when connection attempt completes
 */
export async function switchRelays(mode: RelayMode, nextRelayUrls: string[]): Promise<void> {
  if (!browser) {
    console.warn('switchRelays called on server - ignoring');
    return;
  }
  
  // 1. Normalize + dedupe URLs
  const validatedUrls = validateRelayUrls(nextRelayUrls);
  if (validatedUrls.length === 0) {
    console.error('No valid relay URLs provided');
    throw new Error('No valid relay URLs provided');
  }
  
  console.log(`🔄 Switching relays [mode=${mode}]:`, validatedUrls);
  
  // 2. Bump generation (invalidates all in-flight async operations)
  const newGen = bumpRelayGeneration();
  
  // 3. Mark switching state
  ndkSwitching.set(true);
  ndkConnected.set(false);
  
  try {
    // 4. Stop all feed subscriptions via callbacks
    notifyStopSubscriptions();
    
    // 5. Persist to localStorage
    localStorage.setItem(RELAYS_STORAGE_KEY, JSON.stringify(validatedUrls));
    
    // 6. Cleanup old connection manager FIRST (prevents zombie reconnects)
    resetConnectionManagerSingleton();
    
    // 7. Destroy/disconnect old NDK instance (best effort)
    try {
      const oldNdk = currentNdk;
      if (oldNdk && oldNdk.pool) {
        console.log('🧹 Disconnecting old NDK relays...');
        for (const [url, relay] of oldNdk.pool.relays) {
          try {
            relay.disconnect();
            console.log(`  Disconnected: ${url}`);
          } catch (e) {
            // Ignore disconnect errors
          }
        }
      }
    } catch (e) {
      console.warn('Error disconnecting old relays:', e);
    }
    
    // 8. Create new NDK instance with mode-specific config
    const newNdk = createNdk(mode, validatedUrls);
    currentNdk = newNdk;
    currentRelayMode = mode;
    
    // 9. Update the ndk store
    ndk.set(newNdk);
    
    // 10. Connect to new relays
    await connectWithRetry(newNdk);
    
    console.log(`✅ Relay switch complete [gen=${newGen}, mode=${mode}]`);
  } finally {
    ndkSwitching.set(false);
  }
}

/**
 * Switch to a named relay set.
 * 
 * @param id - The relay set ID (e.g., 'default', 'garden', 'discovery', 'profiles')
 * @returns Promise that resolves when connection attempt completes
 */
export async function switchRelaySetId(id: string): Promise<void> {
  if (!browser) {
    console.warn('switchRelaySetId called on server - ignoring');
    return;
  }
  
  // Dynamically import to avoid SSR issues and circular deps
  const { getRelaySet } = await import('./relays/relaySets');
  
  const relaySet = getRelaySet(id);
  if (!relaySet) {
    console.error(`Unknown relay set ID: ${id}`);
    throw new Error(`Unknown relay set ID: ${id}`);
  }
  
  console.log(`🔄 Switching to relay set "${relaySet.name}":`, relaySet.relays);
  
  // Persist the active relay set ID
  localStorage.setItem(RELAY_SET_STORAGE_KEY, id);
  
  // Determine mode from relay set ID
  let mode: RelayMode;
  if (id === 'garden' || id === 'members' || id === 'discovery') {
    mode = id as RelayMode;
  } else if (id === 'default' || id === 'profiles') {
    // These relay sets intentionally use the standard/default mode
    mode = 'default';
  } else {
    console.error(`Unsupported relay mode for relay set ID: ${id}`);
    throw new Error(`Unsupported relay mode for relay set ID: ${id}`);
  }
  
  // Switch to the relay set's relays with appropriate mode
  await switchRelays(mode, relaySet.relays);
}

/**
 * Get the current relay mode.
 */
export function getCurrentRelayMode(): RelayMode {
  return currentRelayMode;
}

// ═══════════════════════════════════════════════════════════════
// INITIAL CONNECTION
// ═══════════════════════════════════════════════════════════════

// Connect when in browser environment (non-blocking)
if (browser) {
  // Suppress expected WebSocket connection errors from NDK during initial connection
  const originalError = console.error;
  const originalLog = console.log;
  let errorSuppressionActive = true;
  
  console.error = (...args: unknown[]) => {
    const message = args.join(' ');
    // Suppress expected WebSocket connection failures during initial connection
    if (errorSuppressionActive && message.includes('WebSocket connection to') && message.includes('failed')) {
      return;
    }
    originalError.apply(console, args);
  };

  // Suppress verbose NDK subscription management logs
  console.log = (...args: unknown[]) => {
    const message = args.join(' ');
    if (message.includes('removing a subscription') || 
        message.includes('removing subscription')) {
      return;
    }
    originalLog.apply(console, args);
  };

  connectWithRetry(currentNdk).then(() => {
    ndkReadyResolve();
  }).catch(error => {
    console.error('🚨 Failed to establish NDK connection:', error);
    ndkReadyResolve(); // Resolve anyway so components don't hang
  }).finally(() => {
    setTimeout(() => {
      errorSuppressionActive = false;
      console.error = originalError;
    }, 3000);
  });
} else {
  // Server-side: resolve immediately (no NDK operations on server)
  ndkReadyResolve();
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

// Helper to get the raw NDK instance (for non-reactive contexts)
export function getNdkInstance(): NDK {
  return currentNdk;
}

// Helper to check if NDK is ready synchronously
export function isNdkReady(): boolean {
  return get(ndkConnected);
}

/**
 * Wait for NDK to be connected.
 * Use this instead of calling $ndk.connect() directly in components.
 * 
 * @param timeoutMs - Maximum time to wait (default: 6000ms)
 * @returns Promise that resolves when connected or times out
 */
export async function ensureNdkConnected(timeoutMs = 6000): Promise<void> {
  // Already connected?
  if (get(ndkConnected)) {
    return;
  }
  
  // Wait for ndkReady first (initial connection)
  await ndkReady;
  
  // If connected after initial ready, we're done
  if (get(ndkConnected)) {
    return;
  }
  
  // Otherwise poll for connection with timeout
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const checkInterval = setInterval(() => {
      if (get(ndkConnected)) {
        clearInterval(checkInterval);
        resolve();
        return;
      }
      
      // Check for switching state - wait longer if switching
      if (get(ndkSwitching)) {
        return;
      }
      
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        console.warn('⚠️ ensureNdkConnected timed out, proceeding anyway');
        resolve();
        return;
      }
    }, 100);
  });
}

// ═══════════════════════════════════════════════════════════════
// RELAY HEALTH MONITORING
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// STORES
// ═══════════════════════════════════════════════════════════════

export const ndk: Writable<NDK> = writable(currentNdk);

export const userPublickey: Writable<string> = writable(
  (browser && localStorage.getItem('nostrcooking_loggedInPublicKey')) || ''
);

// Store for user's profile picture URL override (used after upload to immediately show new picture)
export const userProfilePictureOverride: Writable<string | null> = writable(null);
