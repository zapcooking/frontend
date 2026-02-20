import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { NDKRelaySet } from '@nostr-dev-kit/ndk';

// ── Types ────────────────────────────────────────────────────────

export type WarmthLevel = 'cold' | 'warm' | 'hot';

export interface WarmthStatus {
  level: WarmthLevel;
  rank: number; // 0-100 normalized
}

// ── Constants ────────────────────────────────────────────────────

const NIP85_KIND = 30382;
const NIP85_RELAY = 'wss://nip85.nostr.band';

const BATCH_DEBOUNCE_MS = 150;
const MAX_BATCH_SIZE = 50;

const CACHE_KEY = 'zc_warmth_v1';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Rank thresholds for warmth levels
const WARM_THRESHOLD = 15;
const HOT_THRESHOLD = 50;

// ── State ────────────────────────────────────────────────────────

const statusCache = new Map<string, WarmthStatus>();
const inFlight = new Set<string>();
const queued = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const mapStore = writable<Record<string, WarmthStatus>>({});
export const warmthStatusMap = { subscribe: mapStore.subscribe };

// ── localStorage cache ───────────────────────────────────────────

interface CachedWarmthData {
  entries: Record<string, WarmthStatus>;
  timestamp: number;
}

function loadCache(): void {
  if (!browser) return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;

    const data: CachedWarmthData = JSON.parse(raw);
    if (Date.now() - data.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return;
    }

    for (const [pubkey, status] of Object.entries(data.entries)) {
      statusCache.set(pubkey, status);
    }
    if (statusCache.size > 0) {
      mapStore.set(Object.fromEntries(statusCache));
    }
  } catch {
    // Corrupted cache, ignore
  }
}

function saveCache(): void {
  if (!browser) return;
  try {
    const data: CachedWarmthData = {
      entries: Object.fromEntries(statusCache),
      timestamp: Date.now()
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable
  }
}

// Initialize from cache on module load
loadCache();

// ── Rank → Warmth ────────────────────────────────────────────────

function rankToWarmth(rank: number): WarmthLevel {
  if (rank >= HOT_THRESHOLD) return 'hot';
  if (rank >= WARM_THRESHOLD) return 'warm';
  return 'cold';
}

// ── Store helpers ────────────────────────────────────────────────

function updateStore(pubkey: string, status: WarmthStatus): void {
  statusCache.set(pubkey, status);
  mapStore.update((current) => ({ ...current, [pubkey]: status }));
}

function normalizePubkey(pubkey: string | null | undefined): string | null {
  if (!pubkey) return null;
  const normalized = String(pubkey).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  return normalized;
}

// ── NIP-85 fetch ─────────────────────────────────────────────────

async function fetchBatch(pubkeys: string[]): Promise<void> {
  if (!browser || pubkeys.length === 0) return;

  const requested = [...new Set(pubkeys)];
  requested.forEach((pk) => inFlight.add(pk));

  try {
    const ndkInstance = get(ndk);
    if (!ndkInstance) {
      throw new Error('NDK not available');
    }

    const relaySet = NDKRelaySet.fromRelayUrls([NIP85_RELAY], ndkInstance, true);

    const filter = {
      kinds: [NIP85_KIND as number],
      '#d': requested
    };

    const events = await ndkInstance.fetchEvents(filter, undefined, relaySet);

    // Build a map of pubkey → best event (highest rank or most recent)
    const bestEvents = new Map<string, { rank: number }>();

    for (const event of events) {
      const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
      if (!dTag || !requested.includes(dTag)) continue;

      const rankTag = event.tags.find((t) => t[0] === 'rank')?.[1];
      const rank = rankTag ? parseInt(rankTag, 10) : 0;
      if (isNaN(rank)) continue;

      const existing = bestEvents.get(dTag);
      if (!existing || rank > existing.rank) {
        bestEvents.set(dTag, { rank: Math.max(0, Math.min(100, rank)) });
      }
    }

    for (const pubkey of requested) {
      const data = bestEvents.get(pubkey);
      if (data) {
        updateStore(pubkey, { level: rankToWarmth(data.rank), rank: data.rank });
      } else {
        updateStore(pubkey, { level: 'cold', rank: 0 });
      }
    }

    saveCache();
  } catch (error) {
    console.warn('[warmthStatus] Batch fetch failed:', error);
    for (const pubkey of requested) {
      if (!statusCache.has(pubkey)) {
        updateStore(pubkey, { level: 'cold', rank: 0 });
      }
    }
  } finally {
    requested.forEach((pk) => inFlight.delete(pk));
  }
}

// ── Queue / flush ────────────────────────────────────────────────

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

export function queueWarmthLookup(pubkey: string | null | undefined): void {
  if (!browser) return;
  const normalized = normalizePubkey(pubkey);
  if (!normalized) return;
  if (statusCache.has(normalized) || inFlight.has(normalized)) return;
  queued.add(normalized);
  scheduleFlush();
}

// ── Public getters ───────────────────────────────────────────────

export function getWarmthLevel(pubkey: string | null | undefined): WarmthLevel {
  if (!pubkey) return 'cold';
  const normalized = normalizePubkey(pubkey);
  if (!normalized) return 'cold';
  return statusCache.get(normalized)?.level ?? 'cold';
}

export function getWarmthBorderColor(level: WarmthLevel): string {
  switch (level) {
    case 'hot':
      return 'rgba(236, 71, 0, 0.7)';    // brand orange
    case 'warm':
      return 'rgba(245, 158, 66, 0.45)';  // soft amber
    case 'cold':
    default:
      return '';                            // no override — use default border
  }
}
