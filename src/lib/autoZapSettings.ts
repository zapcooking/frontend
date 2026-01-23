/**
 * One-Tap Zap Settings
 *
 * Allows users to send zaps with a single tap on preset amounts,
 * skipping the zap modal entirely. Only applies to in-app wallets (Spark/NWC).
 *
 * The threshold is the user's preferred default zap amount - tapping a preset
 * at or below this amount sends immediately without showing the modal.
 *
 * Bitcoin Connect has its own confirmation modal, so one-tap zaps don't apply.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { ndk, userPublickey, ndkReady } from '$lib/nostr';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { getOutboxRelays } from '$lib/relayListCache';
import { CLIENT_TAG_IDENTIFIER } from '$lib/consts';

// Storage keys
const ONE_TAP_ZAP_ENABLED_KEY = 'zapcooking_one_tap_zap_enabled';
const ONE_TAP_ZAP_AMOUNT_KEY = 'zapcooking_one_tap_zap_amount';

// Default amount in sats (user's preferred zap amount)
const DEFAULT_AMOUNT = 21;

// Maximum allowed amount (safety limit)
export const MAX_ONE_TAP_ZAP_AMOUNT = 10000;

// Nostr settings
const SETTINGS_KIND = 30078;
const SETTINGS_D_TAG = 'one-tap-zap-settings';

export interface OneTapZapSettings {
  enabled: boolean;
  amount: number;
}

let isLoadingFromRelay = false;
let lastLoadedPubkey = '';

/**
 * Load one-tap zap enabled state from localStorage
 */
function loadEnabled(): boolean {
  if (!browser) return false;
  try {
    // Check new key first, then fall back to old key for migration
    const stored =
      localStorage.getItem(ONE_TAP_ZAP_ENABLED_KEY) ??
      localStorage.getItem('zapcooking_auto_zap_enabled');
    return stored === 'true';
  } catch {
    return false;
  }
}

function normalizeSettings(settings: Partial<OneTapZapSettings>): OneTapZapSettings {
  return {
    enabled: !!settings.enabled,
    amount:
      typeof settings.amount === 'number'
        ? Math.min(Math.max(1, settings.amount), MAX_ONE_TAP_ZAP_AMOUNT)
        : DEFAULT_AMOUNT
  };
}

function applySettings(settings: OneTapZapSettings): void {
  oneTapZapEnabled.set(settings.enabled);
  oneTapZapAmount.set(settings.amount);
  saveEnabled(settings.enabled);
  saveAmount(settings.amount);
}

/**
 * Load one-tap zap amount from localStorage
 */
function loadAmount(): number {
  if (!browser) return DEFAULT_AMOUNT;
  try {
    // Check new key first, then fall back to old key for migration
    const stored =
      localStorage.getItem(ONE_TAP_ZAP_AMOUNT_KEY) ??
      localStorage.getItem('zapcooking_auto_zap_threshold');
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= MAX_ONE_TAP_ZAP_AMOUNT) {
        return parsed;
      }
    }
    return DEFAULT_AMOUNT;
  } catch {
    return DEFAULT_AMOUNT;
  }
}

/**
 * Save one-tap zap enabled state to localStorage
 */
function saveEnabled(enabled: boolean): void {
  if (!browser) return;
  try {
    localStorage.setItem(ONE_TAP_ZAP_ENABLED_KEY, String(enabled));
    // Clean up old key if it exists
    localStorage.removeItem('zapcooking_auto_zap_enabled');
  } catch {
    // Ignore storage errors
  }
}

/**
 * Save one-tap zap amount to localStorage
 */
function saveAmount(amount: number): void {
  if (!browser) return;
  try {
    localStorage.setItem(ONE_TAP_ZAP_AMOUNT_KEY, String(amount));
    // Clean up old key if it exists
    localStorage.removeItem('zapcooking_auto_zap_threshold');
  } catch {
    // Ignore storage errors
  }
}

// --- Stores ---

/** Whether one-tap zap is enabled */
export const oneTapZapEnabled = writable<boolean>(false);

/** One-tap zap amount in sats - user's preferred default zap amount */
export const oneTapZapAmount = writable<number>(DEFAULT_AMOUNT);

// Legacy exports for compatibility during transition
export const autoZapEnabled = oneTapZapEnabled;
export const autoZapThreshold = oneTapZapAmount;
export const MAX_AUTO_ZAP_THRESHOLD = MAX_ONE_TAP_ZAP_AMOUNT;

// Track if we've loaded from storage
let hasLoaded = false;

// Load from localStorage on client
if (browser) {
  setTimeout(() => {
    hasLoaded = true;
    oneTapZapEnabled.set(loadEnabled());
    oneTapZapAmount.set(loadAmount());
  }, 0);
}

