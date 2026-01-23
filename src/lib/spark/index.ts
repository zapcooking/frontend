/**
 * Spark Wallet Module
 *
 * Self-custodial Lightning wallet integration using Breez SDK Spark.
 * Rewritten following jumble-spark patterns for reliable event handling.
 */

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import {
  saveMnemonic,
  loadMnemonic,
  hasMnemonic,
  deleteMnemonic,
  clearAllSparkWallets
} from './storage';
import { logger } from '$lib/logger';
import {
  hasEncryptionSupport as _hasEncryptionSupport,
  getBestEncryptionMethod as _getBestEncryptionMethod,
  encrypt,
  decrypt,
  detectEncryptionMethod,
  type EncryptionMethod
} from '$lib/encryptionService';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Dynamically import bip39 with Buffer polyfill
 * Required because bip39 uses Buffer which isn't available in browser by default
 */
async function getBip39(): Promise<{ generateMnemonic: (strength?: number) => string }> {
  // Polyfill Buffer for browser (required by bip39)
  if (browser && typeof globalThis !== 'undefined' && !(globalThis as any).Buffer) {
    const { Buffer } = await import('buffer');
    (globalThis as any).Buffer = Buffer;
  }
  const bip39 = await import('bip39');
  return bip39;
}

/**
 * Validate mnemonic format (basic validation matching primal-web-spark)
 * Checks word count and format without full BIP39 checksum validation
 */
function validateMnemonic(mnemonic: string): boolean {
  // Basic validation: check word count (should be 12, 15, 18, 21, or 24 words)
  const words = mnemonic.trim().split(/\s+/);
  const validWordCounts = [12, 15, 18, 21, 24];

  if (!validWordCounts.includes(words.length)) {
    logger.warn('[Spark] Invalid mnemonic word count:', words.length);
    return false;
  }

  // Check that all words are lowercase alphabetic
  for (const word of words) {
    if (!/^[a-z]+$/.test(word)) {
      logger.warn('[Spark] Invalid mnemonic word:', word);
      return false;
    }
  }

  return true;
}

// --- Writable Stores for Reactivity ---
export const breezSdk = writable<any | null>(null);

// Lightning address with localStorage persistence
const LIGHTNING_ADDRESS_KEY = 'spark_lightning_address';
function createPersistentLightningAddress() {
  // Load initial value from localStorage
  let initial: string | null = null;
  if (browser) {
    try {
      const stored = localStorage.getItem(LIGHTNING_ADDRESS_KEY);
      if (stored) initial = stored;
    } catch (e) {
      // Ignore localStorage errors
    }
  }

  const store = writable<string | null>(initial);

  // Subscribe to persist changes
  store.subscribe((value) => {
    if (browser) {
      try {
        if (value) {
          localStorage.setItem(LIGHTNING_ADDRESS_KEY, value);
        } else {
          localStorage.removeItem(LIGHTNING_ADDRESS_KEY);
        }
      } catch (e) {
        // Ignore localStorage errors
      }
    }
  });

  return store;
}
export const lightningAddress = createPersistentLightningAddress();

export const walletBalance = writable<bigint | null>(null);
export const walletInitialized = writable<boolean>(false);
export const sparkLoading = writable<boolean>(false);
export const sparkSyncing = writable<boolean>(false); // True while explicit sync is in progress

// Store for recently completed payments extracted from SDK events
// This provides immediate updates before listPayments() returns fresh data
export const recentSparkPayments = writable<any[]>([]);

// --- Internal State (simplified from jumble-spark) ---
let _sdkInstance: any = null;
let _wasmInitialized = false;
let _currentPubkey: string | null = null;
let _eventListenerId: string | null = null;

// --- Event Callback System ---
type SparkEventCallback = (event: any) => void;
const _eventCallbacks: SparkEventCallback[] = [];

/**
 * Register a callback for SDK events (like jumble-spark pattern)
 * @returns Unsubscribe function
 */
export function onSparkEvent(callback: SparkEventCallback): () => void {
  _eventCallbacks.push(callback);
  return () => {
    const index = _eventCallbacks.indexOf(callback);
    if (index > -1) {
      _eventCallbacks.splice(index, 1);
    }
  };
}

/**
 * Initialize the WASM module (must be called before any SDK operations)
 */
async function initWasm(): Promise<void> {
  if (_wasmInitialized) return;

  if (!browser) {
    throw new Error('Spark SDK can only be initialized in browser');
  }

  try {
    const { default: init } = await import('@breeztech/breez-sdk-spark/web');
    await init();
    _wasmInitialized = true;
    logger.info('[Spark] WASM module initialized');
  } catch (error) {
    logger.error('[Spark] Failed to initialize WASM:', error);
    throw error;
  }
}

/**
 * Set up SDK event listener (following jumble-spark pattern exactly)
 * Must be called immediately after SDK connect
 */
async function setupEventListener(): Promise<void> {
  if (!_sdkInstance) return;

  const listener = {
    onEvent: (event: any) => {
      if (event.type === 'paymentSucceeded' && event.payment) {
        recentSparkPayments.update((payments) => {
          if (!payments.find((p) => p.id === event.payment.id)) {
            return [event.payment, ...payments].slice(0, 20);
          }
          return payments;
        });
        refreshBalanceInternal();
      }

      if (event.type === 'synced') {
        sparkSyncing.set(false);
        refreshBalanceInternal();
      }

      _eventCallbacks.forEach((callback) => {
        try {
          callback(event);
        } catch {}
      });
    }
  };

  _eventListenerId = await _sdkInstance.addEventListener(listener);
}

