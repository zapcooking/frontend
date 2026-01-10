/**
 * Sync Service
 * 
 * Coordinates background synchronization between offline storage and Nostr.
 * Initializes on app start and manages sync queue processing.
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { offlineStorage } from './offlineStorage';
import { onConnect, isCurrentlyOnline } from './connectionMonitor';
import { cookbookStore, cookbookSyncStatus } from './stores/cookbookStore';
import { userPublickey } from './nostr';

// Configuration
const SYNC_INTERVAL = 60000; // Check for pending syncs every 60 seconds
const MAX_RETRIES = 10;

let syncInterval: ReturnType<typeof setInterval> | null = null;
let isInitialized = false;

/**
 * Initialize the sync service
 * Should be called once when the app starts
 */
export function initSyncService(): void {
  if (!browser || isInitialized) return;
  
  isInitialized = true;
  console.log('[SyncService] Initializing...');

  // Register callback for when connection is restored
  onConnect(async () => {
    console.log('[SyncService] Connection restored, checking for pending changes');
    await processPendingSync();
  });

  // Start periodic sync check
  startPeriodicSync();

  // Initial check
  if (isCurrentlyOnline()) {
    setTimeout(processPendingSync, 5000); // Delay initial sync by 5 seconds
  }
}

/**
 * Start periodic sync checks
 */
function startPeriodicSync(): void {
  if (syncInterval) return;

  syncInterval = setInterval(async () => {
    const pubkey = get(userPublickey);
    if (!pubkey || !isCurrentlyOnline()) return;

    const { pending } = await offlineStorage.getQueueStatus();
    if (pending > 0) {
      console.log(`[SyncService] Periodic check found ${pending} pending operations`);
      await processPendingSync();
    }
  }, SYNC_INTERVAL);
}

/**
 * Stop periodic sync checks
 */
export function stopPeriodicSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * Process pending sync operations
 */
async function processPendingSync(): Promise<void> {
  const pubkey = get(userPublickey);
  if (!pubkey || !isCurrentlyOnline()) return;

  const syncStatus = get(cookbookSyncStatus);
  if (syncStatus === 'syncing') {
    console.log('[SyncService] Sync already in progress');
    return;
  }

  try {
    await cookbookStore.syncNow();
    
    // Clear failed operations
    const cleared = await offlineStorage.clearFailedOperations(MAX_RETRIES);
    if (cleared > 0) {
      console.log(`[SyncService] Cleared ${cleared} failed operations`);
    }
  } catch (error) {
    console.error('[SyncService] Sync failed:', error);
  }
}

/**
 * Force immediate sync attempt
 */
export async function forceSync(): Promise<boolean> {
  if (!isCurrentlyOnline()) {
    console.log('[SyncService] Cannot sync - offline');
    return false;
  }

  try {
    await processPendingSync();
    return true;
  } catch (error) {
    console.error('[SyncService] Force sync failed:', error);
    return false;
  }
}

/**
 * Get current sync status
 */
export async function getSyncInfo(): Promise<{
  isOnline: boolean;
  pendingOperations: number;
  failedOperations: number;
  cookbooksWithPendingChanges: number;
}> {
  const pubkey = get(userPublickey);
  
  if (!pubkey) {
    return {
      isOnline: isCurrentlyOnline(),
      pendingOperations: 0,
      failedOperations: 0,
      cookbooksWithPendingChanges: 0
    };
  }

  const { pending, failed } = await offlineStorage.getQueueStatus();
  const stats = await offlineStorage.getStats();

  return {
    isOnline: isCurrentlyOnline(),
    pendingOperations: pending,
    failedOperations: failed,
    cookbooksWithPendingChanges: stats.pendingCookbooks
  };
}

/**
 * Clear all offline data for the current user
 */
export async function clearOfflineData(): Promise<void> {
  const pubkey = get(userPublickey);
  if (!pubkey) return;

  await offlineStorage.clearUserData(pubkey);
  console.log('[SyncService] Cleared offline data for user');
}

// Auto-initialize in browser
if (browser) {
  // Initialize after a short delay to ensure other modules are loaded
  setTimeout(initSyncService, 1000);
}
