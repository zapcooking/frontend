/**
 * Boost Record Store (server-side, Cloudflare KV with in-memory dev fallback)
 *
 * Stores boost records for sponsored recipe placements on the homepage.
 * Follows the same KV pattern as invoiceMetadataStore.server.ts.
 *
 * KV key scheme:
 *   boost:{id}                → full BoostRecord JSON        (TTL 35 days)
 *   boost-inv:{receiveRequestId} → boost ID string           (TTL 35 days)
 *   boost-active-list         → JSON array of active boost IDs (no TTL, managed manually)
 */

import { BOOST_PRICING, type BoostDurationKey } from '$lib/boostPricing';
export { BOOST_PRICING, type BoostDurationKey } from '$lib/boostPricing';

export interface BoostRecord {
  id: string;
  naddr: string;
  recipeTitle: string;
  recipeImage: string;
  authorPubkey: string;
  buyerPubkey: string;
  tier: 'featured';
  durationKey: BoostDurationKey;
  amountSats: number;
  receiveRequestId: string;
  paymentHash: string;
  status: 'pending' | 'active' | 'expired';
  createdAt: number;
  activatedAt: number | null;
  expiresAt: number | null;
}

/** Matches the shape of the GATED_CONTENT KV binding. */
export type BoostKV = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
} | null | undefined;

const KV_TTL_SECONDS = 35 * 24 * 60 * 60; // 35 days — enough headroom for 30-day boosts activated after a delay

// ── Key helpers ──────────────────────────────────────────────────────
function boostKey(id: string) { return `boost:${id}`; }
function boostInvKey(receiveRequestId: string) { return `boost-inv:${receiveRequestId}`; }
const ACTIVE_LIST_KEY = 'boost-active-list';

// ── Dev-only in-memory fallback ──────────────────────────────────────
const memBoosts = new Map<string, BoostRecord>();
const memInvIndex = new Map<string, string>(); // receiveRequestId → boost ID
let memActiveList: string[] = [];

/**
 * Store a pending boost record (called when invoice is created).
 */
export async function storeBoost(
  kv: BoostKV,
  boost: BoostRecord,
): Promise<void> {
  const opts = { expirationTtl: KV_TTL_SECONDS };

  if (kv) {
    await kv.put(boostKey(boost.id), JSON.stringify(boost), opts);
    await kv.put(boostInvKey(boost.receiveRequestId), boost.id, opts);
  } else {
    memBoosts.set(boost.id, boost);
    memInvIndex.set(boost.receiveRequestId, boost.id);
  }
}

/**
 * Get a boost record by ID.
 */
export async function getBoost(
  kv: BoostKV,
  id: string,
): Promise<BoostRecord | null> {
  if (kv) {
    const raw = await kv.get(boostKey(id), 'text') as string | null;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as BoostRecord;
    } catch {
      await kv.delete(boostKey(id));
      return null;
    }
  }

  return memBoosts.get(id) ?? null;
}

/**
 * Look up a boost ID by receiveRequestId (used by webhooks).
 */
export async function getBoostByReceiveRequestId(
  kv: BoostKV,
  receiveRequestId: string,
): Promise<BoostRecord | null> {
  if (kv) {
    const boostId = await kv.get(boostInvKey(receiveRequestId), 'text') as string | null;
    if (!boostId) return null;
    return getBoost(kv, boostId);
  }

  const boostId = memInvIndex.get(receiveRequestId);
  if (!boostId) return null;
  return getBoost(kv, boostId);
}

/**
 * Activate a boost after payment is confirmed.
 * Sets status to 'active', records timestamps, and adds to the active list.
 */
export async function activateBoost(
  kv: BoostKV,
  boostId: string,
): Promise<BoostRecord | null> {
  const boost = await getBoost(kv, boostId);
  if (!boost) return null;
  if (boost.status === 'active') return boost; // idempotent

  const now = Date.now();
  const duration = BOOST_PRICING[boost.durationKey].durationMs;

  boost.status = 'active';
  boost.activatedAt = now;
  boost.expiresAt = now + duration;

  const opts = { expirationTtl: KV_TTL_SECONDS };

  if (kv) {
    await kv.put(boostKey(boostId), JSON.stringify(boost), opts);

    // Update active list
    const activeList = await getActiveBoostIds(kv);
    if (!activeList.includes(boostId)) {
      activeList.push(boostId);
      await kv.put(ACTIVE_LIST_KEY, JSON.stringify(activeList));
    }
  } else {
    memBoosts.set(boostId, boost);
    if (!memActiveList.includes(boostId)) {
      memActiveList.push(boostId);
    }
  }

  return boost;
}

/**
 * Get the raw list of active boost IDs from KV.
 */
async function getActiveBoostIds(kv: BoostKV): Promise<string[]> {
  if (kv) {
    const raw = await kv.get(ACTIVE_LIST_KEY, 'text') as string | null;
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  return [...memActiveList];
}

/**
 * Get all currently active (non-expired) boosts.
 * Performs lazy expiry: filters out and cleans up expired entries on read.
 */
export async function getActiveBoosts(kv: BoostKV): Promise<BoostRecord[]> {
  const ids = await getActiveBoostIds(kv);
  if (ids.length === 0) return [];

  const now = Date.now();
  const active: BoostRecord[] = [];
  const expiredIds: string[] = [];

  for (const id of ids) {
    const boost = await getBoost(kv, id);
    if (!boost || boost.status !== 'active' || (boost.expiresAt && boost.expiresAt <= now)) {
      expiredIds.push(id);
      // Mark as expired in KV if the record exists
      if (boost && boost.status === 'active') {
        boost.status = 'expired';
        if (kv) {
          await kv.put(boostKey(id), JSON.stringify(boost), { expirationTtl: KV_TTL_SECONDS });
        } else {
          memBoosts.set(id, boost);
        }
      }
    } else {
      active.push(boost);
    }
  }

  // Clean up expired IDs from the active list
  if (expiredIds.length > 0) {
    const cleanedList = ids.filter((id) => !expiredIds.includes(id));
    if (kv) {
      await kv.put(ACTIVE_LIST_KEY, JSON.stringify(cleanedList));
    } else {
      memActiveList = cleanedList;
    }
  }

  return active;
}