async function refreshBalanceInternal(): Promise<void> {
  if (!_sdkInstance) return;
  try {
    const info = await _sdkInstance.getInfo({ ensureSynced: false });
    const balanceValue =
      info.balanceSats ?? info.balanceSat ?? info.balance_sats ?? info.balance ?? 0;
    walletBalance.set(BigInt(balanceValue));
  } catch {}
}

/**
 * Extract lightning address string from SDK response.
 * The SDK may return a string or an object with various property names.
 */
function extractLightningAddressString(addr: unknown): string | null {
  if (!addr) return null;

  // If it's already a string, return it
  if (typeof addr === 'string') {
    return addr;
  }

  // If it's an object, try various property names
  if (typeof addr === 'object' && addr !== null) {
    const obj = addr as Record<string, unknown>;

    // Log the object structure for debugging
    logger.debug('[Spark] Lightning address response structure:', JSON.stringify(obj, null, 2));

    // Try common property names
    const possibleKeys = [
      'lightningAddress',
      'lightning_address',
      'address',
      'lnAddress',
      'ln_address'
    ];
    for (const key of possibleKeys) {
      if (typeof obj[key] === 'string') {
        return obj[key] as string;
      }
      // Handle nested object
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        const nested = obj[key] as Record<string, unknown>;
        for (const nestedKey of possibleKeys) {
          if (typeof nested[nestedKey] === 'string') {
            return nested[nestedKey] as string;
          }
        }
      }
    }

    // If there's only one string property, use it
    const stringValues = Object.values(obj).filter((v): v is string => typeof v === 'string');
    if (stringValues.length === 1) {
      return stringValues[0];
    }

    // Look for any string that looks like a lightning address (contains @)
    for (const value of Object.values(obj)) {
      if (typeof value === 'string' && value.includes('@')) {
        return value;
      }
    }
  }

  logger.warn('[Spark] Could not extract lightning address from:', JSON.stringify(addr));
  return null;
}

/**
 * Helper to add a timeout to a promise
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${operation} timed out after ${timeoutMs / 1000}s`)),
        timeoutMs
      )
    )
  ]);
}

/**
 * Fetch lightning address from the SDK (internal helper)
 */
async function fetchLightningAddress(): Promise<void> {
  if (!_sdkInstance) return;

  try {
    const addr = await _sdkInstance.getLightningAddress();
    const address = extractLightningAddressString(addr);
    if (address) {
      lightningAddress.set(address);
      logger.info('[Spark] Lightning address:', address);
    }
  } catch (error) {
    // Lightning address might not be available for all configurations
    logger.debug('[Spark] No lightning address available:', String(error));
  }
}

/**
 * Initializes the Breez SDK and connects the wallet.
 * Simplified following jumble-spark pattern.
 * @param pubkey The user's Nostr public key (hex string).
 * @param mnemonic The BIP39 mnemonic phrase.
 * @param apiKey The Breez API key.
 * @returns True if initialization was successful, false otherwise.
 */
export async function initializeSdk(
  pubkey: string,
  mnemonic: string,
  apiKey: string
): Promise<boolean> {
  if (!browser) return false;

  // Already initialized for this pubkey
  if (_currentPubkey === pubkey && _sdkInstance) {
    logger.info('[Spark] SDK already initialized for this pubkey');
    return true;
  }

  try {
    sparkLoading.set(true);

    // Disconnect any existing connection
    await disconnectWallet();

    // Initialize WASM
    await initWasm();

    // Import SDK functions
    const { defaultConfig, connect } = await import('@breeztech/breez-sdk-spark/web');

    const config = defaultConfig('mainnet');
    config.apiKey = apiKey;
    config.privateEnabledDefault = true;

    // Use zap.cooking in production, breez.tips for local development
    // (Local dev can't proxy external SDK requests to breez.tips)
    let lnurlDomain = 'breez.tips'; // default

    // Allow override via localStorage for testing (e.g., localStorage.setItem('lnurlDomain', 'zap.cooking'))
    if (browser) {
      const override = localStorage.getItem('lnurlDomain');
      if (override && (override === 'zap.cooking' || override === 'breez.tips')) {
        lnurlDomain = override;
        logger.info(`[Spark] Using lnurlDomain override from localStorage: ${lnurlDomain}`);
      } else {
        const hostname = window.location.hostname;
        // Explicitly check for zap.cooking domain
        if (hostname === 'zap.cooking' || hostname.endsWith('.zap.cooking')) {
          lnurlDomain = 'zap.cooking';
        } else if (
          hostname !== 'localhost' &&
          !hostname.startsWith('127.') &&
          !hostname.startsWith('192.168.')
        ) {
          // For any other production domain, use zap.cooking
          lnurlDomain = 'zap.cooking';
        }
      }
    }

    config.lnurlDomain = lnurlDomain;
    logger.info(
      `[Spark] Using lnurlDomain: ${config.lnurlDomain} (hostname: ${browser ? window.location.hostname : 'server'})`
    );
    console.log(`[Spark] Config lnurlDomain set to: ${config.lnurlDomain}`);
    console.log(`[Spark] Full config object:`, JSON.stringify(config, null, 2));

    const cleanMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');

    _sdkInstance = await withTimeout(
      connect({
        config,
        seed: { type: 'mnemonic', mnemonic: cleanMnemonic },
        storageDir: 'zapcooking-spark'
      }),
      20000,
      'SDK connect'
    );

    breezSdk.set(_sdkInstance);
    _currentPubkey = pubkey;

    await setupEventListener();

    // Get cached balance immediately (without waiting for sync)
    await refreshBalanceInternal();

    // Mark as initialized - UI can show now!
    walletInitialized.set(true);
    logger.info('[Spark] SDK initialized, starting background sync...');

    // Background sync - don't await, let it run async
    // After sync completes, refresh balance and notify listeners
    sparkSyncing.set(true);

    // Timeout to clear syncing state if SDK hangs (max 20 seconds)
    const syncTimeout = setTimeout(() => {
      logger.warn('[Spark] Sync timeout - clearing syncing state');
      sparkSyncing.set(false);
    }, 20000);

    _sdkInstance
      .syncWallet({})
      .then(() => {
        logger.info('[Spark] Background sync completed');
        refreshBalanceInternal();
        // Notify listeners that sync completed (triggers transaction refresh)
        _eventCallbacks.forEach((callback) => {
          try {
            callback({ type: 'synced' });
          } catch {}
        });
      })
      .catch(() => {
        logger.warn('[Spark] Background sync failed, will retry on next action');
      })
      .finally(() => {
        clearTimeout(syncTimeout);
        sparkSyncing.set(false);
      });

    // Fetch lightning address in background - don't await
    fetchLightningAddress().catch(() => {});

    return true;
  } catch (error) {
    logger.error('[Spark] Failed to initialize SDK:', String(error));
    breezSdk.set(null);
    walletInitialized.set(false);
    _sdkInstance = null;
    _currentPubkey = null;
    return false;
  } finally {
    sparkLoading.set(false);
  }
}

