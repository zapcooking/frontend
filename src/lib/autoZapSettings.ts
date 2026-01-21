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

// Storage keys
const ONE_TAP_ZAP_ENABLED_KEY = 'zapcooking_one_tap_zap_enabled';
const ONE_TAP_ZAP_AMOUNT_KEY = 'zapcooking_one_tap_zap_amount';

// Default amount in sats (user's preferred zap amount)
const DEFAULT_AMOUNT = 21;

// Maximum allowed amount (safety limit)
export const MAX_ONE_TAP_ZAP_AMOUNT = 10000;

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

// --- Functions ---

/**
 * Set one-tap zap enabled state
 */
export function setOneTapZapEnabled(enabled: boolean): void {
  oneTapZapEnabled.set(enabled);
}

/**
 * Set one-tap zap amount (capped at MAX_ONE_TAP_ZAP_AMOUNT)
 */
export function setOneTapZapAmount(sats: number): void {
  const capped = Math.min(Math.max(1, sats), MAX_ONE_TAP_ZAP_AMOUNT);
  oneTapZapAmount.set(capped);
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
