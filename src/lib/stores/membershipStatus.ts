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

async function fetchBatch(pubkeys: string[]): Promise<void> {
  if (!browser || pubkeys.length === 0) return;

  const requested = [...new Set(pubkeys)];
  requested.forEach((pk) => inFlight.add(pk));

  try {
    const query = encodeURIComponent(requested.join(','));
    const res = await fetch(`/api/membership?pubkeys=${query}`);
    if (!res.ok) {
      throw new Error(`Membership fetch failed with status ${res.status}`);
    }

    const payload = (await res.json()) as MembershipResponse;
    for (const pubkey of requested) {
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
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  mapStore.set({});
}