/**
 * Creates a new BIP39 mnemonic, saves it securely, and connects the wallet.
 * @param pubkey The user's Nostr public key (hex string).
 * @param apiKey The Breez API key.
 * @returns The newly generated mnemonic phrase.
 * @throws Error if wallet creation or connection fails.
 */
export async function createAndConnectWallet(pubkey: string, apiKey: string): Promise<string> {
  const { generateMnemonic } = await getBip39();
  const newMnemonic = generateMnemonic(128); // 12 words, 128-bit entropy

  // Save the mnemonic first
  await saveMnemonic(pubkey, newMnemonic);

  // Try to initialize
  const connected = await initializeSdk(pubkey, newMnemonic, apiKey);
  if (!connected) {
    // Clean up if connection fails
    deleteMnemonic(pubkey);
    throw new Error('Failed to connect new wallet after creation.');
  }

  return newMnemonic;
}

/**
 * Loads a securely stored mnemonic and connects the wallet.
 * @param pubkey The user's Nostr public key (hex string).
 * @param apiKey The Breez API key.
 * @returns True if the wallet was successfully connected, false otherwise.
 */
export async function connectWallet(pubkey: string, apiKey: string): Promise<boolean> {
  const mnemonic = await loadMnemonic(pubkey);
  if (!mnemonic) {
    logger.warn('[Spark] No mnemonic found in local storage for this pubkey');
    return false;
  }

  if (!validateMnemonic(mnemonic)) {
    logger.error('[Spark] Loaded mnemonic is invalid');
    deleteMnemonic(pubkey); // Delete corrupted mnemonic
    return false;
  }

  return initializeSdk(pubkey, mnemonic, apiKey);
}

export async function disconnectWallet(): Promise<void> {
  try {
    if (_sdkInstance) {
      if (_eventListenerId) {
        try {
          await _sdkInstance.removeEventListener(_eventListenerId);
        } catch {}
        _eventListenerId = null;
      }
      try {
        await _sdkInstance.disconnect();
      } catch {}
    }
  } finally {
    breezSdk.set(null);
    lightningAddress.set(null);
    walletBalance.set(null);
    walletInitialized.set(false);
    sparkSyncing.set(false);
    _sdkInstance = null;
    _currentPubkey = null;
    _eventListenerId = null;
  }
}

/**
 * Sends a payment via the Spark wallet.
 * @param destination The BOLT11 invoice, LNURL, or Lightning address.
 * @param amountSats Optional amount in sats (for amountless invoices or LNURL).
 * @param comment Optional comment for LNURL payments.
 * @returns The payment result.
 */
export async function sendPayment(
  destination: string,
  amountSats?: number,
  comment?: string
): Promise<any> {
  if (!_sdkInstance) throw new Error('Spark SDK is not initialized');

  try {
    sparkLoading.set(true);
    const parsedInput = await _sdkInstance.parse(destination);

    if (parsedInput.type === 'lightningAddress') {
      if (!amountSats) throw new Error('Amount is required for Lightning address payments');
      const payRequest = (parsedInput as any).payRequest;
      const prepareResponse = await _sdkInstance.prepareLnurlPay({ payRequest, amountSats });
      const lnurlPayRequest: any = { prepareResponse };
      if (comment) lnurlPayRequest.comment = comment;
      const payment = await _sdkInstance.lnurlPay(lnurlPayRequest);
      await refreshBalanceInternal();
      return payment;
    }

    if (parsedInput.type === 'lnurlPay') {
      if (!amountSats) throw new Error('Amount is required for LNURL payments');
      const payRequest = (parsedInput as any).payRequest;
      const prepareResponse = await _sdkInstance.prepareLnurlPay({ payRequest, amountSats });
      const lnurlPayRequest: any = { prepareResponse };
      if (comment) lnurlPayRequest.comment = comment;
      const payment = await _sdkInstance.lnurlPay(lnurlPayRequest);
      await refreshBalanceInternal();
      return payment;
    }

    const prepareRequest: any = { paymentRequest: destination };
    if (amountSats) prepareRequest.amountSat = amountSats;
    const prepareResponse = await _sdkInstance.prepareSendPayment(prepareRequest);
    const payment = await _sdkInstance.sendPayment({ prepareResponse });
    await refreshBalanceInternal();
    return payment;
  } catch (error) {
    logger.error('[Spark] Payment failed:', String(error));
    throw error;
  } finally {
    sparkLoading.set(false);
  }
}

