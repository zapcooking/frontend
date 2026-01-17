/**
 * Recipe Draft Store
 *
 * Manages saving and loading recipe drafts with support for:
 * - Local storage (offline-first)
 * - NIP-37 remote sync (encrypted drafts on relays)
 * - Automatic background sync with debouncing
 * - Migration of local drafts to remote
 */

import { browser } from '$app/environment';
import { writable, derived, get, type Readable } from 'svelte/store';
import {
  fetchRemoteDrafts,
  publishDraftDebounced,
  publishDraft,
  deleteDraftRemote,
  isDraftSyncAvailable,
  cancelPendingPublish,
  type RemoteDraft
} from '$lib/nip37DraftService';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RecipeDraft {
  id: string;
  title: string;
  images: string[];
  tags: { title: string; emoji?: string }[];
  summary: string;
  chefsnotes: string;
  preptime: string;
  cooktime: string;
  servings: string;
  ingredients: string[];
  directions: string[];
  additionalMarkdown: string;
  createdAt: number;
  updatedAt: number;
}

export interface DraftWithSyncState extends RecipeDraft {
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';
  lastSyncedAt?: number;
  syncError?: string;
}

export interface DraftStoreState {
  drafts: DraftWithSyncState[];
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncAt: number | null;
  syncError: string | null;
  syncAvailable: boolean;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DRAFTS_STORAGE_KEY = 'zapcooking_recipe_drafts';
const SYNC_STATE_KEY = 'zapcooking_draft_sync_state';
const MIGRATION_KEY = 'zapcooking_drafts_migrated_to_nip37';

// Auto-sync interval (5 minutes)
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

// Internal state store
const stateStore = writable<DraftStoreState>({
  drafts: [],
  isLoading: false,
  isSyncing: false,
  lastSyncAt: null,
  syncError: null,
  syncAvailable: false
});

// Auto-sync timer
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

// ═══════════════════════════════════════════════════════════════
// DERIVED STORES (for backward compatibility)
// ═══════════════════════════════════════════════════════════════

// Backward compatible drafts store (just the drafts array)
export const draftsStore: Readable<RecipeDraft[]> = derived(
  stateStore,
  ($state) => $state.drafts as RecipeDraft[]
);

// Sync state store
export const draftSyncState: Readable<{
  isSyncing: boolean;
  lastSyncAt: number | null;
  syncError: string | null;
  syncAvailable: boolean;
}> = derived(stateStore, ($state) => ({
  isSyncing: $state.isSyncing,
  lastSyncAt: $state.lastSyncAt,
  syncError: $state.syncError,
  syncAvailable: $state.syncAvailable
}));

// ═══════════════════════════════════════════════════════════════
// LOCAL STORAGE OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Load drafts from localStorage
 */
function loadLocalDrafts(): DraftWithSyncState[] {
  if (!browser) return [];

  try {
    const stored = localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (stored) {
      const drafts = JSON.parse(stored) as RecipeDraft[];
      // Add sync status to legacy drafts
      return drafts.map((d) => ({
        ...d,
        syncStatus: 'local' as const
      }));
    }
  } catch (error) {
    console.error('[DraftStore] Error loading drafts:', error);
  }

  return [];
}

/**
 * Save drafts to localStorage
 */
function saveLocalDrafts(drafts: DraftWithSyncState[]): void {
  if (!browser) return;

  try {
    // Strip sync state before saving to localStorage
    const cleanDrafts = drafts.map((d) => {
      const { syncStatus, lastSyncedAt, syncError, ...draft } = d;
      return draft;
    });
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(cleanDrafts));
  } catch (error) {
    console.error('[DraftStore] Error saving drafts:', error);
  }
}

/**
 * Load sync state from localStorage
 */
