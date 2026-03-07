/**
 * Sponsor pricing constants — shared between client and server.
 *
 * This is the SINGLE source of truth for sponsor tiers, durations, and prices.
 * The server (sponsorStore.server.ts) imports this for activation logic.
 * The client (sponsors/+page.svelte) imports this for UI display.
 */

export type SponsorTier = 'headline' | 'kitchen_card';
export type SponsorDurationKey = '24h' | '3d' | '7d' | '14d' | '30d';

export const SPONSOR_DURATION_KEYS: SponsorDurationKey[] = ['24h', '3d', '7d', '14d', '30d'];

export const SPONSOR_TIERS: { key: SponsorTier; label: string; description: string }[] = [
  { key: 'headline', label: 'Headline Banner', description: 'Full-width banner on the homepage' },
  { key: 'kitchen_card', label: 'Kitchen Card', description: 'Card injected into the social feed' },
];

export const SPONSOR_PRICING: Record<SponsorTier, Record<SponsorDurationKey, { sats: number; durationMs: number; label: string }>> = {
  headline: {
    '24h': { sats: 5000, durationMs: 86400000, label: '24 Hours' },
    '3d':  { sats: 12500, durationMs: 259200000, label: '3 Days' },
    '7d':  { sats: 25000, durationMs: 604800000, label: '7 Days' },
    '14d': { sats: 42500, durationMs: 1209600000, label: '14 Days' },
    '30d': { sats: 75000, durationMs: 2592000000, label: '30 Days' },
  },
  kitchen_card: {
    '24h': { sats: 2500, durationMs: 86400000, label: '24 Hours' },
    '3d':  { sats: 6000, durationMs: 259200000, label: '3 Days' },
    '7d':  { sats: 12500, durationMs: 604800000, label: '7 Days' },
    '14d': { sats: 21000, durationMs: 1209600000, label: '14 Days' },
    '30d': { sats: 37500, durationMs: 2592000000, label: '30 Days' },
  },
};