/**
 * Sends a zap payment (alias for sendPayment with LNURL support).
 * @param recipientInput The LNURL or Lightning Address of the recipient.
 * @param amountSats The amount in satoshis to send.
 * @param comment An optional comment for the payment.
 * @returns The payment object if successful.
 */
export async function sendZap(
  recipientInput: string,
  amountSats: number,
  comment: string
): Promise<any> {
  return sendPayment(recipientInput, amountSats, comment);
}

/**
 * Create an invoice to receive payment.
 * @param amountSats Amount in sats.
 * @param description Optional description.
 * @returns The invoice details.
 */
export async function receivePayment(
  amountSats: number,
  description?: string
): Promise<{ invoice: string; paymentHash?: string }> {
  if (!_sdkInstance) {
    throw new Error('Spark SDK is not initialized');
  }

  try {
    sparkLoading.set(true);

    const request: any = {
      paymentMethod: {
        type: 'bolt11Invoice',
        amountSats: amountSats,
        description: description || 'Payment via zap.cooking'
      }
    };

    const response = await _sdkInstance.receivePayment(request);

    logger.info('[Spark] Invoice created:', response);

    const invoice = response?.paymentRequest || response?.invoice || response?.bolt11;
    if (!invoice) {
      throw new Error('Spark SDK did not return an invoice');
    }

    return {
      invoice,
      paymentHash: response?.paymentHash
    };
  } catch (error) {
    logger.error('[Spark] Failed to create invoice:', String(error));
    throw error;
  } finally {
    sparkLoading.set(false);
  }
}

/**
 * Get payment history with cursor-based pagination.
 * Uses toTimestamp to load older payments (pagination cursor).
 * @param limit Maximum number of payments to return (default: 30)
 * @param toTimestamp Unix timestamp - fetch payments older than this (for pagination)
 */
export async function listPayments(
  limit = 30,
  toTimestamp?: number
): Promise<{ payments: any[]; hasMore: boolean }> {
  if (!_sdkInstance) {
    throw new Error('Spark SDK is not initialized');
  }

  try {
    const request: { limit: number; toTimestamp?: number; sortAscending: boolean } = {
      limit,
      sortAscending: false // Newest first
    };

    if (toTimestamp !== undefined) {
      request.toTimestamp = toTimestamp;
    }

    logger.info('[Spark] Fetching payments: limit=' + limit + ', toTimestamp=' + toTimestamp);
    const response = await withTimeout(
      _sdkInstance.listPayments(request) as Promise<any>,
      15000,
      'listPayments'
    );
    const payments = response.payments || response || [];
    logger.info('[Spark] Fetched', payments.length, 'payments');

    // hasMore is true if we got a full page (there might be more)
    const hasMore = payments.length >= limit;

    return { payments, hasMore };
  } catch (error) {
    logger.error('[Spark] Failed to list payments:', String(error));
    throw error;
  }
}

/**
 * Sync wallet state with the network.
 */
export async function syncWallet(): Promise<void> {
  if (!_sdkInstance) {
    throw new Error('Spark SDK is not initialized');
  }

  try {
    sparkLoading.set(true);
    sparkSyncing.set(true);
    await _sdkInstance.syncWallet({});
    await refreshBalanceInternal();
    logger.info('[Spark] Wallet synced');
  } catch (error) {
    logger.error('[Spark] Sync failed:', String(error));
    throw error;
  } finally {
    sparkLoading.set(false);
    sparkSyncing.set(false);
  }
}

/**
 * Checks if a Spark wallet is already configured for the current user.
 * @param pubkey The user's Nostr public key.
 * @returns True if a wallet exists in local storage, false otherwise.
 */
export function isSparkWalletConfigured(pubkey: string): boolean {
  return hasMnemonic(pubkey);
}

/**
 * Get the current SDK instance (for advanced usage).
 */
export function getSdkInstance(): any {
  return _sdkInstance;
}

export async function refreshBalance(sync = false): Promise<bigint | null> {
  if (sync && _sdkInstance) {
    try {
      await _sdkInstance.syncWallet({});
    } catch {}
  }
  await refreshBalanceInternal();
  return get(walletBalance);
}

/**
 * Get the current lightning address.
 */
export async function getLightningAddress(): Promise<string | null> {
  if (!_sdkInstance) return null;

  try {
    const addr = await _sdkInstance.getLightningAddress();
    const address = extractLightningAddressString(addr);
    if (address) {
      lightningAddress.set(address);
      return address;
    }
    return null;
  } catch (error) {
    logger.debug('[Spark] No lightning address available:', String(error));
    return null;
  }
}

/**
 * Check if a lightning address username is available.
 * @param username The username to check (without @zap.cooking suffix)
 */
export async function checkLightningAddressAvailable(username: string): Promise<boolean> {
  if (!_sdkInstance) throw new Error('SDK not connected');

  try {
    const isAvailable = await _sdkInstance.checkLightningAddressAvailable({ username });
    logger.debug('[Spark] Username availability check:', username, isAvailable);
    return isAvailable;
  } catch (error) {
    logger.error('[Spark] Failed to check username availability:', String(error));
    throw error;
  }
}

/**
 * Register a new lightning address.
 * @param username The desired username (without @zap.cooking suffix)
 * @param description Optional description for the address
 */
