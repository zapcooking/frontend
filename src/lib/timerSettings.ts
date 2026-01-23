/**
 * Timer Settings Service
 *
 * Stores timer preferences (sound, position) using NIP-78 (kind 30078).
 * Settings are NOT encrypted since they're not sensitive.
 *
 * Event Structure:
 * - kind: 30078 (NIP-78 Application-specific Data)
 * - d tag: "timer-settings" (addressable/replaceable)
 * - client tag: "zap.cooking"
 * - content: JSON payload with settings
 */

import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import { ndk, userPublickey, ndkReady } from '$lib/nostr';
// Note: ndkReady is a Promise, not a store - use await ndkReady, not get(ndkReady)
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { getOutboxRelays } from '$lib/relayListCache';
import { CLIENT_TAG_IDENTIFIER } from '$lib/consts';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface TimerSettings {
  soundEnabled: boolean;
  positionX: number | null;
  positionY: number | null;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SETTINGS_KIND = 30078;
const SETTINGS_D_TAG = 'timer-settings';
const LOCAL_STORAGE_KEY = 'timerSettings';

// Default settings
const DEFAULT_SETTINGS: TimerSettings = {
  soundEnabled: true,
  positionX: null,
  positionY: null,
};

// ═══════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════

export const timerSettings = writable<TimerSettings>(DEFAULT_SETTINGS);

// ═══════════════════════════════════════════════════════════════
// LOCAL STORAGE (fallback for logged-out users)
// ═══════════════════════════════════════════════════════════════

function loadFromLocalStorage(): TimerSettings {
  if (!browser) return DEFAULT_SETTINGS;

  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error('[TimerSettings] Error loading from localStorage:', e);
  }
  return DEFAULT_SETTINGS;
}

function saveToLocalStorage(settings: TimerSettings): void {
  if (!browser) return;

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('[TimerSettings] Error saving to localStorage:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// NOSTR SYNC
// ═══════════════════════════════════════════════════════════════

/**
 * Load timer settings from Nostr relays (or localStorage fallback)
 */
export async function loadTimerSettings(): Promise<TimerSettings> {
  // Always start with localStorage (immediate)
  const localSettings = loadFromLocalStorage();
  timerSettings.set(localSettings);

  if (!browser) return localSettings;

  const pubkey = get(userPublickey);
  if (!pubkey) {
    console.log('[TimerSettings] No user logged in, using localStorage');
    return localSettings;
  }

  try {
    await ndkReady;
    const ndkInstance = get(ndk);
    if (!ndkInstance) return localSettings;

    // Fetch settings from relays
    const events = await ndkInstance.fetchEvents({
      kinds: [SETTINGS_KIND],
      authors: [pubkey],
      '#d': [SETTINGS_D_TAG],
    });

    if (events.size === 0) {
      console.log('[TimerSettings] No relay settings found, using localStorage');
      return localSettings;
    }

    // Get most recent event
    const sortedEvents = Array.from(events).sort((a, b) =>
      (b.created_at || 0) - (a.created_at || 0)
    );
    const latestEvent = sortedEvents[0];

    const relaySettings = JSON.parse(latestEvent.content) as TimerSettings;
    const mergedSettings = { ...DEFAULT_SETTINGS, ...relaySettings };

    console.log('[TimerSettings] Loaded from relay:', mergedSettings);
    timerSettings.set(mergedSettings);
    saveToLocalStorage(mergedSettings); // Sync to localStorage

    return mergedSettings;
  } catch (e) {
    console.error('[TimerSettings] Error loading from relay:', e);
    return localSettings;
  }
}

/**
 * Save timer settings to Nostr relays (and localStorage)
 */
export async function saveTimerSettings(settings: TimerSettings): Promise<boolean> {
  // Always save to localStorage immediately
  saveToLocalStorage(settings);
  timerSettings.set(settings);

  if (!browser) return false;

  const pubkey = get(userPublickey);
  if (!pubkey) {
    console.log('[TimerSettings] No user logged in, saved to localStorage only');
    return true;
  }

  try {
    await ndkReady;
    const ndkInstance = get(ndk);
    if (!ndkInstance) return false;

    // Create NIP-78 event
    const event = new NDKEvent(ndkInstance);
    event.kind = SETTINGS_KIND;
    event.content = JSON.stringify(settings);
    event.tags = [
      ['d', SETTINGS_D_TAG],
      ['client', CLIENT_TAG_IDENTIFIER],
    ];

    // Get user's outbox relays
    const outboxRelays = await getOutboxRelays(pubkey);

    // Sign and publish
    await event.sign();
    await event.publish(outboxRelays);

    console.log('[TimerSettings] Saved to relay:', settings);
    return true;
  } catch (e) {
    console.error('[TimerSettings] Error saving to relay:', e);
    return false;
  }
}

/**
 * Update a single setting
 */
export async function updateTimerSetting<K extends keyof TimerSettings>(
  key: K,
  value: TimerSettings[K]
): Promise<void> {
  const current = get(timerSettings);
  const updated = { ...current, [key]: value };
  await saveTimerSettings(updated);
}
