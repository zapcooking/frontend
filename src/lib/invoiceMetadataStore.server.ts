/**
 * Invoice Metadata Store (server-side, in-memory with TTL)
 *
 * Maps Strike receiveRequestId to membership metadata (pubkey, tier, period)
 * so that webhooks and verification endpoints can match payments to users.
 *
 * Entries expire after 2 hours (Lightning invoices typically expire in 1 hour).
 *
 * NOTE: This is an in-memory store. It works for single-instance deployments.
 * For multi-instance or serverless deployments, replace with a database or KV store.
 */

export interface InvoiceMetadata {
  pubkey: string;
  tier: 'cook' | 'pro';
  period: 'annual' | '2year';
  receiveRequestId: string;
  createdAt: number;
}

const ENTRY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // Clean up every 10 minutes

const store = new Map<string, InvoiceMetadata>();

// Also index by paymentHash for client-side verification lookups
const paymentHashIndex = new Map<string, string>(); // paymentHash -> receiveRequestId

// Periodic cleanup of expired entries
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupRunning() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of store) {
      if (now - entry.createdAt > ENTRY_TTL_MS) {
        store.delete(id);
      }
    }
    // Clean stale paymentHash index entries
    for (const [hash, receiveId] of paymentHashIndex) {
      if (!store.has(receiveId)) {
        paymentHashIndex.delete(hash);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't prevent process exit
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Store metadata for a newly created invoice.
 * Call this when creating a Lightning invoice via Strike API.
 */
export function storeInvoiceMetadata(
  receiveRequestId: string,
  metadata: Omit<InvoiceMetadata, 'createdAt' | 'receiveRequestId'>,
  paymentHash?: string
): void {
  ensureCleanupRunning();

  const entry: InvoiceMetadata = {
    ...metadata,
    receiveRequestId,
    createdAt: Date.now(),
  };
  store.set(receiveRequestId, entry);

  if (paymentHash) {
    paymentHashIndex.set(paymentHash, receiveRequestId);
  }
}

/**
 * Look up metadata by receiveRequestId (used by webhooks).
 */
export function getInvoiceMetadata(receiveRequestId: string): InvoiceMetadata | null {
  const entry = store.get(receiveRequestId);
  if (!entry) return null;

  // Check expiry
  if (Date.now() - entry.createdAt > ENTRY_TTL_MS) {
    store.delete(receiveRequestId);
    return null;
  }

  return entry;
}

/**
 * Look up metadata by paymentHash (used by client-side verify endpoint).
 */
export function getInvoiceMetadataByPaymentHash(paymentHash: string): InvoiceMetadata | null {
  const receiveRequestId = paymentHashIndex.get(paymentHash);
  if (!receiveRequestId) return null;
  return getInvoiceMetadata(receiveRequestId);
}

/**
 * Remove metadata after successful processing (optional cleanup).
 */
export function removeInvoiceMetadata(receiveRequestId: string): void {
  const entry = store.get(receiveRequestId);
  if (entry) {
    store.delete(receiveRequestId);
    // Also clean paymentHash index
    for (const [hash, id] of paymentHashIndex) {
      if (id === receiveRequestId) {
        paymentHashIndex.delete(hash);
        break;
      }
    }
  }
}
