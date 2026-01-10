/**
 * Connection Monitor
 * 
 * Monitors online/offline status and provides reactive stores for connection state.
 * Triggers sync operations when connection is restored.
 */

import { browser } from '$app/environment';
import { writable, derived, get } from 'svelte/store';

export type ConnectionStatus = 'online' | 'offline' | 'checking';

interface ConnectionState {
  status: ConnectionStatus;
  lastOnline: number | null;
  lastOffline: number | null;
  checkCount: number;
}

// Configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 5000;   // 5 seconds timeout for heartbeat check
const RECONNECT_DEBOUNCE = 2000;  // 2 seconds debounce before triggering sync

// Internal state store
const connectionState = writable<ConnectionState>({
  status: browser ? (navigator.onLine ? 'online' : 'offline') : 'online',
  lastOnline: browser && navigator.onLine ? Date.now() : null,
  lastOffline: browser && !navigator.onLine ? Date.now() : null,
  checkCount: 0
});

// Public derived stores
export const isOnline = derived(connectionState, $state => $state.status === 'online');
export const isOffline = derived(connectionState, $state => $state.status === 'offline');
export const connectionStatus = derived(connectionState, $state => $state.status);
export const lastOnlineTime = derived(connectionState, $state => $state.lastOnline);

// Callbacks for connection events
type ConnectionCallback = () => void | Promise<void>;
const onConnectCallbacks: ConnectionCallback[] = [];
const onDisconnectCallbacks: ConnectionCallback[] = [];

/**
 * Register a callback for when connection is restored
 */
export function onConnect(callback: ConnectionCallback): () => void {
  onConnectCallbacks.push(callback);
  return () => {
    const index = onConnectCallbacks.indexOf(callback);
    if (index > -1) onConnectCallbacks.splice(index, 1);
  };
}

/**
 * Register a callback for when connection is lost
 */
export function onDisconnect(callback: ConnectionCallback): () => void {
  onDisconnectCallbacks.push(callback);
  return () => {
    const index = onDisconnectCallbacks.indexOf(callback);
    if (index > -1) onDisconnectCallbacks.splice(index, 1);
  };
}

// Debounce timer for reconnection
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Update connection status and trigger callbacks
 */
function setStatus(newStatus: ConnectionStatus) {
  const currentState = get(connectionState);
  
  if (currentState.status === newStatus) return;
  
  const wasOffline = currentState.status === 'offline';
  const isNowOnline = newStatus === 'online';
  
  connectionState.update(state => ({
    ...state,
    status: newStatus,
    lastOnline: isNowOnline ? Date.now() : state.lastOnline,
    lastOffline: newStatus === 'offline' ? Date.now() : state.lastOffline,
    checkCount: state.checkCount + 1
  }));
  
  console.log(`[ConnectionMonitor] Status changed: ${currentState.status} -> ${newStatus}`);
  
  // Trigger callbacks
  if (isNowOnline && wasOffline) {
    // Debounce reconnection to avoid rapid on/off triggers
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      console.log('[ConnectionMonitor] Connection restored, triggering callbacks');
      onConnectCallbacks.forEach(cb => {
        try {
          cb();
        } catch (error) {
          console.error('[ConnectionMonitor] Error in onConnect callback:', error);
        }
      });
    }, RECONNECT_DEBOUNCE);
  } else if (newStatus === 'offline') {
    // Cancel any pending reconnect
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    
    onDisconnectCallbacks.forEach(cb => {
      try {
        cb();
      } catch (error) {
        console.error('[ConnectionMonitor] Error in onDisconnect callback:', error);
      }
    });
  }
}

/**
 * Perform a heartbeat check to verify actual connectivity
 * Uses a small fetch to a reliable endpoint
 */
async function heartbeatCheck(): Promise<boolean> {
  if (!browser) return true;
  
  // First check navigator.onLine
  if (!navigator.onLine) {
    return false;
  }
  
  try {
    // Try to fetch a small resource with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT);
    
    // Use a simple HEAD request to a reliable endpoint
    // We use the app's own domain to avoid CORS issues
    const response = await fetch('/favicon.ico', {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    // Network error or timeout
    return false;
  }
}

// Heartbeat interval timer
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start monitoring connection status
 */
export function startMonitoring(): void {
  if (!browser) return;
  
  console.log('[ConnectionMonitor] Starting connection monitoring');
  
  // Listen for browser online/offline events
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  
  // Start heartbeat checks
  heartbeatTimer = setInterval(async () => {
    const isConnected = await heartbeatCheck();
    setStatus(isConnected ? 'online' : 'offline');
  }, HEARTBEAT_INTERVAL);
  
  // Initial check
  heartbeatCheck().then(isConnected => {
    setStatus(isConnected ? 'online' : 'offline');
  });
}

/**
 * Stop monitoring connection status
 */
export function stopMonitoring(): void {
  if (!browser) return;
  
  console.log('[ConnectionMonitor] Stopping connection monitoring');
  
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
  
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/**
 * Handle browser online event
 */
async function handleOnline() {
  console.log('[ConnectionMonitor] Browser online event');
  
  // Verify with heartbeat before confirming
  connectionState.update(s => ({ ...s, status: 'checking' }));
  const isConnected = await heartbeatCheck();
  setStatus(isConnected ? 'online' : 'offline');
}

/**
 * Handle browser offline event
 */
function handleOffline() {
  console.log('[ConnectionMonitor] Browser offline event');
  setStatus('offline');
}

/**
 * Force a connection check
 */
export async function checkConnection(): Promise<boolean> {
  if (!browser) return true;
  
  connectionState.update(s => ({ ...s, status: 'checking' }));
  const isConnected = await heartbeatCheck();
  setStatus(isConnected ? 'online' : 'offline');
  return isConnected;
}

/**
 * Get current connection status synchronously
 */
export function getConnectionStatus(): ConnectionStatus {
  return get(connectionState).status;
}

/**
 * Check if currently online (synchronous)
 */
export function isCurrentlyOnline(): boolean {
  return get(connectionState).status === 'online';
}

// Auto-start monitoring in browser
if (browser) {
  // Start on next tick to ensure all modules are loaded
  setTimeout(startMonitoring, 0);
}
