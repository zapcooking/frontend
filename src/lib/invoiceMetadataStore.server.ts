/**
 * Invoice Metadata Store (server-side, Cloudflare KV with TTL)
 *
 * Maps Strike receiveRequestId to membership metadata (pubkey, tier, period)
 * so that webhooks and verification endpoints can match payments to users.
 *
 * Entries expire after 2 hours (Lightning invoices typically expire in 1 hour).
 *
 * Uses Cloudflare KV for persistent storage across serverless instances.
 * Falls back to in-memory storage for development/testing when KV is unavailable.
 */

export interface InvoiceMetadata {
  pubkey: string;
  tier: 'cook' | 'pro';
  period: 'annual' | '2year';
  receiveRequestId: string;
  createdAt: number;
}

const ENTRY_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const ENTRY_TTL_SECONDS = Math.floor(ENTRY_TTL_MS / 1000); // For KV expirationTtl

// In-memory fallback store for development (when KV is not available)
const fallbackStore = new Map<string, InvoiceMetadata>();
const fallbackPaymentHashIndex = new Map<string, string>();

// Type for platform with KV binding
type PlatformWithKV = {
  env?: {
    INVOICE_METADATA?: {
      get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
      put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
      delete(key: string): Promise<void>;
    };
  };
};

/**
 * Store metadata for a newly created invoice.
 * Call this when creating a Lightning invoice via Strike API.
 */
export async function storeInvoiceMetadata(
  receiveRequestId: string,
  metadata: Omit<InvoiceMetadata, 'createdAt' | 'receiveRequestId'>,
  paymentHash?: string,
  platform?: PlatformWithKV
): Promise<void> {
  const entry: InvoiceMetadata = {
    ...metadata,
    receiveRequestId,
    createdAt: Date.now(),
  };

  const kv = platform?.env?.INVOICE_METADATA;

  if (kv) {
    // Store in Cloudflare KV with TTL
    const key = `invoice:${receiveRequestId}`;
    await kv.put(key, JSON.stringify(entry), { expirationTtl: ENTRY_TTL_SECONDS });

    // Also create a paymentHash index entry if provided
    if (paymentHash) {
      const hashKey = `hash:${paymentHash}`;
      await kv.put(hashKey, receiveRequestId, { expirationTtl: ENTRY_TTL_SECONDS });
    }
  } else {
    // Fallback to in-memory store for development
    console.warn('[InvoiceMetadataStore] KV not available, using in-memory fallback');
    fallbackStore.set(receiveRequestId, entry);
    if (paymentHash) {
      fallbackPaymentHashIndex.set(paymentHash, receiveRequestId);
    }
  }
}

/**
 * Look up metadata by receiveRequestId (used by webhooks).
 */
export async function getInvoiceMetadata(
  receiveRequestId: string,
  platform?: PlatformWithKV
): Promise<InvoiceMetadata | null> {
  const kv = platform?.env?.INVOICE_METADATA;

  if (kv) {
    // Retrieve from Cloudflare KV
    const key = `invoice:${receiveRequestId}`;
    const value = await kv.get(key, 'text');
    
    if (!value) return null;
    
    try {
      const entry = JSON.parse(value as string) as InvoiceMetadata;
      
      // KV automatically handles expiration via TTL, but double-check for safety
      if (Date.now() - entry.createdAt > ENTRY_TTL_MS) {
        await kv.delete(key);
        return null;
      }
      
      return entry;
    } catch (error) {
      console.error('[InvoiceMetadataStore] Error parsing KV entry:', error);
      return null;
    }
  } else {
    // Fallback to in-memory store
    const entry = fallbackStore.get(receiveRequestId);
    if (!entry) return null;

    // Check expiry
    if (Date.now() - entry.createdAt > ENTRY_TTL_MS) {
      fallbackStore.delete(receiveRequestId);
      return null;
    }

    return entry;
  }
}

/**
 * Look up metadata by paymentHash (used by client-side verify endpoint).
 */
export async function getInvoiceMetadataByPaymentHash(
  paymentHash: string,
  platform?: PlatformWithKV
): Promise<InvoiceMetadata | null> {
  const kv = platform?.env?.INVOICE_METADATA;

  if (kv) {
    // Look up receiveRequestId from paymentHash index
    const hashKey = `hash:${paymentHash}`;
    const receiveRequestId = await kv.get(hashKey, 'text');
    
    if (!receiveRequestId) return null;
    
    return getInvoiceMetadata(receiveRequestId as string, platform);
  } else {
    // Fallback to in-memory store
    const receiveRequestId = fallbackPaymentHashIndex.get(paymentHash);
    if (!receiveRequestId) return null;
    return getInvoiceMetadata(receiveRequestId, platform);
  }
}

/**
 * Remove metadata after successful processing (optional cleanup).
 */
export async function removeInvoiceMetadata(
  receiveRequestId: string,
  platform?: PlatformWithKV
): Promise<void> {
  const kv = platform?.env?.INVOICE_METADATA;

  if (kv) {
    // First, get the entry to find the paymentHash (if any)
    const key = `invoice:${receiveRequestId}`;
    const value = await kv.get(key, 'text');
    
    if (value) {
      try {
        const entry = JSON.parse(value as string) as InvoiceMetadata;
        
        // Delete the main entry
        await kv.delete(key);
        
        // Note: We don't have the paymentHash readily available here.
        // The hash index entries will expire automatically via TTL.
        // In a production system, you might want to store the hash in the metadata
        // or maintain a reverse index.
      } catch (error) {
        console.error('[InvoiceMetadataStore] Error parsing entry for deletion:', error);
      }
    }
  } else {
    // Fallback to in-memory store
    const entry = fallbackStore.get(receiveRequestId);
    if (entry) {
      fallbackStore.delete(receiveRequestId);
      // Clean paymentHash index
      for (const [hash, id] of fallbackPaymentHashIndex) {
        if (id === receiveRequestId) {
          fallbackPaymentHashIndex.delete(hash);
          break;
        }
      }
    }
  }
}