export async function registerLightningAddress(
  username: string,
  description?: string
): Promise<string> {
  if (!_sdkInstance) throw new Error('SDK not connected');

  try {
    // Check current domain setting (for debugging)
    const currentDomain = browser ? localStorage.getItem('lnurlDomain') || 'not set' : 'server';
    logger.info(
      `[Spark] Registering lightning address: ${username} (current domain override: ${currentDomain})`
    );

    const response = await _sdkInstance.registerLightningAddress({
      username,
      description: description || 'zap.cooking user'
    });

    // Extract address string from response using shared helper
    const address = extractLightningAddressString(response) || `${username}@zap.cooking`;

    logger.info(`[Spark] SDK returned address: ${address}`);
    logger.info(`[Spark] Full registration response:`, JSON.stringify(response, null, 2));

    lightningAddress.set(address);
    logger.info('[Spark] Lightning address registered:', address);
    return address;
  } catch (error) {
    logger.error('[Spark] Failed to register lightning address:', String(error));
    throw error;
  }
}

/**
 * Delete the current lightning address.
 */
export async function deleteLightningAddress(): Promise<void> {
  if (!_sdkInstance) throw new Error('SDK not connected');

  try {
    logger.info('[Spark] Deleting lightning address...');
    await _sdkInstance.deleteLightningAddress();
    lightningAddress.set(null);
    logger.info('[Spark] Lightning address deleted');
  } catch (error) {
    logger.error('[Spark] Failed to delete lightning address:', String(error));
    throw error;
  }
}

/**
 * Restore wallet from a mnemonic phrase.
 * @param pubkey The user's Nostr public key (hex string).
 * @param mnemonic The BIP39 mnemonic phrase.
 * @param apiKey The Breez API key.
 * @returns True if restoration was successful.
 */
export async function restoreFromMnemonic(
  pubkey: string,
  rawMnemonic: string,
  apiKey: string
): Promise<boolean> {
  if (!browser) return false;

  try {
    sparkLoading.set(true);

    // Clean up the mnemonic - trim whitespace and normalize spaces
    const mnemonic = rawMnemonic.trim().replace(/\s+/g, ' ');
    logger.debug('[Spark] Restore mnemonic word count:', String(mnemonic.split(' ').length));

    // Validate mnemonic format
    if (!validateMnemonic(mnemonic)) {
      logger.error('[Spark] Mnemonic validation failed. First word:', mnemonic.split(' ')[0]);
      throw new Error('Invalid mnemonic phrase');
    }

    // Save the mnemonic
    await saveMnemonic(pubkey, mnemonic);

    // Initialize SDK with the mnemonic
    const success = await initializeSdk(pubkey, mnemonic, apiKey);
    if (!success) {
      deleteMnemonic(pubkey);
      throw new Error('Failed to initialize SDK with mnemonic');
    }

    // Explicitly fetch the lightning address for this wallet
    try {
      const addr = await getLightningAddress();
      logger.info('[Spark] Wallet lightning address:', addr || 'none');
    } catch (e) {
      logger.warn('[Spark] Could not fetch lightning address after restore:', String(e));
    }

    logger.info('[Spark] Wallet restored from mnemonic');
    return true;
  } catch (error) {
    logger.error('[Spark] Failed to restore from mnemonic:', String(error));
    throw error;
  } finally {
    sparkLoading.set(false);
  }
}

/**
 * Spark wallet backup file format (compatible with Primal/Jumble/Yakihonne)
 * Version 1: NIP-04 encryption, no explicit encryption field
 * Version 2: NIP-44 or NIP-04 with explicit encryption field
 */
export interface SparkWalletBackup {
  version: number;
  type: string;
  encryption?: 'nip44' | 'nip04'; // Optional for v1 backups
  pubkey: string;
  encryptedMnemonic: string;
  walletId?: string;
  createdAt: number;
  createdBy?: string;
}

/**
 * Restore wallet from a backup file.
 * @param pubkey The user's Nostr public key (hex string).
 * @param backup The backup file contents.
 * @param apiKey The Breez API key.
 * @param decryptFn Function to decrypt the mnemonic using NIP-44.
 * @returns True if restoration was successful.
 */
export async function restoreFromBackup(
  pubkey: string,
  backup: SparkWalletBackup,
  apiKey: string,
  decryptFn: (ciphertext: string, senderPubkey: string) => Promise<string>
): Promise<boolean> {
  if (!browser) return false;

  try {
    sparkLoading.set(true);

    // Validate backup format
    if (backup.type !== 'spark-wallet-backup') {
      throw new Error('Invalid backup file format');
    }

    // Support both version 1 (NIP-04) and version 2 (NIP-44 or NIP-04)
    if (backup.version !== 1 && backup.version !== 2) {
      throw new Error(`Unsupported backup version: ${backup.version}`);
    }

    // Check if the backup belongs to the current user
    if (backup.pubkey && backup.pubkey !== pubkey) {
      throw new Error(
        'This backup belongs to a different Nostr account. ' +
          'Please log in with the correct account or use a backup file created with your current account.'
      );
    }

    // Decrypt the mnemonic
    const rawMnemonic = await decryptFn(backup.encryptedMnemonic, backup.pubkey);
    if (!rawMnemonic) {
      throw new Error('Failed to decrypt mnemonic from backup');
    }

    // Clean up the mnemonic - trim whitespace and normalize spaces
    const mnemonic = rawMnemonic.trim().replace(/\s+/g, ' ');
    logger.debug('[Spark] Decrypted mnemonic word count:', String(mnemonic.split(' ').length));

    // Validate mnemonic format
    if (!validateMnemonic(mnemonic)) {
      logger.error('[Spark] Mnemonic validation failed. First word:', mnemonic.split(' ')[0]);
      throw new Error('Decrypted mnemonic is invalid');
    }

    // Save the mnemonic
    await saveMnemonic(pubkey, mnemonic);

    // Initialize SDK with the mnemonic
    const success = await initializeSdk(pubkey, mnemonic, apiKey);
    if (!success) {
      deleteMnemonic(pubkey);
      throw new Error('Failed to initialize SDK with mnemonic');
    }

    // Explicitly fetch the lightning address for this wallet
    try {
      const addr = await getLightningAddress();
      logger.info('[Spark] Wallet lightning address:', addr || 'none');
    } catch (e) {
      logger.warn('[Spark] Could not fetch lightning address after restore:', String(e));
    }

    logger.info('[Spark] Wallet restored from backup');
    return true;
  } catch (error) {
    logger.error('[Spark] Failed to restore from backup:', String(error));
    throw error;
  } finally {
    sparkLoading.set(false);
  }
}

