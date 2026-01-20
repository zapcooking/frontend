/**
 * Server-side storage for NIP-108 Gated Content
 * 
 * Uses in-memory storage for development.
 * In production, replace this with a proper database (KV, D1, etc.)
 * 
 * Note: Data is lost on server restart. For persistence, implement
 * database storage (e.g., Cloudflare KV, D1, or SQLite).
 */

export interface GatedContentData {
  encryptedContent: string;
  iv: string;
  secret: string;
  costMsats: number;
  endpoint: string;
  preview: string;
  title: string;
  authorPubkey: string;
  authorLightningAddress?: string; // Author's lud16 for receiving payments
  createdAt: number;
  naddr?: string; // The naddr for linking to the recipe
  image?: string; // Recipe image URL
  purchases: Map<string, { paidAt: number; preimage?: string }>;
}

// In-memory store for gated content
// Structure: Map<gatedNoteId, GatedContentData>
const gatedContentStore = new Map<string, GatedContentData>();

/**
 * Get gated content by ID
 */
export function getGatedContent(gatedNoteId: string): GatedContentData | undefined {
  return gatedContentStore.get(gatedNoteId);
}

/**
 * Store gated content
 */
export function storeGatedContent(gatedNoteId: string, data: Omit<GatedContentData, 'purchases' | 'createdAt'>): void {
  gatedContentStore.set(gatedNoteId, {
    ...data,
    createdAt: Date.now(),
    purchases: new Map()
  });
  console.log(`[NIP-108 Store] ✅ Stored recipe: ${data.title} (${gatedNoteId})`);
  console.log(`[NIP-108 Store] Total recipes in memory: ${gatedContentStore.size}`);
}

/**
 * Check if gated content exists
 */
export function hasGatedContent(gatedNoteId: string): boolean {
  return gatedContentStore.has(gatedNoteId);
}

/**
 * Mark a user as having paid for gated content
 */
export function markAsPaid(gatedNoteId: string, userPubkey: string, preimage?: string): void {
  const content = gatedContentStore.get(gatedNoteId);
  if (content) {
    content.purchases.set(userPubkey, { paidAt: Date.now(), preimage });
    console.log(`[NIP-108 Store] ✅ Marked as paid: ${gatedNoteId} for user ${userPubkey.substring(0, 8)}...`);
  }
}

/**
 * Check if a user has paid for gated content
 */
export function hasPaid(gatedNoteId: string, userPubkey: string): boolean {
  const content = gatedContentStore.get(gatedNoteId);
  return content?.purchases.has(userPubkey) || false;
}

/**
 * Get all gated note IDs (for debugging)
 */
export function getAllGatedNoteIds(): string[] {
  return Array.from(gatedContentStore.keys());
}

/**
 * Get all gated content metadata (for listing)
 * Note: costSats is converted from msats for display
 */
export function getAllGatedContentMeta(): Array<{
  gatedNoteId: string;
  title: string;
  preview: string;
  costSats: number; // Converted from msats for display
  authorPubkey: string;
  createdAt: number;
  naddr?: string;
  image?: string;
}> {
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
  
  gatedContentStore.forEach((data, gatedNoteId) => {
    results.push({
      gatedNoteId,
      title: data.title,
      preview: data.preview,
      costSats: Math.ceil(data.costMsats / 1000), // Convert msats to sats
      authorPubkey: data.authorPubkey,
      createdAt: data.createdAt,
      naddr: data.naddr,
      image: data.image
    });
  });
  
  // Sort by createdAt descending
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Update the naddr for a gated recipe (called after publishing to Nostr)
 */
export function updateGatedContentNaddr(gatedNoteId: string, naddr: string): boolean {
  const content = gatedContentStore.get(gatedNoteId);
  if (content) {
    content.naddr = naddr;
    return true;
  }
  return false;
}
