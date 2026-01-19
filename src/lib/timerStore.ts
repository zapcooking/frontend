/**
 * Timer Store - Multi-timer support with IndexedDB persistence
 *
 * This store manages cooking timers that:
 * - Persist across app restarts using IndexedDB
 * - Schedule iOS local notifications for background alerting
 * - Support multiple concurrent timers
 *
 * ARCHITECTURE NOTE:
 * We use local notifications for background alerts because JavaScript timers
 * (setInterval/setTimeout) do NOT run when the app is backgrounded on iOS/Android.
 * The OS suspends JS execution to save battery. Local notifications are scheduled
 * with the OS and fire reliably regardless of app state.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
// Note: Notification imports are intentionally left in place but unused
// to keep timers as simple in-app timers with no permission prompts
import {
  ensureNotificationPermission,
  scheduleTimerNotification,
  cancelTimerNotification,
  checkNotificationPermissions,
  type PermissionStatus
} from '$lib/native/notifications';

// =============================================================================
// Types
// =============================================================================

export type TimerStatus = 'running' | 'paused' | 'done' | 'canceled';

export interface TimerItem {
  id: number; // Unique ID (also used as notification ID)
  label: string; // User-provided label (e.g., "Pasta", "Eggs")
  durationMs: number; // Original duration in milliseconds
  endsAt: number; // When the timer will end (epoch ms) - only valid when running
  status: TimerStatus;
  createdAt: number; // When the timer was created (epoch ms)
  pausedRemainingMs?: number; // Remaining time when paused (ms)
}

interface TimerStoreState {
  timers: TimerItem[];
  nextId: number; // Counter for generating unique IDs
  notificationPermission: PermissionStatus;
}

// =============================================================================
// IndexedDB Storage
// =============================================================================

const DB_NAME = 'zapcooking-timers';
const DB_VERSION = 1;
const TIMERS_STORE = 'timers';
const META_STORE = 'meta';

let db: IDBDatabase | null = null;
let dbReady: Promise<void>;
let dbReadyResolve: () => void;

// Initialize the promise
dbReady = new Promise((resolve) => {
  dbReadyResolve = resolve;
});

async function initDatabase(): Promise<void> {
  if (!browser || typeof window === 'undefined') {
    dbReadyResolve();
    return;
  }

  const idb = (globalThis as any).indexedDB;
  if (!idb) {
    console.warn('[TimerStore] IndexedDB not available');
    dbReadyResolve();
    return;
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[TimerStore] Failed to open database:', request.error);
      dbReadyResolve();
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[TimerStore] Database initialized');
      dbReadyResolve();
      resolve();
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create timers store
      if (!database.objectStoreNames.contains(TIMERS_STORE)) {
        database.createObjectStore(TIMERS_STORE, { keyPath: 'id' });
      }

      // Create meta store for nextId counter
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
  });
}

// Initialize DB on module load in browser
if (browser) {
  initDatabase().catch(console.error);
}

async function saveTimersToDb(timers: TimerItem[]): Promise<void> {
  await dbReady;
  if (!db) return;

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([TIMERS_STORE], 'readwrite');
    const store = transaction.objectStore(TIMERS_STORE);

    // Clear existing and add all timers
    store.clear();
    timers.forEach((timer) => store.put(timer));

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function loadTimersFromDb(): Promise<TimerItem[]> {
  await dbReady;
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([TIMERS_STORE], 'readonly');
    const store = transaction.objectStore(TIMERS_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function saveNextId(nextId: number): Promise<void> {
  await dbReady;
  if (!db) return;

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([META_STORE], 'readwrite');
    const store = transaction.objectStore(META_STORE);
    store.put({ key: 'nextId', value: nextId });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function loadNextId(): Promise<number> {
  await dbReady;
  if (!db) return 1;

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([META_STORE], 'readonly');
    const store = transaction.objectStore(META_STORE);
    const request = store.get('nextId');

    request.onsuccess = () => {
      const result = request.result;
      resolve(result?.value || 1);
    };
    request.onerror = () => reject(request.error);
  });
}

// =============================================================================
// Store Implementation
// =============================================================================

const initialState: TimerStoreState = {
  timers: [],
  nextId: 1,
  notificationPermission: 'prompt'
};

const { subscribe, set, update } = writable<TimerStoreState>(initialState);

/**
 * Persist timers to IndexedDB whenever state changes
 */
function persistState(state: TimerStoreState) {
  if (!browser) return;
  saveTimersToDb(state.timers).catch(console.error);
  saveNextId(state.nextId).catch(console.error);
}

/**
 * Load timers from storage and reconcile state
 * - Marks any running timers as 'done' if their endsAt has passed
 */