/**
 * Create a backup of the wallet (for download).
 * @param pubkey The user's Nostr public key (hex string).
 * @param encryptFn Function to encrypt the mnemonic.
 * @param encryption The encryption method used ('nip44' or 'nip04').
 * @returns The backup object.
 */
export async function createBackup(
  pubkey: string,
  encryptFn: (plaintext: string, recipientPubkey: string) => Promise<string>,
  encryption: 'nip44' | 'nip04' = 'nip44'
): Promise<SparkWalletBackup> {
  const mnemonic = await loadMnemonic(pubkey);
  if (!mnemonic) {
    throw new Error('No wallet found to backup');
  }

  const walletId = getSparkWalletId(mnemonic);
  const encryptedMnemonic = await encryptFn(mnemonic, pubkey);

  return {
    version: 2,
    type: 'spark-wallet-backup',
    encryption,
    pubkey,
    encryptedMnemonic,
    walletId,
    createdAt: Date.now(),
    createdBy: 'zap.cooking'
  };
}

// Nostr backup constants
const BACKUP_EVENT_KIND = 30078; // NIP-78 application-specific data
const BACKUP_D_TAG = 'spark-wallet-backup';
const BACKUP_D_TAG_PREFIX = `${BACKUP_D_TAG}:`;

export interface SparkBackupEntry {
  id: string;
  dTag: string;
  content: string;
  createdAt: number;
  encryptionMethod: EncryptionMethod;
  isLegacy: boolean;
  walletId?: string;
}

function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getSparkWalletId(mnemonic: string): string {
  const normalized = normalizeMnemonic(mnemonic);
  const hash = sha256(new TextEncoder().encode(normalized));
  return bytesToHex(hash).slice(0, 16);
}

function getBackupTag(walletId: string | null): string {
  return walletId ? `${BACKUP_D_TAG_PREFIX}${walletId}` : BACKUP_D_TAG;
}

function parseBackupTag(dTag: string): { isLegacy: boolean; walletId?: string } | null {
  if (dTag === BACKUP_D_TAG) {
    return { isLegacy: true };
  }

  if (dTag.startsWith(BACKUP_D_TAG_PREFIX)) {
    return { isLegacy: false, walletId: dTag.slice(BACKUP_D_TAG_PREFIX.length) };
  }

  return null;
}

function isDeletedBackupEvent(event: any): boolean {
  return !!event?.tags?.some((tag: string[]) => tag[0] === 'deleted' && tag[1] === 'true');
}

// Re-export encryption functions for backwards compatibility
export const hasEncryptionSupport = _hasEncryptionSupport;
export const getBestEncryptionMethod = _getBestEncryptionMethod;

/**
 * @deprecated Use hasEncryptionSupport() from encryptionService instead
 */
export function hasNip44Support(): boolean {
  return _getBestEncryptionMethod() === 'nip44';
}

/**
 * @deprecated Use hasEncryptionSupport() from encryptionService instead
 */
export function hasNip04Support(): boolean {
  const method = _getBestEncryptionMethod();
  return method === 'nip04' || method === 'nip44';
}

/**
 * Backup wallet mnemonic to Nostr relays.
 * Uses NIP-78 (kind 30078) replaceable events with NIP-44 encryption (falls back to NIP-04).
 * @param pubkey The user's Nostr public key.
 */
export async function backupWalletToNostr(pubkey: string): Promise<any> {
  if (!browser) throw new Error('Backup can only be performed in browser');

  const mnemonic = await loadMnemonic(pubkey);
  if (!mnemonic) {
    throw new Error('No wallet found to backup');
  }

  // Check encryption support
  if (!hasEncryptionSupport()) {
    throw new Error(
      'No encryption method available. Encryption is supported when logged in with a private key (nsec), NIP-07 extension, or NIP-46 remote signer with encryption permissions.'
    );
  }

  // Create the backup event (kind 30078 - NIP-78 application-specific data)
  const { ndk, ndkReady } = await import('$lib/nostr');
  const { NDKEvent } = await import('@nostr-dev-kit/ndk');
  const { get } = await import('svelte/store');
  const { createAuthManager } = await import('$lib/authManager');

  await ndkReady;
  const ndkInstance = get(ndk);

  // For NIP-46 signers, ensure the signer is ready before attempting encryption
  if (ndkInstance.signer?.constructor?.name === 'NDKNip46Signer') {
    logger.info('[Spark] Ensuring NIP-46 signer is ready...');
    const authManager = createAuthManager(ndkInstance);
    const isReady = await authManager.ensureNip46SignerReady();
    if (!isReady) {
      throw new Error(
        'NIP-46 signer is not ready. Please ensure your remote signer app is open and connected.'
      );
    }
    logger.info('[Spark] NIP-46 signer is ready');
  }

  // Encrypt using the unified encryption service
  logger.info('[Spark] Encrypting mnemonic...');
  const { ciphertext: encryptedMnemonic, method: encryptionMethod } = await encrypt(
    pubkey,
    mnemonic
  );
  logger.info('[Spark] Encrypted with', encryptionMethod);

  const walletId = getSparkWalletId(mnemonic);

  // Create and sign using NDK (works with any signer type)
  const ndkEvent = new NDKEvent(ndkInstance);
  ndkEvent.kind = BACKUP_EVENT_KIND;
  ndkEvent.content = encryptedMnemonic;
  ndkEvent.tags = [
    ['d', getBackupTag(walletId)],
    ['client', 'zap.cooking'],
    ['encryption', encryptionMethod || 'nip44']
  ];

  logger.info('[Spark] Signing backup event...');
  await ndkEvent.sign();

  logger.info('[Spark] Publishing backup to Nostr relays...');
  await ndkEvent.publish();

  logger.info('[Spark] Wallet backed up to Nostr successfully');
  return ndkEvent.rawEvent();
}

