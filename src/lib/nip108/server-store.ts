/**
 * Server-side storage for NIP-108 Gated Content
 *
 * Uses Cloudflare KV in production, in-memory Maps for development.
 *
 * KV key structure:
 *   recipe:{gatedNoteId}     → GatedContentRecord (encrypted content + metadata)
 *   purchase:{gatedNoteId}:{pubkey} → PurchaseRecord
 *   pending:{gatedNoteId}:{pubkey}  → PendingPayment (TTL: 1 hour)
 *   index:recipes             → string[] (array of all gatedNoteIds)
 */

/** KV binding type — matches GATED_CONTENT in app.d.ts */
export type GatedKV = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
} | null;

export interface GatedContentRecord {
  encryptedContent: string;
  iv: string;
  secret: string;
  costMsats: number;
  endpoint: string;
  preview: string;
  title: string;
  authorPubkey: string;
  authorLightningAddress?: string;
  createdAt: number;
  naddr?: string;
  image?: string;
}

export interface PurchaseRecord {
  paidAt: number;
  preimage?: string;
}

export interface PendingPayment {
  paymentHash: string;
  createdAt: number;
}

// ── In-memory fallback stores (dev only) ──────────────────────────
const memRecipes = new Map<string, GatedContentRecord>();
const memPurchases = new Map<string, PurchaseRecord>(); // key: "{gatedNoteId}:{pubkey}"
const memPending = new Map<string, PendingPayment>();   // key: "{gatedNoteId}:{pubkey}"

// ── Recipe CRUD ───────────────────────────────────────────────────

export async function storeGatedContent(
  kv: GatedKV,
  gatedNoteId: string,
  data: Omit<GatedContentRecord, 'createdAt'>
): Promise<void> {
  const record: GatedContentRecord = { ...data, createdAt: Date.now() };

  if (kv) {
    await kv.put(`recipe:${gatedNoteId}`, JSON.stringify(record));
    // Update index
    const index = await getIndex(kv);
    if (!index.includes(gatedNoteId)) {
      index.push(gatedNoteId);
      await kv.put('index:recipes', JSON.stringify(index));
    }
  } else {
    memRecipes.set(gatedNoteId, record);
  }

  console.log(`[NIP-108 Store] ✅ Stored recipe: ${data.title} (${gatedNoteId})`);
}

export async function getGatedContent(
  kv: GatedKV,
  gatedNoteId: string
): Promise<GatedContentRecord | null> {
  if (kv) {
    const data = await kv.get(`recipe:${gatedNoteId}`, 'json') as GatedContentRecord | null;
    return data;
  }
  return memRecipes.get(gatedNoteId) || null;
}

export async function hasGatedContent(
  kv: GatedKV,
  gatedNoteId: string
): Promise<boolean> {
  if (kv) {
    const data = await kv.get(`recipe:${gatedNoteId}`, 'text');
    return data !== null;
  }
  return memRecipes.has(gatedNoteId);
}

export async function updateGatedContentNaddr(
  kv: GatedKV,
  gatedNoteId: string,
  naddr: string
): Promise<boolean> {
  const content = await getGatedContent(kv, gatedNoteId);
  if (!content) return false;

  content.naddr = naddr;

  if (kv) {
    await kv.put(`recipe:${gatedNoteId}`, JSON.stringify(content));
  }
  // In-memory: mutation already applied since we got a reference
  return true;
}

// ── Purchase tracking ─────────────────────────────────────────────

export async function markAsPaid(
  kv: GatedKV,
  gatedNoteId: string,
  userPubkey: string,
  preimage?: string
): Promise<void> {
  const record: PurchaseRecord = { paidAt: Date.now(), preimage };
  const key = `purchase:${gatedNoteId}:${userPubkey}`;

  if (kv) {
    await kv.put(key, JSON.stringify(record));
  } else {
    memPurchases.set(`${gatedNoteId}:${userPubkey}`, record);
  }

  console.log(`[NIP-108 Store] ✅ Marked as paid: ${gatedNoteId} for user ${userPubkey.substring(0, 8)}...`);
}

export async function hasPaid(
  kv: GatedKV,
  gatedNoteId: string,
  userPubkey: string
): Promise<boolean> {
  const key = `purchase:${gatedNoteId}:${userPubkey}`;

  if (kv) {
    const data = await kv.get(key, 'text');
    return data !== null;
  }
  return memPurchases.has(`${gatedNoteId}:${userPubkey}`);
}

// ── Pending payments (pre-verification) ───────────────────────────

const PENDING_TTL = 3600; // 1 hour in seconds

export async function storePendingPayment(
  kv: GatedKV,
  gatedNoteId: string,
  userPubkey: string,
  paymentHash: string
): Promise<void> {
  const record: PendingPayment = { paymentHash, createdAt: Date.now() };
  const key = `pending:${gatedNoteId}:${userPubkey}`;

  if (kv) {
    await kv.put(key, JSON.stringify(record), { expirationTtl: PENDING_TTL });
  } else {
    memPending.set(`${gatedNoteId}:${userPubkey}`, record);
  }
}

export async function getPendingPayment(
  kv: GatedKV,
  gatedNoteId: string,
  userPubkey: string
): Promise<PendingPayment | null> {
  const key = `pending:${gatedNoteId}:${userPubkey}`;

  if (kv) {
    return await kv.get(key, 'json') as PendingPayment | null;
  }

  const record = memPending.get(`${gatedNoteId}:${userPubkey}`);
  if (!record) return null;

  // Check expiry for in-memory (KV handles TTL automatically)
  if (Date.now() - record.createdAt > PENDING_TTL * 1000) {
    memPending.delete(`${gatedNoteId}:${userPubkey}`);
    return null;
  }
  return record;
}

export async function deletePendingPayment(
  kv: GatedKV,
  gatedNoteId: string,
  userPubkey: string
): Promise<void> {
  const key = `pending:${gatedNoteId}:${userPubkey}`;

  if (kv) {
    await kv.delete(key);
  } else {
    memPending.delete(`${gatedNoteId}:${userPubkey}`);
  }
}

// ── Index / listing ───────────────────────────────────────────────

async function getIndex(kv: GatedKV): Promise<string[]> {
  if (kv) {
    const data = await kv.get('index:recipes', 'json') as string[] | null;
    return data || [];
  }
  return Array.from(memRecipes.keys());
}

export async function getAllGatedContentMeta(kv: GatedKV): Promise<Array<{
  gatedNoteId: string;
  title: string;
  preview: string;
  costSats: number;
  authorPubkey: string;
  createdAt: number;
  naddr?: string;
  image?: string;
}>> {
  const ids = await getIndex(kv);
  const results: Array<{
    gatedNoteId: string;
    title: string;
    preview: string;
    costSats: number;
    authorPubkey: string;
    createdAt: number;
    naddr?: string;
    image?: string;
  }> = [];

  for (const id of ids) {
    const data = await getGatedContent(kv, id);
    if (data) {
      results.push({
        gatedNoteId: id,
        title: data.title,
        preview: data.preview,
        costSats: Math.ceil(data.costMsats / 1000),
        authorPubkey: data.authorPubkey,
        createdAt: data.createdAt,
        naddr: data.naddr,
        image: data.image
      });
    }
  }

  return results.sort((a, b) => b.createdAt - a.createdAt);
}