export async function loadTimers(): Promise<void> {
  if (!browser) return;

  try {
    const [timers, nextId] = await Promise.all([loadTimersFromDb(), loadNextId()]);

    const now = Date.now();

    // Process timers: mark expired running timers as done
    const processedTimers = timers.map((timer) => {
      if (timer.status === 'running' && now >= timer.endsAt) {
        return { ...timer, status: 'done' as TimerStatus };
      }
      return timer;
    });

    set({
      timers: processedTimers,
      nextId: Math.max(nextId, ...processedTimers.map((t) => t.id + 1), 1),
      // Keep notificationPermission field for backwards compatibility, but don't check permissions
      notificationPermission: 'prompt'
    });

    // Save any state changes (expired timers marked as done)
    if (processedTimers.some((t, i) => t.status !== timers[i]?.status)) {
      await saveTimersToDb(processedTimers);
    }

    console.log('[TimerStore] Loaded', processedTimers.length, 'timers');
  } catch (error) {
    console.error('[TimerStore] Error loading timers:', error);
  }
}

/**
 * Create and start a new timer
 */
export async function startTimer(label: string, durationMs: number): Promise<TimerItem | null> {
  if (!browser || !Number.isFinite(durationMs)) return null;
  const minMs = 0.1 * 60 * 1000;
  const maxMs = 999 * 60 * 1000;
  const clampedMs = Math.min(maxMs, Math.max(minMs, durationMs));

  const state = get({ subscribe });
  const id = state.nextId;
  const now = Date.now();
  const endsAt = now + clampedMs;

  const newTimer: TimerItem = {
    id,
    label: label.trim() || 'Timer',
    durationMs: clampedMs,
    endsAt,
    status: 'running',
    createdAt: now
  };

  // Note: Notification scheduling code is intentionally disabled
  // to keep timers as simple in-app timers with no permission prompts

  update((s) => {
    const newState = {
      ...s,
      timers: [...s.timers, newTimer],
      nextId: s.nextId + 1
    };
    persistState(newState);
    return newState;
  });

  console.log('[TimerStore] Started timer:', id, label, 'duration:', durationMs);
  return newTimer;
}

/**
 * Pause a running timer
 */
export async function pauseTimer(id: number): Promise<void> {
  const state = get({ subscribe });
  const timer = state.timers.find((t) => t.id === id);

  if (!timer || timer.status !== 'running') return;

  const now = Date.now();
  const remainingMs = Math.max(0, timer.endsAt - now);

  // Note: Notification cancellation code is intentionally disabled
  // since we're not scheduling notifications

  update((s) => {
    const newState = {
      ...s,
      timers: s.timers.map((t) =>
        t.id === id ? { ...t, status: 'paused' as TimerStatus, pausedRemainingMs: remainingMs } : t
      )
    };
    persistState(newState);
    return newState;
  });

  console.log('[TimerStore] Paused timer:', id, 'remaining:', remainingMs);
}

/**
 * Resume a paused timer
 */
export async function resumeTimer(id: number): Promise<void> {
  const state = get({ subscribe });
  const timer = state.timers.find((t) => t.id === id);

  if (!timer || timer.status !== 'paused' || !timer.pausedRemainingMs) return;

  const now = Date.now();
  const endsAt = now + timer.pausedRemainingMs;

  // Note: Notification scheduling code is intentionally disabled
  // to keep timers as simple in-app timers with no permission prompts

  update((s) => {
    const newState = {
      ...s,
      timers: s.timers.map((t) =>
        t.id === id
          ? { ...t, status: 'running' as TimerStatus, endsAt, pausedRemainingMs: undefined }
          : t
      )
    };
    persistState(newState);
    return newState;
  });

  console.log('[TimerStore] Resumed timer:', id, 'new endsAt:', endsAt);
}

/**
 * Cancel/delete a timer
 */
export async function cancelTimer(id: number): Promise<void> {
  // Note: Notification cancellation code is intentionally disabled
  // since we're not scheduling notifications

  update((s) => {
    const newState = {
      ...s,
      timers: s.timers.filter((t) => t.id !== id)
    };
    persistState(newState);
    return newState;
  });

  console.log('[TimerStore] Cancelled timer:', id);
}

/**
 * Mark a timer as done (called when timer reaches 0 in foreground)
 */
export function markTimerDone(id: number): void {
  update((s) => {
    const newState = {
      ...s,
      timers: s.timers.map((t) => (t.id === id ? { ...t, status: 'done' as TimerStatus } : t))
    };
    persistState(newState);
    return newState;
  });

  console.log('[TimerStore] Marked timer done:', id);
}

/**
 * Clear all completed/canceled timers
 */
export function clearCompletedTimers(): void {
  update((s) => {
    const newState = {
      ...s,
      timers: s.timers.filter((t) => t.status === 'running' || t.status === 'paused')
    };
    persistState(newState);
    return newState;
  });
}

/**
 * Get the current state (for non-reactive access)
 */
export function getTimerState(): TimerStoreState {
  return get({ subscribe });
}

/**
 * Update notification permission status
 */
export function updatePermissionStatus(status: PermissionStatus): void {
  update((s) => ({ ...s, notificationPermission: status }));
}

// Export the store for subscription
export const timerStore = { subscribe };

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format milliseconds as MM:SS or HH:MM:SS
 */
export function formatTime(ms: number): string {
  if (ms <= 0) return '00:00';

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Get remaining time for a timer
 */
export function getRemainingTime(timer: TimerItem): number {
  if (timer.status === 'paused') {
    return timer.pausedRemainingMs || 0;
  }
  if (timer.status === 'running') {
    return Math.max(0, timer.endsAt - Date.now());
  }
  return 0;
}
