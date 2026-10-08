import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type MembershipTier = 'cook_plus' | 'pro_kitchen' | 'founders' | 'member' | 'unknown';
export type MembershipState = 'active' | 'inactive' | 'unknown';

export interface MembershipStatus {
  active: boolean;
  tier: MembershipTier;
  expiresAt?: string;
  /**
   * Tri-state answer. `unknown` means the server could not resolve this
   * pubkey (pantry outage, timeout, credential problem) — `active` is still
   * false so legacy boolean consumers keep treating the pubkey as a
   * non-member, but nothing that pitches membership may fire on it.
   */
  state: MembershipState;
  /** Legacy alias of `state === 'unknown'`, kept for existing consumers. */
  unresolved?: true;
  /** When this answer was written (ms epoch); drives the TTLs below. */
  checkedAt: number;
}

type MembershipResponse = Record<
  string,
  { active?: boolean; state?: string; tier?: string; expiresAt?: string }
>;

const BATCH_DEBOUNCE_MS = 75;
const MAX_BATCH_SIZE = 200;

/**
 * How long an answer is trusted before it is asked again. A confirmed member
 * stays a member for a while; a "not a member" is re-asked soon (it is also
 * what a brief pantry hiccup used to look like, and a payment may have landed);
 * an unknown is retried quickly. Stale entries keep serving their last value
 * until the new answer lands — a refresh never downgrades anyone to unknown.
 */
export const TTL_MS: Record<MembershipState, number> = {
  active: 10 * 60_000,
  inactive: 60_000,
  unknown: 30_000
};

import { UNRESOLVED_HEADER } from '$lib/membership/contract';
export { UNRESOLVED_HEADER };

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

function unknownPlaceholder(now = Date.now()): MembershipStatus {
  return { active: false, tier: 'unknown', state: 'unknown', unresolved: true, checkedAt: now };
}

/**
 * An unresolved answer never replaces a resolved one: the previous value
 * (member or not) is kept and only its clock is reset so it is retried on the
 * unknown TTL. With no previous value, the unknown placeholder is written so
 * consumers can tell "not asked yet" from "asked, no answer".
 */
function markUnresolved(pubkey: string, now = Date.now()): void {
  const prev = statusCache.get(pubkey);
  if (prev && prev.state !== 'unknown') {
    updateStore(pubkey, { ...prev, checkedAt: now - TTL_MS[prev.state] + TTL_MS.unknown });
    return;
  }
  updateStore(pubkey, unknownPlaceholder(now));
}

function normalizeStatus(
  raw: { active?: boolean; state?: string; tier?: string; expiresAt?: string },
  now = Date.now()
): MembershipStatus {
  const active = raw?.active === true;
  return {
    active,
    tier: normalizeTier(raw?.tier),
    expiresAt: raw?.expiresAt,
    state: active ? 'active' : 'inactive',
    checkedAt: now
  };
}

function isFresh(status: MembershipStatus | undefined, now = Date.now()): boolean {
  if (!status) return false;
  return now - status.checkedAt < TTL_MS[status.state];
}

function parseUnresolvedHeader(res: Response): Set<string> {
  const raw = res.headers?.get?.(UNRESOLVED_HEADER) || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[a-f0-9]{64}$/.test(s))
  );
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
    const unresolved = parseUnresolvedHeader(res);
    const now = Date.now();
    for (const pubkey of requested) {
      if (superseded(pubkey)) continue;
      const raw = payload?.[pubkey];
      if (raw && typeof raw.active === 'boolean') {
        updateStore(pubkey, normalizeStatus(raw, now));
      } else {
        // Omitted from the map (and listed in the header, or simply absent):
        // the server could not answer. That is NOT "not a member".
        if (!unresolved.has(pubkey)) {
          console.warn('[membershipStatus] No answer for pubkey in payload:', pubkey);
        }
        markUnresolved(pubkey, now);
      }
    }
  } catch (error) {
    console.warn('[membershipStatus] Batch fetch failed:', error);
    const now = Date.now();
    for (const pubkey of requested) {
      if (superseded(pubkey)) continue;
      markUnresolved(pubkey, now);
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
  if (inFlight.has(normalized)) return;
  if (isFresh(statusCache.get(normalized))) return;
  queued.add(normalized);
  scheduleFlush();
}

/**
 * Re-ask for everything whose answer is stale or unknown. Wired to the tab
 * becoming visible and the browser coming back online, so a member who hit a
 * pantry hiccup is not stuck with a non-member screen until a reload.
 */
export function revalidateMembership(): void {
  if (!browser) return;
  const now = Date.now();
  for (const [pubkey, status] of statusCache) {
    if (!isFresh(status, now) && !inFlight.has(pubkey)) queued.add(pubkey);
  }
  if (queued.size > 0) scheduleFlush();
}

if (browser && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidateMembership();
  });
  window.addEventListener('online', revalidateMembership);
}

/**
 * Force a fresh lookup for one pubkey, ignoring anything already cached.
 *
 * `queueMembershipLookup` and `getMembership` both return early on a fresh
 * cached pubkey. Call this once after a payment is confirmed; every consumer
 * reads `membershipStatusMap`, so the one write reaches all of them.
 *
 * Deliberately NOT wired into the debounced queue: this is a single known
 * pubkey at a known moment, not feed traffic, so it does not reintroduce the
 * per-avatar request storm that took `getMembership` out of `Avatar.svelte`.
 * Callers must keep it that way — one call per completed payment.
 *
 * Never rejects: a failed lookup is swallowed by `fetchBatch`. A previous
 * value is kept (its clock reset); with no previous value the unknown
 * placeholder is written. Callers can await without risking the page.
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
    return Object.fromEntries(normalized.map((pk) => [pk, unknownPlaceholder()]));
  }

  const missing = normalized.filter((pk) => !isFresh(statusCache.get(pk)) && !inFlight.has(pk));
  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += MAX_BATCH_SIZE) {
      await fetchBatch(missing.slice(i, i + MAX_BATCH_SIZE));
    }
  }

  const result: Record<string, MembershipStatus> = {};
  for (const pubkey of normalized) {
    result[pubkey] = statusCache.get(pubkey) || unknownPlaceholder();
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
