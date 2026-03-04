/**
 * Sponsor Record Store (server-side, Cloudflare KV with in-memory dev fallback)
 *
 * Stores sponsor records for custom ad placements on the homepage and feed.
 * Follows the same KV pattern as boostStore.server.ts.
 *
 * KV key scheme:
 *   sponsor:{id}                    → full SponsorRecord JSON       (TTL 35 days)
 *   sponsor-inv:{receiveRequestId}  → sponsor ID string             (TTL 35 days)
 *   sponsor-active-list             → JSON array of active sponsor IDs (no TTL, managed manually)
 */

import { SPONSOR_PRICING, type SponsorTier, type SponsorDurationKey } from '$lib/sponsorPricing';
export { SPONSOR_PRICING, type SponsorTier, type SponsorDurationKey } from '$lib/sponsorPricing';

export interface SponsorRecord {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  linkUrl: string;
  buyerPubkey: string;
  tier: SponsorTier;
  durationKey: SponsorDurationKey;
  amountSats: number;
  receiveRequestId: string;
  paymentHash: string;
  status: 'pending' | 'active' | 'expired';
  createdAt: number;
  activatedAt: number | null;
  expiresAt: number | null;
}

/** Matches the shape of the GATED_CONTENT KV binding. */
export type SponsorKV = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
} | null | undefined;

const KV_TTL_SECONDS = 35 * 24 * 60 * 60; // 35 days — enough headroom for 30-day sponsors activated after a delay

// ── Key helpers ──────────────────────────────────────────────────────
function sponsorKey(id: string) { return `sponsor:${id}`; }
function sponsorInvKey(receiveRequestId: string) { return `sponsor-inv:${receiveRequestId}`; }
const ACTIVE_LIST_KEY = 'sponsor-active-list';

// ── Dev-only in-memory fallback ──────────────────────────────────────
const memSponsors = new Map<string, SponsorRecord>();
const memInvIndex = new Map<string, string>(); // receiveRequestId → sponsor ID
let memActiveList: string[] = [];

/**
 * Store a pending sponsor record (called when invoice is created).
 */
export async function storeSponsor(
  kv: SponsorKV,
  sponsor: SponsorRecord,
): Promise<void> {
  const opts = { expirationTtl: KV_TTL_SECONDS };

  if (kv) {
    await kv.put(sponsorKey(sponsor.id), JSON.stringify(sponsor), opts);
    await kv.put(sponsorInvKey(sponsor.receiveRequestId), sponsor.id, opts);
  } else {
    memSponsors.set(sponsor.id, sponsor);
    memInvIndex.set(sponsor.receiveRequestId, sponsor.id);
  }
}

/**
 * Get a sponsor record by ID.
 */
export async function getSponsor(
  kv: SponsorKV,
  id: string,
): Promise<SponsorRecord | null> {
  if (kv) {
    const raw = await kv.get(sponsorKey(id), 'text') as string | null;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SponsorRecord;
    } catch {
      await kv.delete(sponsorKey(id));
      return null;
    }
  }

  return memSponsors.get(id) ?? null;
}

/**
 * Look up a sponsor ID by receiveRequestId (used by webhooks).
 */
export async function getSponsorByReceiveRequestId(
  kv: SponsorKV,
  receiveRequestId: string,
): Promise<SponsorRecord | null> {
  if (kv) {
    const sponsorId = await kv.get(sponsorInvKey(receiveRequestId), 'text') as string | null;
    if (!sponsorId) return null;
    return getSponsor(kv, sponsorId);
  }

  const sponsorId = memInvIndex.get(receiveRequestId);
  if (!sponsorId) return null;
  return getSponsor(kv, sponsorId);
}

/**
 * Activate a sponsor after payment is confirmed.
 * Sets status to 'active', records timestamps, and adds to the active list.
 */
export async function activateSponsor(
  kv: SponsorKV,
  sponsorId: string,
): Promise<SponsorRecord | null> {
  const sponsor = await getSponsor(kv, sponsorId);
  if (!sponsor) return null;
  if (sponsor.status === 'active') return sponsor; // idempotent

  const now = Date.now();
  const duration = SPONSOR_PRICING[sponsor.tier][sponsor.durationKey].durationMs;

  sponsor.status = 'active';
  sponsor.activatedAt = now;
  sponsor.expiresAt = now + duration;

  const opts = { expirationTtl: KV_TTL_SECONDS };

  if (kv) {
    await kv.put(sponsorKey(sponsorId), JSON.stringify(sponsor), opts);

    // Update active list
    const activeList = await getActiveSponsorIds(kv);
    if (!activeList.includes(sponsorId)) {
      activeList.push(sponsorId);
      await kv.put(ACTIVE_LIST_KEY, JSON.stringify(activeList));
    }
  } else {
    memSponsors.set(sponsorId, sponsor);
    if (!memActiveList.includes(sponsorId)) {
      memActiveList.push(sponsorId);
    }
  }

  return sponsor;
}

/**
 * Get the raw list of active sponsor IDs from KV.
 */
async function getActiveSponsorIds(kv: SponsorKV): Promise<string[]> {
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
 * Get all currently active (non-expired) sponsors.
 * Performs lazy expiry: filters out and cleans up expired entries on read.
 * Optionally filter by tier.
 */
export async function getActiveSponsors(kv: SponsorKV, tier?: SponsorTier): Promise<SponsorRecord[]> {
  const ids = await getActiveSponsorIds(kv);
  if (ids.length === 0) return [];

  const now = Date.now();
  const active: SponsorRecord[] = [];
  const expiredIds: string[] = [];

  for (const id of ids) {
    const sponsor = await getSponsor(kv, id);
    if (!sponsor || sponsor.status !== 'active' || (sponsor.expiresAt && sponsor.expiresAt <= now)) {
      expiredIds.push(id);
      // Mark as expired in KV if the record exists
      if (sponsor && sponsor.status === 'active') {
        sponsor.status = 'expired';
        if (kv) {
          await kv.put(sponsorKey(id), JSON.stringify(sponsor), { expirationTtl: KV_TTL_SECONDS });
        } else {
          memSponsors.set(id, sponsor);
        }
      }
    } else {
      if (!tier || sponsor.tier === tier) {
        active.push(sponsor);
      }
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
