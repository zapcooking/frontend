import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeTier, tierLabel, resetTierWarningsForTests, isKnownTier } from './tier';

/**
 * Tiers are backend-managed. `lifetime` is its own tier; an unknown tier is
 * logged and passed through, never collapsed (the four old normalizers
 * mapped it to 'member', 'open', 'unknown' and — in Settings — 'cook_plus').
 */
beforeEach(() => {
  resetTierWarningsForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('normalizeTier', () => {
  it('recognises lifetime and passes it through unchanged', () => {
    expect(normalizeTier('lifetime')).toBe('lifetime');
    expect(normalizeTier(' Lifetime ')).toBe('lifetime');
    expect(isKnownTier('lifetime')).toBe(true);
  });

  it('passes an unknown tier through as sent and logs it once', () => {
    expect(normalizeTier('patron')).toBe('patron');
    expect(normalizeTier('Patron')).toBe('patron');
    expect(normalizeTier('patron', null, 'open')).toBe('patron');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the known spellings', () => {
    expect(normalizeTier('cook-plus')).toBe('cook_plus');
    expect(normalizeTier('Pro Kitchen')).toBe('pro_kitchen');
    expect(normalizeTier('genesis_founder')).toBe('founders');
    expect(normalizeTier('standard', 'genesis_12')).toBe('founders');
    expect(normalizeTier('member')).toBe('member');
  });

  it("an empty tier is the caller's fallback", () => {
    expect(normalizeTier('')).toBe('member');
    expect(normalizeTier(undefined, null, 'open')).toBe('open');
    expect(normalizeTier(null, null, 'unknown')).toBe('unknown');
  });
});

describe('tierLabel', () => {
  it('names lifetime and shows an unknown tier as sent', () => {
    expect(tierLabel('lifetime')).toBe('Lifetime');
    expect(tierLabel('patron_plus')).toBe('Patron Plus');
    expect(tierLabel('cook_plus')).toBe('Cook+');
    expect(tierLabel(undefined)).toBe('Not a member');
  });
});