export async function listSparkBackups(pubkey: string): Promise<SparkBackupEntry[]> {
  if (!browser) return [];

  try {
    const { ndk, ndkReady } = await import('$lib/nostr');
    const { get } = await import('svelte/store');

    await ndkReady;
    const ndkInstance = get(ndk);

    const events = await ndkInstance.fetchEvents(
      {
        kinds: [BACKUP_EVENT_KIND],
        authors: [pubkey]
      },
      { closeOnEose: true }
    );

    if (!events || events.size === 0) {
      return [];
    }

    const latestByTag = new Map<string, SparkBackupEntry>();

    for (const event of events) {
      const dTag = event.tags?.find((tag: string[]) => tag[0] === 'd')?.[1];
      if (!dTag) continue;

      const parsed = parseBackupTag(dTag);
      if (!parsed) continue;

      if (!event.content || isDeletedBackupEvent(event)) continue;

      const createdAt = event.created_at || 0;
      const encryptionTag = event.tags?.find((tag: string[]) => tag[0] === 'encryption');
      let encryptionMethod: EncryptionMethod;
      if (encryptionTag?.[1] === 'nip04' || encryptionTag?.[1] === 'nip44') {
        encryptionMethod = encryptionTag[1] as EncryptionMethod;
      } else {
        encryptionMethod = detectEncryptionMethod(event.content);
      }

      const entry: SparkBackupEntry = {
        id: event.id || `${dTag}:${createdAt}`,
        dTag,
        content: event.content,
        createdAt,
        encryptionMethod,
        isLegacy: parsed.isLegacy,
        walletId: parsed.walletId
      };

      const existing = latestByTag.get(dTag);
      if (!existing || createdAt > existing.createdAt) {
        latestByTag.set(dTag, entry);
      }
    }

    return Array.from(latestByTag.values()).sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    logger.warn('[Spark] Failed to list backups from Nostr:', String(error));
    return [];
  }
}

export async function restoreSparkBackup(
  pubkey: string,
  apiKey: string,
  backup: SparkBackupEntry
): Promise<string | null> {
  if (!browser) return null;

  // Check that we have decryption support
  if (!hasEncryptionSupport()) {
    throw new Error(
      'No decryption method available. Please ensure you are logged in with a signer.'
    );
  }

  if (!backup.content) {
    return null;
  }

  logger.info('[Spark] Restoring wallet from backup:', backup.dTag);

  // Helper to add timeout to decrypt operations
  const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
    ]);
  };

  const encryptionMethod = backup.encryptionMethod || detectEncryptionMethod(backup.content);
  const DECRYPT_TIMEOUT = 15000;

  const mnemonic = await withTimeout(
    decrypt(pubkey, backup.content, encryptionMethod),
    DECRYPT_TIMEOUT,
    'Decryption timed out. Please approve the request in your signer app.'
  );

  if (!mnemonic) {
    throw new Error('Failed to decrypt backup. Make sure you are using the same Nostr key.');
  }

  const normalizedMnemonic = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalizedMnemonic)) {
    throw new Error('Decrypted backup contains invalid mnemonic');
  }

  await saveMnemonic(pubkey, normalizedMnemonic);

  logger.info('[Spark] Initializing wallet from Nostr backup...');
  const success = await initializeSdk(pubkey, normalizedMnemonic, apiKey);

  if (!success) {
    deleteMnemonic(pubkey);
    throw new Error('Failed to initialize wallet from backup');
  }

  try {
    const addr = await getLightningAddress();
    logger.info('[Spark] Wallet lightning address:', addr || 'none');
  } catch (e) {
    logger.warn('[Spark] Could not fetch lightning address after restore:', String(e));
  }

  logger.info('[Spark] Wallet restored from Nostr backup successfully');
  return normalizedMnemonic;
}

/**
 * Restore wallet from Nostr backup.
 * Fetches NIP-78 event and decrypts with NIP-44 or NIP-04 (based on encryption tag).
 * @param pubkey The user's Nostr public key.
 * @param apiKey The Breez API key.
 * @returns The decrypted mnemonic if found, null otherwise.
 */
export async function restoreWalletFromNostr(
  pubkey: string,
  apiKey: string
): Promise<string | null> {
  if (!browser) return null;

  logger.info('[Spark] Searching for Nostr backups...');
  const backups = await listSparkBackups(pubkey);

  if (!backups.length) {
    logger.info('[Spark] No backup found on Nostr relays');
    return null;
  }

  return restoreSparkBackup(pubkey, apiKey, backups[0]);
}

export async function hasSparkBackupInNostr(pubkey: string): Promise<boolean> {
  if (!browser) return false;

  try {
    const backups = await listSparkBackups(pubkey);
    return backups.length > 0;
  } catch (error) {
    logger.warn('[Spark] Failed to check backup status:', String(error));
    return false;
  }
}

/**
 * Relay backup status result
 */
export interface RelayBackupStatus {
  relay: string;
  hasBackup: boolean;
  timestamp?: number;
  error?: string;
}

