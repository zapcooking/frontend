/**
 * WebLN Integration
 *
 * WebLN is a browser API for interacting with Lightning wallets.
 * Common providers: Alby, Zeus, BlueWallet, etc.
 *
 * WebLN is treated as an "external" wallet like Bitcoin Connect.
 * When connected, it takes precedence over embedded wallets (NWC, Spark).
 */

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';

// Storage keys
const WEBLN_CONNECTED_KEY = 'zapcooking_webln_connected';
const WEBLN_WALLET_NAME_KEY = 'zapcooking_webln_wallet_name';

// WebLN provider instance
let weblnProvider: WebLNProvider | null = null;

// --- Stores ---

/** Whether WebLN is connected as the active external wallet */
export const weblnConnected = writable<boolean>(false);

/** Display name of the connected WebLN wallet */
export const weblnWalletName = writable<string>('');

// Track if we've loaded from storage
let hasLoadedWebln = false;

// Load from localStorage on client
if (browser) {
  setTimeout(() => {
    hasLoadedWebln = true;
    const connected = localStorage.getItem(WEBLN_CONNECTED_KEY) === 'true';
    const walletName = localStorage.getItem(WEBLN_WALLET_NAME_KEY) || '';
    weblnConnected.set(connected);
    weblnWalletName.set(walletName);
  }, 0);
}

// Persist changes
weblnConnected.subscribe((connected) => {
  if (browser && hasLoadedWebln) {
    localStorage.setItem(WEBLN_CONNECTED_KEY, String(connected));
  }
});

weblnWalletName.subscribe((name) => {
  if (browser && hasLoadedWebln) {
    localStorage.setItem(WEBLN_WALLET_NAME_KEY, name);
  }
});

// WebLN types (from webln package)
interface WebLNProvider {
  enable(): Promise<void>;
  getInfo(): Promise<{ node: { alias?: string; pubkey?: string } }>;
  sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
  makeInvoice(args: { amount?: number; defaultAmount?: number; defaultMemo?: string }): Promise<{
    paymentRequest: string;
    paymentHash: string;
  }>;
  getBalance?(): Promise<{ balance: number; currency?: string }>;
}

declare global {
  interface Window {
    webln?: WebLNProvider;
  }
}

/**
 * Check if WebLN is available in the browser
 */
export function isWeblnAvailable(): boolean {
  return browser && typeof window !== 'undefined' && !!window.webln;
}

/**
 * Connect to WebLN provider
 */
export async function connectWebln(): Promise<boolean> {
  if (!browser) return false;

  if (!window.webln) {
    throw new Error('No WebLN provider found. Please install a Lightning wallet extension.');
  }

  try {
    await window.webln.enable();
    weblnProvider = window.webln;
    return true;
  } catch (e) {
    weblnProvider = null;
    throw e;
  }
}

export function disconnectWebln(): void {
  weblnProvider = null;
}

/**
 * Check if WebLN is connected
 */
export function isWeblnConnected(): boolean {
  return weblnProvider !== null;
}

/**
 * Get WebLN wallet balance
 * Note: Not all providers support getBalance()
 */
export async function getWeblnBalance(): Promise<number | null> {
  if (!weblnProvider) throw new Error('WebLN not connected');
  try {
    if (typeof weblnProvider.getBalance === 'function') {
      const response = await weblnProvider.getBalance();
      return response.balance;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pay a Lightning invoice via WebLN
 */
export async function payWeblnInvoice(invoice: string): Promise<{ preimage: string }> {
  if (!weblnProvider) throw new Error('WebLN not connected');
  const response = await weblnProvider.sendPayment(invoice);
  return { preimage: response.preimage };
}

/**
 * Create a Lightning invoice via WebLN
 */
export async function createWeblnInvoice(
  amountSats: number,
  description?: string
): Promise<{ invoice: string; paymentHash: string }> {
  if (!weblnProvider) throw new Error('WebLN not connected');
  const response = await weblnProvider.makeInvoice({
    amount: amountSats,
    defaultMemo: description || 'zap.cooking payment'
  });
  return { invoice: response.paymentRequest, paymentHash: response.paymentHash };
}

/**
 * Get WebLN wallet info
 */
export async function getWeblnInfo(): Promise<{ alias?: string; pubkey?: string }> {
  if (!weblnProvider) throw new Error('WebLN not connected');
  const info = await weblnProvider.getInfo();
  return { alias: info.node?.alias, pubkey: info.node?.pubkey };
}

export async function getWeblnDisplayName(): Promise<string> {
  try {
    const info = await getWeblnInfo();
    return info.alias || 'WebLN Wallet';
  } catch {
    return 'WebLN Wallet';
  }
}

/**
 * Enable WebLN as the active external wallet
 * This connects to the browser's WebLN provider and stores the connection state
 */
export async function enableWebln(): Promise<{
  success: boolean;
  walletName: string;
  error?: string;
}> {
  if (!browser) {
    return { success: false, walletName: '', error: 'Not in browser' };
  }

  if (!isWeblnAvailable()) {
    return { success: false, walletName: '', error: 'No WebLN provider found' };
  }

  try {
    await connectWebln();
    const walletName = await getWeblnDisplayName();
    weblnConnected.set(true);
    weblnWalletName.set(walletName);
    return { success: true, walletName };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Failed to connect WebLN';
    return { success: false, walletName: '', error };
  }
}

/**
 * Disable WebLN and clear the connection state
 */
export function disableWebln(): void {
  disconnectWebln();
  weblnConnected.set(false);
  weblnWalletName.set('');
  if (browser) {
    localStorage.removeItem(WEBLN_CONNECTED_KEY);
    localStorage.removeItem(WEBLN_WALLET_NAME_KEY);
  }
}

/**
 * Check if WebLN is enabled as external wallet
 */
export function isWeblnEnabled(): boolean {
  return get(weblnConnected);
}

/**
 * Reconnect to WebLN if it was previously enabled
 * Called on page load to restore the connection
 */
export async function reconnectWeblnIfEnabled(): Promise<boolean> {
  if (!browser) return false;

  const wasConnected = localStorage.getItem(WEBLN_CONNECTED_KEY) === 'true';
  if (!wasConnected) return false;

  if (!isWeblnAvailable()) {
    // WebLN no longer available, clear the stored state
    disableWebln();
    return false;
  }

  try {
    await connectWebln();
    return true;
  } catch {
    // Failed to reconnect, clear the stored state
    disableWebln();
    return false;
  }
}