function loadSyncState(): { lastSyncAt: number | null } {
  if (!browser) return { lastSyncAt: null };

  try {
    const stored = localStorage.getItem(SYNC_STATE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('[DraftStore] Error loading sync state:', error);
  }

  return { lastSyncAt: null };
}

/**
 * Save sync state to localStorage
 */
function saveSyncState(state: { lastSyncAt: number | null }): void {
  if (!browser) return;

  try {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('[DraftStore] Error saving sync state:', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// MERGE LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * Merge local and remote drafts
 * - Keeps the newest version of each draft
 * - Remote drafts are marked as synced
 * - Local-only drafts are marked for sync
 */
function mergeDrafts(
  localDrafts: DraftWithSyncState[],
  remoteDrafts: RemoteDraft[]
): DraftWithSyncState[] {
  const merged = new Map<string, DraftWithSyncState>();

  // Add remote drafts first (they're authoritative if synced)
  for (const remote of remoteDrafts) {
    merged.set(remote.id, {
      ...remote.draft,
      id: remote.id,
      syncStatus: 'synced',
      lastSyncedAt: remote.createdAt
    });
  }

  // Merge local drafts
  for (const local of localDrafts) {
    const existing = merged.get(local.id);

    if (!existing) {
      // New local-only draft
      merged.set(local.id, {
        ...local,
        syncStatus: 'local'
      });
    } else if (local.updatedAt > existing.updatedAt) {
      // Local is newer - needs sync
      merged.set(local.id, {
        ...local,
        syncStatus: 'local',
        lastSyncedAt: existing.lastSyncedAt
      });
    }
    // Otherwise keep the remote version (it's newer or same)
  }

  // Sort by most recently updated
  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize the draft store
 * Loads local drafts and starts sync if available
 */
export function initializeDraftStore(): void {
  if (!browser) return;

  const localDrafts = loadLocalDrafts();
  const syncState = loadSyncState();
  const syncAvailable = isDraftSyncAvailable();

  stateStore.set({
    drafts: localDrafts,
    isLoading: false,
    isSyncing: false,
    lastSyncAt: syncState.lastSyncAt,
    syncError: null,
    syncAvailable
  });

  // Start auto-sync if available
  if (syncAvailable) {
    startAutoSync();
    // Do initial sync in background
    syncDrafts().catch(console.error);
  }
}

/**
 * Update sync availability (call when auth state changes)
 */
export function updateSyncAvailability(): void {
  const syncAvailable = isDraftSyncAvailable();

  stateStore.update((s) => ({
    ...s,
    syncAvailable
  }));

  if (syncAvailable && !autoSyncTimer) {
    startAutoSync();
    syncDrafts().catch(console.error);
  } else if (!syncAvailable && autoSyncTimer) {
    stopAutoSync();
  }
}

// ═══════════════════════════════════════════════════════════════
// SYNC OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Sync drafts with remote relays
 */
export async function syncDrafts(): Promise<void> {
  if (!browser) return;

  const state = get(stateStore);
  if (!state.syncAvailable || state.isSyncing) return;

  stateStore.update((s) => ({
    ...s,
    isSyncing: true,
    syncError: null
  }));

  try {
    // Fetch remote drafts
    const remoteDrafts = await fetchRemoteDrafts();

    // Get current local drafts
    const localDrafts = loadLocalDrafts();

    // Merge
    const merged = mergeDrafts(localDrafts, remoteDrafts);

    // Save merged drafts locally
    saveLocalDrafts(merged);

    // Publish any local-only drafts to remote
    const localOnlyDrafts = merged.filter((d) => d.syncStatus === 'local');
    for (const draft of localOnlyDrafts) {
      try {
        await publishDraft(draft);
        draft.syncStatus = 'synced';
        draft.lastSyncedAt = Date.now();
      } catch (e) {
        console.error(`[DraftStore] Failed to sync draft ${draft.id}:`, e);
        draft.syncStatus = 'error';
        draft.syncError = e instanceof Error ? e.message : 'Sync failed';
      }
    }

    // Save again with updated sync status
    saveLocalDrafts(merged);

    const now = Date.now();
    saveSyncState({ lastSyncAt: now });

    stateStore.update((s) => ({
      ...s,
      drafts: merged,
      isSyncing: false,
      lastSyncAt: now,
      syncError: null
    }));

    console.log(`[DraftStore] Sync complete: ${merged.length} drafts`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[DraftStore] Sync failed:', error);

    stateStore.update((s) => ({
      ...s,
      isSyncing: false,
      syncError: errorMessage
    }));
  }
}

/**
 * Start auto-sync timer
 */
function startAutoSync(): void {
  if (autoSyncTimer) return;

  autoSyncTimer = setInterval(() => {
    if (isDraftSyncAvailable()) {
      syncDrafts().catch(console.error);
    }
  }, AUTO_SYNC_INTERVAL_MS);
}

/**
 * Stop auto-sync timer
 */
function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// DRAFT OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Load all drafts (returns current state)
 */
export function loadDrafts(): RecipeDraft[] {
  if (!browser) return [];

  const state = get(stateStore);
  if (state.drafts.length > 0) {
    return state.drafts;
  }

  // Initialize if not already
  const localDrafts = loadLocalDrafts();
  stateStore.update((s) => ({
    ...s,
    drafts: localDrafts
  }));

  return localDrafts;
}

/**
 * Generate a unique ID for a draft
 */
function generateDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Save a new draft or update an existing one
 * @param draft - The draft data to save
 * @param existingId - Optional ID of existing draft to update
 * @param syncImmediately - If true, syncs to relays immediately instead of debouncing
 * @returns Object with draftId and optional syncPromise
 */
export function saveDraft(
  draft: Omit<RecipeDraft, 'id' | 'createdAt' | 'updatedAt'>,
  existingId?: string,
  syncImmediately: boolean = false
): { draftId: string; syncPromise?: Promise<boolean> } {
  const state = get(stateStore);
  let drafts = [...state.drafts];
  const now = Date.now();

  let draftId: string;

  if (existingId) {
    // Update existing draft
    const index = drafts.findIndex((d) => d.id === existingId);
    if (index !== -1) {
      drafts[index] = {
        ...drafts[index],
        ...draft,
        updatedAt: now,
        syncStatus: state.syncAvailable ? 'syncing' : 'local'
      };
      draftId = existingId;
    } else {
      // ID not found, create new
      draftId = generateDraftId();
      const newDraft: DraftWithSyncState = {
        ...draft,
        id: draftId,
        createdAt: now,
        updatedAt: now,
        syncStatus: state.syncAvailable ? 'syncing' : 'local'
      };
      drafts.unshift(newDraft);
    }
  } else {
    // Create new draft
    draftId = generateDraftId();
    const newDraft: DraftWithSyncState = {
      ...draft,
      id: draftId,
      createdAt: now,
      updatedAt: now,
      syncStatus: state.syncAvailable ? 'syncing' : 'local'
    };
    drafts.unshift(newDraft);
  }

  // Sort by most recently updated
  drafts.sort((a, b) => b.updatedAt - a.updatedAt);

  // Save locally
  saveLocalDrafts(drafts);

  // Update store
  stateStore.update((s) => ({
    ...s,
    drafts
  }));

  // Handle remote sync
  let syncPromise: Promise<boolean> | undefined;

  if (state.syncAvailable) {
    const savedDraft = drafts.find((d) => d.id === draftId);
    if (savedDraft) {
      if (syncImmediately) {
        // Sync immediately and return promise
        syncPromise = publishDraft(savedDraft).then((success) => {
          // Update sync status based on result
          stateStore.update((s) => {
            const updatedDrafts = s.drafts.map((d) => {
              if (d.id === draftId) {
                return {
                  ...d,
                  syncStatus: success ? ('synced' as const) : ('error' as const),
                  lastSyncedAt: success ? Date.now() : d.lastSyncedAt,
                  syncError: success ? undefined : 'Failed to sync to relays'
                };
              }
              return d;
            });
            saveLocalDrafts(updatedDrafts);
            return { ...s, drafts: updatedDrafts };
          });
          return success;
        });
      } else {
        // Queue for debounced sync
        publishDraftDebounced(savedDraft);
      }
    }
  }

  return { draftId, syncPromise };
}

/**
 * Get a draft by ID
 */
export function getDraft(id: string): RecipeDraft | undefined {
  const state = get(stateStore);
  return state.drafts.find((d) => d.id === id);
}

/**
 * Get a draft with sync state by ID
 */
export function getDraftWithSyncState(id: string): DraftWithSyncState | undefined {
  const state = get(stateStore);
  return state.drafts.find((d) => d.id === id);
}

/**
 * Delete a draft by ID
 */
export function deleteDraft(id: string): boolean {
  const state = get(stateStore);
  const index = state.drafts.findIndex((d) => d.id === id);

  if (index === -1) return false;

  // Cancel any pending remote publish
  cancelPendingPublish(id);

  const drafts = [...state.drafts];
  drafts.splice(index, 1);

  // Save locally
  saveLocalDrafts(drafts);

  // Update store
  stateStore.update((s) => ({
    ...s,
    drafts
  }));

  // Delete from remote (fire and forget)
  if (state.syncAvailable) {
    deleteDraftRemote(id).catch((e) => {
      console.error(`[DraftStore] Failed to delete draft ${id} from remote:`, e);
    });
  }

  return true;
}

/**
 * Get the count of drafts
 */
export function getDraftCount(): number {
  return get(stateStore).drafts.length;
}

/**
 * Clear all drafts (use with caution)
 */
export function clearAllDrafts(): void {
  if (!browser) return;

  const state = get(stateStore);

  // Cancel all pending publishes
  for (const draft of state.drafts) {
    cancelPendingPublish(draft.id);
  }

  localStorage.removeItem(DRAFTS_STORAGE_KEY);

  stateStore.update((s) => ({
    ...s,
    drafts: []
  }));

  // Delete all from remote (fire and forget)
  if (state.syncAvailable) {
    for (const draft of state.drafts) {
      deleteDraftRemote(draft.id).catch(console.error);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// MIGRATION
// ═══════════════════════════════════════════════════════════════

/**
 * Migrate existing local drafts to NIP-37
 * Should be called once when user first enables sync
 */
export async function migrateLocalDraftsToRemote(): Promise<{ migrated: number; failed: number }> {
  if (!browser) return { migrated: 0, failed: 0 };

  const state = get(stateStore);
  if (!state.syncAvailable) {
    return { migrated: 0, failed: 0 };
  }

  // Check if already migrated
  const alreadyMigrated = localStorage.getItem(MIGRATION_KEY);
  if (alreadyMigrated) {
    console.log('[DraftStore] Drafts already migrated');
    return { migrated: 0, failed: 0 };
  }

  let migrated = 0;
  let failed = 0;

  const drafts = [...state.drafts];

  for (const draft of drafts) {
    if (draft.syncStatus === 'local') {
      try {
        await publishDraft(draft);
        draft.syncStatus = 'synced';
        draft.lastSyncedAt = Date.now();
        migrated++;
      } catch (e) {
        console.error(`[DraftStore] Failed to migrate draft ${draft.id}:`, e);
        draft.syncStatus = 'error';
        draft.syncError = e instanceof Error ? e.message : 'Migration failed';
        failed++;
      }
    }
  }

  // Save updated drafts
  saveLocalDrafts(drafts);

  stateStore.update((s) => ({
    ...s,
    drafts
  }));

  // Mark as migrated
  if (failed === 0) {
    localStorage.setItem(MIGRATION_KEY, Date.now().toString());
  }

  console.log(`[DraftStore] Migration complete: ${migrated} migrated, ${failed} failed`);
  return { migrated, failed };
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Format a timestamp for display
 */
export function formatDraftDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

  return date.toLocaleDateString();
}

/**
 * Get sync status summary
 */
export function getSyncStatusSummary(): {
  total: number;
  synced: number;
  pending: number;
  errors: number;
} {
  const state = get(stateStore);

  return {
    total: state.drafts.length,
    synced: state.drafts.filter((d) => d.syncStatus === 'synced').length,
    pending: state.drafts.filter((d) => d.syncStatus === 'local' || d.syncStatus === 'syncing')
      .length,
    errors: state.drafts.filter((d) => d.syncStatus === 'error').length
  };
}

/**
 * Force refresh from remote
 */
export async function forceRefreshFromRemote(): Promise<void> {
  if (!isDraftSyncAvailable()) return;

  stateStore.update((s) => ({
    ...s,
    isSyncing: true,
    syncError: null
  }));

  try {
    const remoteDrafts = await fetchRemoteDrafts();

    // Convert remote drafts to local format
    const drafts: DraftWithSyncState[] = remoteDrafts.map((r) => ({
      ...r.draft,
      id: r.id,
      syncStatus: 'synced' as const,
      lastSyncedAt: r.createdAt
    }));

    // Sort by most recently updated
    drafts.sort((a, b) => b.updatedAt - a.updatedAt);

    // Save locally
    saveLocalDrafts(drafts);

    const now = Date.now();
    saveSyncState({ lastSyncAt: now });

    stateStore.update((s) => ({
      ...s,
      drafts,
      isSyncing: false,
      lastSyncAt: now,
      syncError: null
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    stateStore.update((s) => ({
      ...s,
      isSyncing: false,
      syncError: errorMessage
    }));
  }
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════

/**
 * Cleanup function (call on app unmount or logout)
 */
export function cleanupDraftStore(): void {
  stopAutoSync();
}