/**
 * Check which relays have a backup of the wallet.
 * Queries each relay individually to determine backup status.
 * @param pubkey The user's Nostr public key.
 * @returns Array of relay backup statuses.
 */
export async function checkRelayBackups(pubkey: string): Promise<RelayBackupStatus[]> {
  if (!browser) return [];

  const { ndk, ndkReady, relays } = await import('$lib/nostr');
  const { standardRelays } = await import('$lib/consts');
  const { get } = await import('svelte/store');
  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');

  await ndkReady;
  const ndkInstance = get(ndk);

  // Use the user's explicitly configured relays (from localStorage or defaults)
  // This avoids showing random outbox/gossip relays
  const relaysToCheck: string[] = Array.isArray(relays)
    ? relays.filter((r: unknown): r is string => typeof r === 'string')
    : standardRelays;

  if (relaysToCheck.length === 0) {
    logger.warn('[Spark] No relays configured');
    return [];
  }

  logger.info(`[Spark] Checking backup status on ${relaysToCheck.length} relays...`);

  const results: RelayBackupStatus[] = [];

  // Query each relay individually in parallel
  const checkPromises = relaysToCheck.map(async (relayUrl): Promise<RelayBackupStatus> => {
    try {
      // Create a filter for Spark backup events (legacy + multi-backup tags)
      const filter = {
        kinds: [BACKUP_EVENT_KIND],
        authors: [pubkey]
      };

      // Create a relay set for this specific relay
      const relaySet = NDKRelaySet.fromRelayUrls([relayUrl], ndkInstance, true);

      // Fetch from this specific relay with timeout
      const events = await Promise.race([
        ndkInstance.fetchEvents(filter, { closeOnEose: true }, relaySet),
        new Promise<Set<any>>((resolve) => setTimeout(() => resolve(new Set()), 8000))
      ]);

      if (events && events.size > 0) {
        let latestEvent: any = null;
        for (const event of events) {
          const dTag = event.tags?.find((tag: string[]) => tag[0] === 'd')?.[1];
          if (!dTag || !parseBackupTag(dTag) || isDeletedBackupEvent(event) || !event.content) {
            continue;
          }
          if (!latestEvent || event.created_at! > latestEvent.created_at!) {
            latestEvent = event;
          }
        }

        if (latestEvent) {
          return {
            relay: relayUrl,
            hasBackup: true,
            timestamp: latestEvent?.created_at ? latestEvent.created_at * 1000 : undefined
          };
        }
      }

      return {
        relay: relayUrl,
        hasBackup: false
      };
    } catch (error) {
      logger.warn(`[Spark] Failed to check backup on ${relayUrl}: ${String(error)}`);
      return {
        relay: relayUrl,
        hasBackup: false,
        error: 'Connection failed'
      };
    }
  });

  const resultsArray = await Promise.all(checkPromises);
  results.push(...resultsArray);

  const backupCount = results.filter((r) => r.hasBackup).length;
  logger.info(`[Spark] Backup check complete: ${backupCount}/${results.length} relays have backup`);

  return results;
}

/**
 * Delete Spark wallet backup from Nostr relays.
 * Publishes an empty replaceable event to overwrite the backup (more reliable than NIP-09).
 * @param pubkey The user's Nostr public key (hex string).
 */
export async function deleteBackupFromNostr(pubkey: string, walletId?: string): Promise<void> {
  if (!browser) throw new Error('Backup deletion can only be performed in browser');

  const { ndk, ndkReady } = await import('$lib/nostr');
  const { NDKEvent } = await import('@nostr-dev-kit/ndk');
  const { get } = await import('svelte/store');

  await ndkReady;
  const ndkInstance = get(ndk);

  const mnemonic = walletId ? null : await loadMnemonic(pubkey);
  const resolvedWalletId = walletId || (mnemonic ? getSparkWalletId(mnemonic) : null);
  const backupTag = getBackupTag(resolvedWalletId);

  logger.info('[Spark] Deleting backup by publishing empty replacement...');

  // Create an empty replaceable event with the same d-tag to overwrite the backup
  // This is more reliable than NIP-09 deletion since relays must replace the old event
  const ndkEvent = new NDKEvent(ndkInstance);
  ndkEvent.kind = BACKUP_EVENT_KIND;
  ndkEvent.content = ''; // Empty content - no backup data
  ndkEvent.tags = [
    ['d', backupTag],
    ['deleted', 'true']
  ];

  // Sign using NDK (works with any signer type)
  logger.info('[Spark] Signing empty backup event...');
  await ndkEvent.sign();

  logger.info('[Spark] Publishing empty backup to overwrite existing...');
  await ndkEvent.publish();

  logger.info('[Spark] Backup deleted (replaced with empty event)');
}

/**
 * Check if a lud16 address matches the Spark wallet's lightning address.
 * Useful for determining if the user's profile lud16 is their Spark wallet.
 * @param lud16 The lightning address to check (e.g., from user's Nostr profile)
 * @returns True if the lud16 matches the Spark wallet's address
 */
export function isSparkLightningAddress(lud16: string | null | undefined): boolean {
  if (!lud16) return false;

  const sparkAddr = get(lightningAddress);
  if (!sparkAddr) return false;

  // Normalize both addresses for comparison (lowercase, trim)
  const normalizedLud16 = lud16.toLowerCase().trim();
  const normalizedSparkAddr = sparkAddr.toLowerCase().trim();

  return normalizedLud16 === normalizedSparkAddr;
}

/**
 * Get the current Spark lightning address value (non-reactive).
 */
export function getSparkLightningAddress(): string | null {
  return get(lightningAddress);
}

// Export storage utilities
export { clearAllSparkWallets, deleteMnemonic, loadMnemonic };
