/**
 * Wallet Manager
 *
 * Unified interface for managing multiple wallet types.
 * Routes operations to the appropriate wallet implementation.
 */

import { get, writable } from 'svelte/store';
import { ndkReady } from '$lib/nostr';
import {
  type Wallet,
  type WalletKind,
  wallets,
  activeWallet,
  walletBalance,
  walletLoading,
  walletLastSync,
  addWallet,
  removeWallet,
  setActiveWallet,
  getActiveWallet
} from './walletStore';
import {
  connectNwc,
  disconnectNwc,
  getNwcBalance,
  payNwcInvoice,
  payNwcLightningAddress,
  isLightningAddress,
  createNwcInvoice,
  lookupNwcInvoice,
  isNwcConnected,
  isNwcConnectedTo,
  getNwcDisplayName,
  getNwcInfo,
  listNwcTransactions,
  type NwcTransaction
} from './nwc';
import {
  connectWebln,
  disconnectWebln,
  getWeblnBalance,
  payWeblnInvoice,
  isWeblnAvailable,
  isWeblnConnected,
  getWeblnDisplayName
} from './webln';

// Import Spark functions
import {
  walletBalance as sparkBalance,
  walletInitialized as sparkInitialized,
  lightningAddress as sparkLightningAddress,
  connectWallet as connectSparkWallet,
  disconnectWallet as disconnectSparkWallet,
  listPayments as listSparkPayments,
  refreshBalance as refreshSparkBalance,
  receivePayment as receiveSparkPayment,
  recentSparkPayments
} from '$lib/spark';
import { userPublickey } from '$lib/nostr';

/**
 * Connect a new wallet
 */
export async function connectWallet(
  kind: WalletKind,
  data?: string
): Promise<{ success: boolean; wallet?: Wallet; error?: string }> {
  try {
    walletLoading.set(true);

    let name: string;

    switch (kind) {
      case 1: // WebLN
        if (!isWeblnAvailable()) {
          throw new Error('No WebLN provider found');
        }
        await connectWebln();
        name = await getWeblnDisplayName();
        break;

      case 3: // NWC
        if (!data) {
          throw new Error('NWC connection URL required');
        }
        await connectNwc(data);
        // Try to get wallet alias, fall back to pubkey-based name
        try {
          const info = await getNwcInfo();
          name = info.alias || getNwcDisplayName(data);
        } catch {
          name = getNwcDisplayName(data);
        }
        break;

      case 4: // Spark
        // Spark connection is handled separately via the Spark module
        // This just registers it in the wallet list
        name = 'Breez Spark';
        break;

      default:
        throw new Error(`Unknown wallet kind: ${kind}`);
    }

    // Add to wallet store
    const wallet = addWallet(kind, name, data || kind.toString());

    // Make it active
    setActiveWallet(wallet.id);

    await refreshBalance();
    return { success: true, wallet };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Connection failed';
    console.error('[WalletManager] Connection failed:', error);
    return { success: false, error };
  } finally {
    walletLoading.set(false);
  }
}

/**
 * Disconnect a wallet
 */
export async function disconnectWallet(walletId?: number): Promise<void> {
  const wallet = walletId ? get(wallets).find((w) => w.id === walletId) : getActiveWallet();

  if (!wallet) {
    console.warn('[WalletManager] No wallet to disconnect');
    return;
  }

  try {
    switch (wallet.kind) {
      case 1: // WebLN
        disconnectWebln();
        break;

      case 3: // NWC
        await disconnectNwc();
        break;

      case 4: // Spark
        await disconnectSparkWallet();
        break;
    }

    removeWallet(wallet.id);
  } catch (e) {
    console.error('[WalletManager] Disconnect error:', e);
    // Still remove from store even if disconnect fails
    removeWallet(wallet.id);
  }
}

/**
 * Ensure the active wallet is connected (reconnect if needed)
 */
