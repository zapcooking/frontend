/**
 * Invoice Metadata Store (server-side, Cloudflare KV with in-memory dev fallback)
 *
 * Maps Strike receiveRequestId to membership metadata (pubkey, tier, period)
 * so that webhooks and verification endpoints can match payments to users.
 *
 * KV key scheme:
 *   inv:{receiveRequestId}   → full InvoiceMetadata JSON  (TTL 2 hours)
 *   invhash:{paymentHash}    → receiveRequestId string    (TTL 2 hours)
 *
 * In dev (no KV binding), falls back to an in-memory Map with expiry-on-read.
 */

export interface InvoiceMetadata {
  pubkey: string;
  tier: 'cook' | 'pro';
  period: 'annual' | 'monthly';
  receiveRequestId: string;
  createdAt: number;
}

/** Matches the shape of the GATED_CONTENT KV binding. */
export type InvoiceKV = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
} | null | undefined;

const KV_TTL_SECONDS = 7200; // 2 hours
const ENTRY_TTL_MS = KV_TTL_SECONDS * 1000;

// ── Dev-only in-memory fallback ──────────────────────────────────────
const memStore = new Map<string, InvoiceMetadata>();
const memHashIndex = new Map<string, string>(); // paymentHash → receiveRequestId

function memIsExpired(entry: InvoiceMetadata): boolean {
  return Date.now() - entry.createdAt > ENTRY_TTL_MS;
}

// ── Key helpers ──────────────────────────────────────────────────────
function invKey(receiveRequestId: string) { return `inv:${receiveRequestId}`; }
function hashKey(paymentHash: string) { return `invhash:${paymentHash}`; }

/**
 * Store metadata for a newly created invoice.
 * Call this when creating a Lightning invoice via Strike API.
 */
export async function storeInvoiceMetadata(
  kv: InvoiceKV,
  receiveRequestId: string,
  metadata: Omit<InvoiceMetadata, 'createdAt' | 'receiveRequestId'>,
  paymentHash?: string
): Promise<void> {
  const entry: InvoiceMetadata = {
    ...metadata,
    receiveRequestId,
    createdAt: Date.now(),
  };

  if (kv) {
    const opts = { expirationTtl: KV_TTL_SECONDS };
    await kv.put(invKey(receiveRequestId), JSON.stringify(entry), opts);
    if (paymentHash) {
      await kv.put(hashKey(paymentHash), receiveRequestId, opts);
    }
  } else {
    // Dev fallback
    memStore.set(receiveRequestId, entry);
    if (paymentHash) {
      memHashIndex.set(paymentHash, receiveRequestId);
    }
  }
}

/**
 * Look up metadata by receiveRequestId (used by webhooks).
 */
export async function getInvoiceMetadata(
  kv: InvoiceKV,
  receiveRequestId: string
): Promise<InvoiceMetadata | null> {
  if (kv) {
    const raw = await kv.get(invKey(receiveRequestId), 'text') as string | null;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as InvoiceMetadata;
    } catch {
      // Treat invalid/corrupted data as a cache miss and clean up the bad key.
      await kv.delete(invKey(receiveRequestId));
      return null;
    }
  }

  // Dev fallback
  const entry = memStore.get(receiveRequestId);
  if (!entry) return null;
  if (memIsExpired(entry)) {
    memStore.delete(receiveRequestId);
    return null;
  }
  return entry;
}

/**
 * Look up metadata by paymentHash (used by client-side verify endpoint).
 */
export async function getInvoiceMetadataByPaymentHash(
  kv: InvoiceKV,
  paymentHash: string
): Promise<InvoiceMetadata | null> {
  if (kv) {
    const receiveRequestId = await kv.get(hashKey(paymentHash), 'text') as string | null;
    if (!receiveRequestId) return null;
    return getInvoiceMetadata(kv, receiveRequestId);
  }

  // Dev fallback
  const receiveRequestId = memHashIndex.get(paymentHash);
  if (!receiveRequestId) return null;
  return getInvoiceMetadata(kv, receiveRequestId);
}

/**
 * Remove metadata after successful processing (optional cleanup).
 */
export async function removeInvoiceMetadata(
  kv: InvoiceKV,
  receiveRequestId: string
): Promise<void> {
  if (kv) {
    // We don't have the paymentHash readily available, but KV TTL will
    // clean up the hash entry. Delete the primary key immediately.
    await kv.delete(invKey(receiveRequestId));
  } else {
    const entry = memStore.get(receiveRequestId);
    if (entry) {
      memStore.delete(receiveRequestId);
      for (const [hash, id] of memHashIndex) {
        if (id === receiveRequestId) {
          memHashIndex.delete(hash);
          break;
        }
      }
    }
  }
}
