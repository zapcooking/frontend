/**
 * Boost pricing constants — shared between client and server.
 *
 * This is the SINGLE source of truth for boost durations and prices.
 * The server (boostStore.server.ts) imports this for activation logic.
 * The client (boost/+page.svelte) imports this for UI display.
 */

export type BoostDurationKey = '24h' | '7d' | '30d';

export const BOOST_DURATION_KEYS: BoostDurationKey[] = ['24h', '7d', '30d'];

export const BOOST_PRICING: Record<BoostDurationKey, { sats: number; durationMs: number; label: string }> = {
  '24h': { sats: 1000, durationMs: 24 * 60 * 60 * 1000, label: '24 Hours' },
  '7d':  { sats: 5000, durationMs: 7 * 24 * 60 * 60 * 1000, label: '7 Days' },
  '30d': { sats: 15000, durationMs: 30 * 24 * 60 * 60 * 1000, label: '30 Days' },
};