async function ensureWalletConnected(wallet: Wallet): Promise<boolean> {
  try {
    switch (wallet.kind) {
      case 1: // WebLN
        if (!isWeblnConnected()) {
          if (isWeblnAvailable()) {
            await connectWebln();
            return true;
          }
          return false;
        }
        return true;

      case 3: // NWC
        // Check if already connected to the correct wallet to avoid reconnection attempts
        if (wallet.data) {
          if (isNwcConnectedTo(wallet.data)) {
            return true;
          }
          await connectNwc(wallet.data);
          return true;
        }
        return false;

      case 4: // Spark
        if (!get(sparkInitialized)) {
          const apiKey = import.meta.env.VITE_BREEZ_API_KEY;
          const pubkey = get(userPublickey);
          if (apiKey && pubkey) {
            try {
              const connected = await connectSparkWallet(pubkey, apiKey);
              return connected;
            } catch (sparkError) {
              // WASM errors can occur if SDK is in bad state
              console.warn('[WalletManager] Spark reconnect failed (WASM error?):', sparkError);
              return false;
            }
          }
          return false;
        }
        return true;

      default:
        return false;
    }
  } catch (e) {
    console.warn('[WalletManager] Failed to reconnect wallet:', e);
    return false;
  }
}

/**
 * Get balance from the active wallet
 * @param sync For Spark: if true, sync with network first (slower but gets fresh data). Default false.
 */
export async function refreshBalance(sync = false): Promise<number | null> {
  const wallet = getActiveWallet();

  if (!wallet) {
    walletBalance.set(null);
    return null;
  }

  try {
    walletLoading.set(true);

    // Ensure the wallet is connected before trying to get balance
    const connected = await ensureWalletConnected(wallet);
    if (!connected) {
      // Silently return - wallet not connected is expected during initialization
      walletBalance.set(null);
      return null;
    }

    let balance: number | null = null;

    switch (wallet.kind) {
      case 1: // WebLN
        try {
          balance = await getWeblnBalance();
        } catch (e) {
          console.warn('[WalletManager] WebLN balance fetch failed:', e);
          balance = null;
        }
        break;

      case 3: // NWC
        try {
          balance = await getNwcBalance();
        } catch (e) {
          console.warn('[WalletManager] NWC balance fetch failed (will retry on next refresh):', e);
          // Don't throw - the wallet is still connected, just couldn't fetch balance
          balance = null;
        }
        break;

      case 4: // Spark
        // Trigger a refresh and get balance from Spark store
        // Pass sync flag - only sync when needed (payment detection)
        try {
          const sparkBal = await refreshSparkBalance(sync);
          balance = sparkBal !== null ? Number(sparkBal) : null;
        } catch (e) {
          console.warn('[WalletManager] Spark balance refresh failed:', e);
          // Fall back to current store value
          const currentBal = get(sparkBalance);
          balance = currentBal !== null ? Number(currentBal) : null;
        }
        break;
    }

    walletBalance.set(balance);
    if (balance !== null) {
      walletLastSync.set(Date.now());
    }
    return balance;
  } catch (e) {
    console.error('[WalletManager] Failed to refresh balance:', e);
    walletBalance.set(null);
    return null;
  } finally {
    walletLoading.set(false);
  }
}

/**
 * Send a payment via the active wallet
 * @param invoice The bolt11 invoice to pay
 * @param metadata Optional metadata for pending transaction display
 */
