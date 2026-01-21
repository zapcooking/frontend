/**
 * Bitcoin Connect External Wallet State
 *
 * Manages Bitcoin Connect wallet connections including:
 * - Enabled/disabled state
 * - Connected wallet info (alias, pubkey)
 * - Balance fetching (when supported by wallet)
 *
 * When enabled and no embedded wallet is active, payments use Bitcoin Connect modal.
 * The actual connection happens via lightningService.ts when paying.
 */

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'zapcooking_bitcoin_connect_enabled';

// WebLN provider types
interface WebLNProvider {
  enable(): Promise<void>;
  getInfo?(): Promise<{ node?: { alias?: string; pubkey?: string } }>;
  getBalance?(): Promise<{ balance: number; currency?: string }>;
  sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
}

// Wallet info type
export interface BitcoinConnectWalletInfo {
  alias?: string;
  pubkey?: string;
  connected: boolean;
}

/**
 * Load enabled state from localStorage
 */
function loadEnabled(): boolean {
  if (!browser) return false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
}

/**
 * Save enabled state to localStorage
 */
function saveEnabled(enabled: boolean): void {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage errors
  }
}

// --- Stores ---

/** Whether Bitcoin Connect is enabled as the external wallet option */
export const bitcoinConnectEnabled = writable<boolean>(false);

/** Info about the connected Bitcoin Connect wallet */
export const bitcoinConnectWalletInfo = writable<BitcoinConnectWalletInfo>({
  connected: false
});

/** Balance from Bitcoin Connect wallet (null if unavailable or not connected) */
export const bitcoinConnectBalance = writable<number | null>(null);

/** Whether balance is currently being fetched */
export const bitcoinConnectBalanceLoading = writable<boolean>(false);

// Track if we've loaded from storage
let hasLoaded = false;

// Reference to the WebLN provider when connected
let bcProvider: WebLNProvider | null = null;

// Load from localStorage on client
if (browser) {
  setTimeout(() => {
    hasLoaded = true;
    bitcoinConnectEnabled.set(loadEnabled());
  }, 0);
}

// Persist changes
bitcoinConnectEnabled.subscribe((enabled) => {
  if (browser && hasLoaded) {
    saveEnabled(enabled);
  }
});

// --- Functions ---

/**
 * Set the WebLN provider reference (called from lightningService when connected)
 */
export function setBitcoinConnectProvider(provider: WebLNProvider | null): void {
  bcProvider = provider;
  if (provider) {
    bitcoinConnectWalletInfo.update((info) => ({ ...info, connected: true }));
    // Fetch info and balance when provider is set
    fetchBitcoinConnectInfo();
    fetchBitcoinConnectBalance();
  } else {
    bitcoinConnectWalletInfo.set({ connected: false });
    bitcoinConnectBalance.set(null);
  }
}

/**
 * Get the current WebLN provider
 */
export function getBitcoinConnectProvider(): WebLNProvider | null {
  return bcProvider;
}

/**
 * Fetch wallet info from the connected Bitcoin Connect wallet
 */
export async function fetchBitcoinConnectInfo(): Promise<void> {
  if (!bcProvider) return;

  try {
    if (typeof bcProvider.getInfo === 'function') {
      const info = await bcProvider.getInfo();
      bitcoinConnectWalletInfo.set({
        alias: info.node?.alias,
        pubkey: info.node?.pubkey,
        connected: true
      });
    }
  } catch (e) {
    console.warn('[BitcoinConnect] Failed to fetch wallet info:', e);
    // Keep connected state, just don't update info
  }
}

/**
 * Fetch balance from the connected Bitcoin Connect wallet
 * Returns null if wallet doesn't support getBalance or if fetch fails
 */
export async function fetchBitcoinConnectBalance(): Promise<number | null> {
  if (!bcProvider) {
    bitcoinConnectBalance.set(null);
    return null;
  }

  bitcoinConnectBalanceLoading.set(true);

  try {
    if (typeof bcProvider.getBalance === 'function') {
      const response = await bcProvider.getBalance();
      const balance = response.balance;
      bitcoinConnectBalance.set(balance);
      return balance;
    }
    // Wallet doesn't support getBalance
    bitcoinConnectBalance.set(null);
    return null;
  } catch (e) {
    console.warn('[BitcoinConnect] Failed to fetch balance:', e);
    bitcoinConnectBalance.set(null);
    return null;
  } finally {
    bitcoinConnectBalanceLoading.set(false);
  }
}

/**
 * Refresh Bitcoin Connect balance
 */
export async function refreshBitcoinConnectBalance(): Promise<void> {
  await fetchBitcoinConnectBalance();
}

/**
 * Enable Bitcoin Connect as external wallet
 */
export function enableBitcoinConnect(): void {
  bitcoinConnectEnabled.set(true);
}

/**
 * Disable Bitcoin Connect and clear all state
 */
export function disableBitcoinConnect(): void {
  bitcoinConnectEnabled.set(false);
  bcProvider = null;
  bitcoinConnectWalletInfo.set({ connected: false });
  bitcoinConnectBalance.set(null);

  // Also disconnect any active BC session
  if (browser) {
    import('@getalby/bitcoin-connect')
      .then(({ disconnect }) => {
        try {
          disconnect();
        } catch {
          // Ignore disconnect errors
        }
      })
      .catch(() => {
        // Ignore import errors
      });
  }
}

/**
 * Check if Bitcoin Connect is enabled
 */
export function isBitcoinConnectEnabled(): boolean {
  return get(bitcoinConnectEnabled);
}

/**
 * Check if Bitcoin Connect wallet is currently connected
 */
export function isBitcoinConnectConnected(): boolean {
  return get(bitcoinConnectWalletInfo).connected;
}

/**
 * Get current Bitcoin Connect balance
 */
export function getBitcoinConnectBalance(): number | null {
  return get(bitcoinConnectBalance);
}