// Persist changes
oneTapZapEnabled.subscribe((enabled) => {
  if (browser && hasLoaded) {
    saveEnabled(enabled);
  }
});

oneTapZapAmount.subscribe((amount) => {
  if (browser && hasLoaded) {
    saveAmount(amount);
  }
});

// --- Nostr Sync ---

export async function loadOneTapZapSettings(): Promise<OneTapZapSettings> {
  const localSettings = normalizeSettings({
    enabled: loadEnabled(),
    amount: loadAmount()
  });
  applySettings(localSettings);

  if (!browser) return localSettings;

  const pubkey = get(userPublickey);
  if (!pubkey) {
    console.log('[OneTapZap] No user logged in, using localStorage');
    return localSettings;
  }

  if (isLoadingFromRelay || lastLoadedPubkey === pubkey) {
    return localSettings;
  }

  isLoadingFromRelay = true;
  lastLoadedPubkey = pubkey;

  try {
    await get(ndkReady);
    const ndkInstance = get(ndk);
    if (!ndkInstance) return localSettings;

    const events = await ndkInstance.fetchEvents({
      kinds: [SETTINGS_KIND],
      authors: [pubkey],
      '#d': [SETTINGS_D_TAG]
    });

    if (events.size === 0) {
      console.log('[OneTapZap] No relay settings found, using localStorage');
      return localSettings;
    }

    const sortedEvents = Array.from(events).sort(
      (a, b) => (b.created_at || 0) - (a.created_at || 0)
    );
    const latestEvent = sortedEvents[0];

    const relaySettings = normalizeSettings(JSON.parse(latestEvent.content));
    applySettings(relaySettings);
    console.log('[OneTapZap] Loaded from relay:', relaySettings);
    return relaySettings;
  } catch (e) {
    console.error('[OneTapZap] Error loading from relay:', e);
    return localSettings;
  } finally {
    isLoadingFromRelay = false;
  }
}

async function publishOneTapZapSettings(settings: OneTapZapSettings): Promise<boolean> {
  if (!browser) return false;

  const pubkey = get(userPublickey);
  if (!pubkey) {
    console.log('[OneTapZap] No user logged in, skipping relay save');
    return true;
  }

  try {
    await get(ndkReady);
    const ndkInstance = get(ndk);
    if (!ndkInstance) return false;

    const event = new NDKEvent(ndkInstance);
    event.kind = SETTINGS_KIND;
    event.content = JSON.stringify(settings);
    event.tags = [
      ['d', SETTINGS_D_TAG],
      ['client', CLIENT_TAG_IDENTIFIER]
    ];

    const outboxRelays = await getOutboxRelays(pubkey);

    await event.sign();
    await event.publish(outboxRelays);

    console.log('[OneTapZap] Saved to relay:', settings);
    return true;
  } catch (e) {
    console.error('[OneTapZap] Error saving to relay:', e);
    return false;
  }
}

// --- Functions ---

/**
 * Set one-tap zap enabled state
 */
export function setOneTapZapEnabled(enabled: boolean): void {
  oneTapZapEnabled.set(enabled);
  const settings = normalizeSettings({
    enabled,
    amount: get(oneTapZapAmount)
  });
  void publishOneTapZapSettings(settings);
}

/**
 * Set one-tap zap amount (capped at MAX_ONE_TAP_ZAP_AMOUNT)
 */
export function setOneTapZapAmount(sats: number): void {
  const capped = Math.min(Math.max(1, sats), MAX_ONE_TAP_ZAP_AMOUNT);
  oneTapZapAmount.set(capped);
  const settings = normalizeSettings({
    enabled: get(oneTapZapEnabled),
    amount: capped
  });
  void publishOneTapZapSettings(settings);
}

/**
 * Check if a given amount qualifies for one-tap zap
 * @param amount Amount in sats
 * @returns true if one-tap zap is enabled and amount is within the user's preferred amount
 */
export function isOneTapZapAmount(amount: number): boolean {
  return get(oneTapZapEnabled) && amount <= get(oneTapZapAmount);
}

/**
 * Get current one-tap zap enabled state
 */
export function getOneTapZapEnabled(): boolean {
  return get(oneTapZapEnabled);
}

/**
 * Get current one-tap zap amount
 */
export function getOneTapZapAmount(): number {
  return get(oneTapZapAmount);
}

// Legacy function exports for compatibility
export const setAutoZapEnabled = setOneTapZapEnabled;
export const setAutoZapThreshold = setOneTapZapAmount;
export const isAutoZapAmount = isOneTapZapAmount;
export const getAutoZapEnabled = getOneTapZapEnabled;
export const getAutoZapThreshold = getOneTapZapAmount;
