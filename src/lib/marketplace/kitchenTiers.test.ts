import { describe, it, expect } from 'vitest';
import { KITCHEN_MEMBER_TIERS, MEMBER_TIER_BOOST } from './types';
import { KNOWN_TIERS } from '$lib/membership/tier';

/**
 * The marketplace's member-tier list: every paid tier the app knows (A4:
 * `lifetime` is its own tier, passed through) shows a badge and gets a
 * sorting boost; a tier in the list without a boost would sort as if it
 * had none.
 */
describe('marketplace member tiers', () => {
  it('include lifetime alongside the other paid tiers', () => {
    expect(KITCHEN_MEMBER_TIERS).toContain('lifetime');
    expect(KITCHEN_MEMBER_TIERS).toContain('founders');
    expect(KITCHEN_MEMBER_TIERS).toContain('pro_kitchen');
    expect(KITCHEN_MEMBER_TIERS).toContain('cook_plus');
  });

  it('cover every tier the app knows', () => {
    for (const t of KNOWN_TIERS) expect(KITCHEN_MEMBER_TIERS).toContain(t);
  });

  it('every listed tier has a sorting boost', () => {
    for (const t of KITCHEN_MEMBER_TIERS) expect(MEMBER_TIER_BOOST[t]).toBeGreaterThan(0);
  });
});