export async function sendPayment(
  invoice: string,
  metadata?: { amount?: number; description?: string; comment?: string; pubkey?: string }
): Promise<{ success: boolean; preimage?: string; error?: string }> {
  const wallet = getActiveWallet();

  if (!wallet) {
    return { success: false, error: 'No wallet connected' };
  }

  // Generate a temporary ID for the pending transaction
  const pendingId = `pending-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Add pending transaction if we have metadata
  if (metadata?.amount) {
    addPendingTransaction({
      id: pendingId,
      type: 'outgoing',
      amount: metadata.amount,
      description: metadata.description || 'Sending payment...',
      timestamp: Math.floor(Date.now() / 1000),
      pubkey: metadata.pubkey,
      walletId: wallet.id
    });
  }

  try {
    walletLoading.set(true);

    // Ensure the wallet is connected before trying to pay
    const connected = await ensureWalletConnected(wallet);
    if (!connected) {
      throw new Error('Wallet not connected. Please try again.');
    }

    let preimage: string;

    switch (wallet.kind) {
      case 1: // WebLN
        const weblnResult = await payWeblnInvoice(invoice);
        preimage = weblnResult.preimage;
        break;

      case 3: // NWC
        // Check if it's a Lightning address
        if (isLightningAddress(invoice)) {
          if (!metadata?.amount) {
            throw new Error('Amount is required for Lightning address payments');
          }
          const lnAddrResult = await payNwcLightningAddress(
            invoice,
            metadata.amount,
            metadata?.comment
          );
          preimage = lnAddrResult.preimage;
        } else {
          const nwcResult = await payNwcInvoice(invoice);
          preimage = nwcResult.preimage;
        }
        break;

      case 4: // Spark
        // Import dynamically to avoid circular dependency
        const { sendZap } = await import('$lib/spark');
        // For Lightning addresses, amount and comment are passed via metadata
        // For invoices, amount is encoded in the invoice itself
        const payment = await sendZap(invoice, metadata?.amount || 0, metadata?.comment || '');
        preimage = payment?.id || payment?.paymentHash || '';
        break;

      default:
        throw new Error(`Unknown wallet kind: ${wallet.kind}`);
    }

    // Mark pending transaction as completed (don't remove - let history dedup it)
    // This keeps it visible until the real transaction appears in history
    if (metadata?.amount) {
      updatePendingTransactionStatus(pendingId, 'completed');
    }

    // Refresh balance after payment
    await refreshBalance();

    signalTransactionsRefresh();
    return { success: true, preimage };
  } catch (e) {
    // Remove pending transaction on failure
    if (metadata?.amount) {
      removePendingTransaction(pendingId);
    }

    const error = e instanceof Error ? e.message : String(e) || 'Payment failed';
    console.error('[WalletManager] Payment failed:', e);
    return { success: false, error };
  } finally {
    walletLoading.set(false);
  }
}

/**
 * Check if any wallet is ready to use
 */
export function isWalletReady(): boolean {
  const wallet = getActiveWallet();
  if (!wallet) return false;

  switch (wallet.kind) {
    case 1:
      return isWeblnConnected();
    case 3:
      return isNwcConnected();
    case 4:
      return get(sparkInitialized);
    default:
      return false;
  }
}

/**
 * Get Lightning address for receiving (if available)
 */
export async function getLightningAddress(): Promise<string | null> {
  const wallet = getActiveWallet();
  if (!wallet) return null;

  switch (wallet.kind) {
    case 4: // Spark has registered Lightning address
      return get(sparkLightningAddress);
    default:
      // NWC and WebLN don't typically provide Lightning addresses
      return null;
  }
}

/**
 * Create a Lightning invoice for receiving payments
 * @param amountSats Amount in satoshis
 * @param description Optional description for the invoice
 * @returns Invoice string and optional payment hash
 */
export async function createInvoice(
  amountSats: number,
  description?: string
): Promise<{ invoice: string; paymentHash?: string }> {
  const wallet = getActiveWallet();

  if (!wallet) {
    throw new Error('No wallet connected');
  }

  if (amountSats <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  try {
    walletLoading.set(true);

    // Ensure the wallet is connected before trying to create invoice
    const connected = await ensureWalletConnected(wallet);
    if (!connected) {
      throw new Error('Wallet not connected. Please try again.');
    }

    switch (wallet.kind) {
      case 3: // NWC
        const nwcResult = await createNwcInvoice(amountSats, description);
        return {
          invoice: nwcResult.invoice,
          paymentHash: nwcResult.paymentHash
        };

      case 4: // Spark
        // Ensure Spark is initialized before trying to create invoice
        if (!get(sparkInitialized)) {
          throw new Error('Spark wallet is not initialized. Please wait for it to connect.');
        }
        try {
          const sparkResult = await receiveSparkPayment(amountSats, description);
          return {
            invoice: sparkResult.invoice,
            paymentHash: sparkResult.paymentHash
          };
        } catch (sparkError) {
          console.error('[WalletManager] Spark receivePayment error:', sparkError);
          throw new Error(
            sparkError instanceof Error ? sparkError.message : 'Failed to create Spark invoice'
          );
        }

      default:
        throw new Error('This wallet type does not support invoice generation');
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Failed to create invoice';
    console.error('[WalletManager] Failed to create invoice:', e);
    throw new Error(error);
  } finally {
    walletLoading.set(false);
  }
}

/**
 * Lookup invoice status by payment hash
 * @param paymentHash The payment hash of the invoice to lookup
 * @returns Whether the invoice was paid
 */
export async function lookupInvoice(
  paymentHash: string
): Promise<{ paid: boolean; preimage?: string }> {
  const wallet = getActiveWallet();

  if (!wallet) {
    throw new Error('No wallet connected');
  }

  try {
    // Ensure the wallet is connected before trying to lookup
    const connected = await ensureWalletConnected(wallet);
    if (!connected) {
      return { paid: false };
    }

    switch (wallet.kind) {
      case 3: // NWC
        return await lookupNwcInvoice(paymentHash);

      case 4: // Spark
        // Spark doesn't have a direct lookup - we rely on events
        // For now, return not paid and let events handle it
        return { paid: false };

      default:
        throw new Error('This wallet type does not support invoice lookup');
    }
  } catch (e) {
    console.error('[WalletManager] Failed to lookup invoice:', e);
    // Don't throw - just return not paid
    return { paid: false };
  }
}

/**
 * Unified transaction type
 */
export interface Transaction {
  id: string;
  txid?: string; // On-chain transaction id when available
  type: 'incoming' | 'outgoing';
  amount: number; // in sats
  description?: string;
  comment?: string; // Zap comment from kind 9734 content field
  timestamp: number; // unix timestamp
  fees?: number; // in sats
  status?: 'pending' | 'completed' | 'failed';
  pubkey?: string; // Nostr pubkey for zap sender/recipient
  walletId?: number; // ID of wallet this transaction belongs to
}

/**
 * Store for pending transactions (shown while payment is in progress)
 * Uses localStorage to sync across browser tabs and page navigations
 */
const PENDING_TX_KEY = 'zapcooking_pending_transactions';

function loadPendingFromStorage(): Transaction[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
  try {
    const stored = localStorage.getItem(PENDING_TX_KEY);
    if (stored) {
      const txs = JSON.parse(stored) as Transaction[];
      const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
      return txs.filter((tx) => tx.timestamp > fiveMinutesAgo);
    }
  } catch (e) {
    console.error('[WalletManager] Failed to load pending transactions:', e);
  }
  return [];
}

function savePendingToStorage(txs: Transaction[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PENDING_TX_KEY, JSON.stringify(txs));
  } catch (e) {
    console.error('[WalletManager] Failed to save pending transactions:', e);
  }
}

// Initialize empty, will load from storage on client
export const pendingTransactions = writable<Transaction[]>([]);

// Track if we've initialized from storage
let pendingTxInitialized = false;

// Initialize from localStorage on client side
function initPendingTransactions(): void {
  if (pendingTxInitialized) return;
  if (typeof window === 'undefined') return;

  pendingTxInitialized = true;
  const stored = loadPendingFromStorage();
  if (stored.length > 0) {
    pendingTransactions.set(stored);
  }
}

// Call init immediately if we're in browser
if (typeof window !== 'undefined') {
  initPendingTransactions();
}

// Sync to localStorage when pending transactions change
pendingTransactions.subscribe((txs) => {
  if (pendingTxInitialized) {
    savePendingToStorage(txs);
  }
});

// Listen for storage events from other tabs
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === PENDING_TX_KEY) {
      const newTxs = event.newValue ? JSON.parse(event.newValue) : [];
      pendingTransactions.set(newTxs);
    }
  });
}

// Export init function so components can ensure it's called
export function ensurePendingTransactionsLoaded(): void {
  initPendingTransactions();
}

/**
 * Store to signal that transaction history needs refresh
 * Wallet page can subscribe to this and refresh when it changes
 */
export const transactionsNeedRefresh = writable<number>(0);

/**
 * Signal that transactions should be refreshed (call after payment completes)
 */
export function signalTransactionsRefresh(): void {
  transactionsNeedRefresh.update((n) => n + 1);
  // Also trigger via localStorage for cross-tab sync
  if (typeof window !== 'undefined') {
    localStorage.setItem('zapcooking_tx_refresh', String(Date.now()));
  }
}

export function addPendingTransaction(tx: Omit<Transaction, 'status'>): string {
  const pendingTx: Transaction = { ...tx, status: 'pending' };
  pendingTransactions.update((txs) => [pendingTx, ...txs]);
  return tx.id;
}

export function removePendingTransaction(id: string): void {
  pendingTransactions.update((txs) => txs.filter((tx) => tx.id !== id));
}

export function updatePendingTransactionStatus(
  id: string,
  status: 'pending' | 'completed' | 'failed'
): void {
  pendingTransactions.update((txs) => txs.map((tx) => (tx.id === id ? { ...tx, status } : tx)));
}

export function updatePendingTransaction(
  id: string,
  updates: Partial<Omit<Transaction, 'id'>>
): void {
  pendingTransactions.update((txs) => txs.map((tx) => (tx.id === id ? { ...tx, ...updates } : tx)));
}

/**
 * Clear all pending transactions
 */
export function clearPendingTransactions(): void {
  pendingTransactions.set([]);
}

/**
 * Map a Spark payment object to our Transaction type
 */
function mapSparkPayment(p: any): Transaction {
  const paymentType = p.paymentType || p.payment_type || p.type || '';
  const isIncoming =
    paymentType === 'received' ||
    paymentType === 'RECEIVED' ||
    paymentType === 'receive' ||
    paymentType === 'incoming';
  const amountMsat = p.amountMsat || p.amount_msat || p.amountMSat || 0;
  const amountSat =
    p.amountSat || p.amount_sat || p.amount || Math.floor(Number(amountMsat) / 1000);
  let timestamp = p.createdAt || p.created_at || p.timestamp || p.time || 0;
  if (timestamp > 4102444800) timestamp = Math.floor(timestamp / 1000);
  const feesMsat = p.feesMsat || p.fees_msat || p.feesMSat || 0;
  const feesSat =
    p.feesSat ||
    p.fees_sat ||
    p.fees ||
    (feesMsat ? Math.floor(Number(feesMsat) / 1000) : undefined);
  const rawStatus = p.status || 'completed';
  const status =
    rawStatus === 'pending' ? 'pending' : rawStatus === 'failed' ? 'failed' : 'completed';

  const txid =
    p.txid ||
    p.txId ||
    p.tx_id ||
    p.txHash ||
    p.tx_hash ||
    p.transactionId ||
    p.transaction_id ||
    p.onchainTxid ||
    p.onchain_txid ||
    p.onchain?.txid ||
    p.onchain?.txId ||
    p.paymentMethod?.txid ||
    p.paymentMethod?.txId ||
    p.paymentMethod?.transactionId ||
    p.paymentMethod?.transaction_id ||
    p.paymentMethod?.txHash ||
    p.paymentMethod?.tx_hash;

  if (!txid) {
    const isOnchain =
      p.paymentMethod?.type === 'bitcoinAddress' ||
      p.payment_method?.type === 'bitcoinAddress' ||
      p.onchain ||
      p.onchainTxid ||
      p.onchain_txid ||
      String(paymentType).toLowerCase().includes('onchain');
    const paymentId = p.id || p.paymentHash || p.payment_hash || '';
    if (isOnchain) {
      try {
        console.warn(
          '[WalletManager] Spark on-chain payment missing txid:',
          JSON.stringify(
            { id: paymentId, payment: p },
            (key, value) => (typeof value === 'bigint' ? value.toString() : value),
            2
          )
        );
      } catch (e) {
        console.warn('[WalletManager] Spark on-chain payment missing txid:', paymentId, p);
      }
    }
  }

  return {
    id: p.id || p.paymentHash || p.payment_hash || txid || String(Math.random()),
    txid,
    type: isIncoming ? 'incoming' : ('outgoing' as 'incoming' | 'outgoing'),
    amount: Number(amountSat),
    description: p.description || p.memo || p.bolt11?.substring(0, 20),
    timestamp: timestamp || Math.floor(Date.now() / 1000),
    fees: feesSat,
    status
  };
}

/**
 * Get the timestamp from a payment object
 */
function getPaymentTimestamp(p: any): number {
  let ts = p.createdAt || p.created_at || p.timestamp || p.time || 0;
  // Convert milliseconds to seconds if needed
  if (ts > 4102444800) ts = Math.floor(ts / 1000);
  return ts;
}

/**
 * Get payment history from the active wallet
 * @param options.limit Maximum number of transactions to return (default: 30)
 * @param options.offset Pagination offset (for NWC)
 * @param options.toTimestamp For Spark: fetch payments older than this timestamp (cursor-based pagination)
 * @param options.existingIds Set of existing transaction IDs for deduplication
 */
export async function getPaymentHistory(
  options: {
    limit?: number;
    offset?: number;
    toTimestamp?: number;
    existingIds?: Set<string>;
  } = {}
): Promise<{
  transactions: Transaction[];
  hasMore: boolean;
  oldestTimestamp?: number;
}> {
  const wallet = getActiveWallet();

  if (!wallet) {
    return { transactions: [], hasMore: false };
  }

  // Ensure the wallet is connected before trying to get history
  const connected = await ensureWalletConnected(wallet);
  if (!connected) {
    console.warn('[WalletManager] Wallet not connected, cannot get payment history');
    return { transactions: [], hasMore: false };
  }

  const limit = options.limit || 30;
  const offset = options.offset || 0;
  const existingIds = options.existingIds || new Set<string>();

  try {
    switch (wallet.kind) {
      case 3: // NWC - uses offset-based pagination
        const nwcResult = await listNwcTransactions({ limit, offset });
        const nwcTransactions = nwcResult.transactions.map((tx) => ({
          id: tx.payment_hash,
          type: tx.type,
          amount: Math.floor(tx.amount / 1000), // Convert msats to sats
          description: tx.description,
          timestamp: tx.settled_at || tx.created_at,
          fees: tx.fees_paid ? Math.floor(tx.fees_paid / 1000) : undefined
        }));
        // Find oldest timestamp for potential future cursor-based pagination
        const nwcOldest =
          nwcTransactions.length > 0
            ? Math.min(...nwcTransactions.map((tx) => tx.timestamp))
            : undefined;
        return {
          transactions: nwcTransactions,
          hasMore: nwcResult.hasMore,
          oldestTimestamp: nwcOldest
        };

      case 4: // Spark - uses cursor-based pagination with toTimestamp
        // Fetch from SDK with optional toTimestamp for pagination
        const sparkResult = await listSparkPayments(limit, options.toTimestamp);
        const recentFromEvents = get(recentSparkPayments);
        if (!sparkPaymentDebugLogged) {
          sparkPaymentDebugLogged = true;
          try {
            const sample = sparkResult.payments?.[0];
            console.warn(
              '[WalletManager] Spark listPayments sample:',
              JSON.stringify(
                {
                  count: sparkResult.payments?.length || 0,
                  hasRecentEvents: recentFromEvents.length,
                  sample
                },
                (key, value) => (typeof value === 'bigint' ? value.toString() : value),
                2
              )
            );
          } catch (e) {
            console.warn(
              '[WalletManager] Spark listPayments sample (raw):',
              sparkResult.payments?.[0]
            );
          }
        }

        // On initial load (no toTimestamp), merge with recent events
        // On pagination (has toTimestamp), only use SDK results
        let paymentsToProcess: any[];
        if (options.toTimestamp === undefined) {
          // Initial load: merge SDK results with recent event payments
          const seenIds = new Set<string>();
          paymentsToProcess = [];

          // Add recent event payments first (they're more up-to-date)
          for (const p of recentFromEvents) {
            const id = p.id || p.paymentHash || p.payment_hash;
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              paymentsToProcess.push(p);
            }
          }
          // Add SDK payments (deduplicated)
          for (const p of sparkResult.payments) {
            const id = p.id || p.paymentHash || p.payment_hash;
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              paymentsToProcess.push(p);
            }
          }

          // Sort by timestamp descending (newest first)
          paymentsToProcess.sort((a, b) => getPaymentTimestamp(b) - getPaymentTimestamp(a));

          // Limit to requested page size
          paymentsToProcess = paymentsToProcess.slice(0, limit);
        } else {
          // Pagination: only use SDK results, filter out any already-seen IDs
          paymentsToProcess = sparkResult.payments.filter((p) => {
            const id = p.id || p.paymentHash || p.payment_hash;
            return !existingIds.has(id);
          });
        }

        // Map to Transaction type
        const sparkTransactions = paymentsToProcess.map(mapSparkPayment);

        // Find oldest timestamp for next pagination cursor
        const oldestTimestamp =
          sparkTransactions.length > 0
            ? Math.min(...sparkTransactions.map((tx) => tx.timestamp))
            : undefined;

        return {
          transactions: sparkTransactions,
          hasMore: sparkResult.hasMore,
          oldestTimestamp
        };

      default:
        // WebLN doesn't support transaction history
        return { transactions: [], hasMore: false };
    }
  } catch (e) {
    console.error('[WalletManager] Failed to get payment history:', e);
    return { transactions: [], hasMore: false };
  }
}

let isInitialized = false;
let initializationPromise: Promise<void> | null = null;
let sparkPaymentDebugLogged = false;

export async function initializeWalletManager(): Promise<void> {
  if (isInitialized) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    await ndkReady;

    const savedWallets = get(wallets);
    const active = savedWallets.find((w) => w.active);

    if (active) {
      try {
        switch (active.kind) {
          case 1:
            if (isWeblnAvailable()) await connectWebln();
            break;
          case 3:
            await connectNwc(active.data);
            break;
          case 4:
            const apiKey = import.meta.env.VITE_BREEZ_API_KEY;
            const pubkey = get(userPublickey);
            if (apiKey && pubkey) await connectSparkWallet(pubkey, apiKey);
            break;
        }
        await refreshBalance();
      } catch (e) {
        console.warn('[WalletManager] Failed to restore wallet:', e);
      }
    }
    isInitialized = true;
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

// Re-export stores for convenience
export {
  wallets,
  activeWallet,
  walletBalance,
  walletConnected,
  walletLoading,
  walletLastSync
} from './walletStore';
export { isWeblnAvailable } from './webln';
export { isValidNwcUrl } from './nwc';
