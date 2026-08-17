import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type MembershipTier = 'cook_plus' | 'pro_kitchen' | 'founders' | 'member' | 'unknown';

export interface MembershipStatus {
  active: boolean;
  tier: MembershipTier;
  expiresAt?: string;
}

type MembershipResponse = Record<string, { active?: boolean; tier?: string; expiresAt?: string }>;

const BATCH_DEBOUNCE_MS = 75;
const MAX_BATCH_SIZE = 200;

const statusCache = new Map<string, MembershipStatus>();
const inFlight = new Set<string>();
const queued = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Bumped every time a forced refresh is issued for a pubkey. A batch that was
// already in flight when the refresh started carries an older answer, and
// without this it would land after the refresh and restore the stale value —
// the exact defect the refresh exists to fix. Each fetch captures the epoch of
// every pubkey it requested and drops any whose epoch moved underneath it.
const refreshEpoch = new Map<string, number>();

function epochOf(pubkey: string): number {
  return refreshEpoch.get(pubkey) ?? 0;
}

const mapStore = writable<Record<string, MembershipStatus>>({});
export const membershipStatusMap = { subscribe: mapStore.subscribe };

function normalizePubkey(pubkey: string | null | undefined): string | null {
  if (!pubkey) return null;
  const normalized = String(pubkey).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeTier(tier: string | undefined): MembershipTier {
  const value = String(tier || '').trim().toLowerCase();
  if (value === 'cook_plus' || value === 'cook-plus' || value === 'cook plus') return 'cook_plus';
  if (value === 'pro_kitchen' || value === 'pro-kitchen' || value === 'pro kitchen') return 'pro_kitchen';
  if (value === 'founders' || value === 'founder' || value === 'genesis_founder' || value === 'genesis-founder' || value === 'genesis founder') return 'founders';
  if (value === 'member') return 'member';
  return 'unknown';
}

function updateStore(pubkey: string, status: MembershipStatus): void {
  statusCache.set(pubkey, status);
  mapStore.update((current) => ({ ...current, [pubkey]: status }));
}

function normalizeStatus(raw: { active?: boolean; tier?: string; expiresAt?: string }): MembershipStatus {
  return {
    active: Boolean(raw?.active),
    tier: normalizeTier(raw?.tier),
    expiresAt: raw?.expiresAt
  };
}

async function fetchBatch(pubkeys: string[], init?: RequestInit): Promise<void> {
  if (!browser || pubkeys.length === 0) return;

  const requested = [...new Set(pubkeys)];
  requested.forEach((pk) => inFlight.add(pk));
  const startEpochs = new Map(requested.map((pk) => [pk, epochOf(pk)]));
  const superseded = (pubkey: string): boolean => epochOf(pubkey) !== startEpochs.get(pubkey);

  try {
    const query = encodeURIComponent(requested.join(','));
    const res = await fetch(`/api/membership?pubkeys=${query}`, init);
    if (!res.ok) {
      throw new Error(`Membership fetch failed with status ${res.status}`);
    }

    const payload = (await res.json()) as MembershipResponse;
    for (const pubkey of requested) {
      if (superseded(pubkey)) continue;
      const raw = payload?.[pubkey];
      if (raw) {
        updateStore(pubkey, normalizeStatus(raw));
      } else {
        updateStore(pubkey, { active: false, tier: 'unknown' });
      }
    }
  } catch (error) {
    console.warn('[membershipStatus] Batch fetch failed:', error);
    for (const pubkey of requested) {
      // No epoch check needed here: this path only writes a placeholder for a
      // pubkey with no value at all, so a refresh that wrote one is already
      // safe. Adding the guard would change behaviour only when the refresh
      // failed too, and then it would leave the pubkey with no entry instead
      // of the placeholder this path has always written.
      if (!statusCache.has(pubkey)) {
        updateStore(pubkey, { active: false, tier: 'unknown' });
      }
    }
  } finally {
    requested.forEach((pk) => inFlight.delete(pk));
  }
}

function flushQueue(): void {
  flushTimer = null;
  const list = [...queued];
  queued.clear();
  if (list.length === 0) return;

  for (let i = 0; i < list.length; i += MAX_BATCH_SIZE) {
    void fetchBatch(list.slice(i, i + MAX_BATCH_SIZE));
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushQueue, BATCH_DEBOUNCE_MS);
}

export function queueMembershipLookup(pubkey: string | null | undefined): void {
  if (!browser) return;
  const normalized = normalizePubkey(pubkey);
  if (!normalized) return;
  if (statusCache.has(normalized) || inFlight.has(normalized)) return;
  queued.add(normalized);
  scheduleFlush();
}

/**
 * Force a fresh lookup for one pubkey, ignoring anything already cached.
 *
 * `queueMembershipLookup` and `getMembership` both return early on a cached
 * pubkey, and the cache has no TTL — so a `{active:false}` read taken before a
 * payment completes is the answer every membership surface gets for the life of
 * the tab (avatar ring, belt badge, header, Cheffy). Call this once after a
 * payment is confirmed; every consumer reads `membershipStatusMap`, so the one
 * write reaches all of them.
 *
 * Deliberately NOT wired into the debounced queue: this is a single known
 * pubkey at a known moment, not feed traffic, so it does not reintroduce the
 * per-avatar request storm that took `getMembership` out of `Avatar.svelte`.
 * Callers must keep it that way — one call per completed payment.
 *
 * Never rejects: a failed lookup is swallowed by `fetchBatch`. If a previous
 * value exists it is left in place; if the cache had no entry yet, the failure
 * path writes the inactive placeholder (`{active:false, tier:'unknown'}`) that
 * `fetchBatch` has always written for an unknown pubkey. Callers can await
 * without risking the page.
 */
export async function refreshMembership(
  pubkey: string | null | undefined
): Promise<MembershipStatus | null> {
  if (!browser) return null;
  const normalized = normalizePubkey(pubkey);
  if (!normalized) return null;

  // Bump before the fetch, so any batch already in flight for this pubkey is
  // treated as superseded when it lands.
  refreshEpoch.set(normalized, epochOf(normalized) + 1);
  // A queued-but-unflushed lookup for this pubkey would only re-ask the same
  // question a moment later.
  queued.delete(normalized);

  await fetchBatch([normalized], { cache: 'no-store' });
  return statusCache.get(normalized) ?? null;
}

export async function getMembership(pubkeys: string[]): Promise<Record<string, MembershipStatus>> {
  const normalized = [...new Set(pubkeys.map(normalizePubkey).filter((pk): pk is string => Boolean(pk)))];

  if (normalized.length === 0) return {};
  if (!browser) {
    return Object.fromEntries(normalized.map((pk) => [pk, { active: false, tier: 'unknown' as const }]));
  }

  const missing = normalized.filter((pk) => !statusCache.has(pk) && !inFlight.has(pk));
  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += MAX_BATCH_SIZE) {
      await fetchBatch(missing.slice(i, i + MAX_BATCH_SIZE));
    }
  }

  const result: Record<string, MembershipStatus> = {};
  for (const pubkey of normalized) {
    result[pubkey] = statusCache.get(pubkey) || { active: false, tier: 'unknown' };
  }
  return result;
}

export function getMembershipLabel(tier: MembershipTier): string {
  switch (tier) {
    case 'cook_plus':
      return 'Cook+ Member';
    case 'pro_kitchen':
      return 'Pro Kitchen Member ⚡';
    case 'founders':
      return 'Founders Member';
    case 'member':
      return 'Member';
    default:
      return 'Member';
  }
}

// Test helper for deterministic batching tests.
export function __resetMembershipStatusStoreForTests(): void {
  statusCache.clear();
  inFlight.clear();
  queued.clear();
  refreshEpoch.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  mapStore.set({});
}
