/**
 * Tests for the friendly anonymous-author name generator.
 *
 * Stability is the contract: the same pubkey must always produce the
 * same name across renders and sessions. If the pool is reordered the
 * mapping will shift, which is fine (the names are decorative), but
 * the per-pubkey determinism within a single deploy is what consumers
 * lean on for "user navigated away and came back, name should match".
 */

import { describe, it, expect } from 'vitest';
import { ANON_COOK_NAME_POOL, getAnonChefName } from './anonName';

const SAMPLE_PUBKEY_A = 'a'.repeat(64);
const SAMPLE_PUBKEY_B = 'b'.repeat(64);
const REAL_LOOKING_PUBKEY =
  '3ad2acd0e83712cffe51ef96e0db74dafd0e2cabb6d28a82d7e5b62b59f5c4d3';

describe('getAnonChefName', () => {
  it('returns the generic fallback for null / undefined / empty', () => {
    expect(getAnonChefName(null)).toBe('Anon Chef');
    expect(getAnonChefName(undefined)).toBe('Anon Chef');
    expect(getAnonChefName('')).toBe('Anon Chef');
  });

  it('returns a name from the pool for any non-empty pubkey', () => {
    const name = getAnonChefName(SAMPLE_PUBKEY_A);
    expect(ANON_COOK_NAME_POOL).toContain(name);
  });

  it('is deterministic per pubkey across multiple calls', () => {
    const first = getAnonChefName(SAMPLE_PUBKEY_A);
    const second = getAnonChefName(SAMPLE_PUBKEY_A);
    const third = getAnonChefName(SAMPLE_PUBKEY_A);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('produces different names for different pubkeys (probabilistic, but trivially holds for these two)', () => {
    // With a 33-entry pool, the odds of two arbitrary inputs colliding
    // are 1/33; these specific inputs hash to different slots.
    expect(getAnonChefName(SAMPLE_PUBKEY_A)).not.toBe(getAnonChefName(SAMPLE_PUBKEY_B));
  });

  it('handles real-looking 64-char hex pubkeys', () => {
    const name = getAnonChefName(REAL_LOOKING_PUBKEY);
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
    expect(ANON_COOK_NAME_POOL).toContain(name);
  });
});

describe('ANON_COOK_NAME_POOL', () => {
  it('contains the user-requested signature names', () => {
    expect(ANON_COOK_NAME_POOL).toContain('Nostrich');
    expect(ANON_COOK_NAME_POOL).toContain('Anon Chef');
    expect(ANON_COOK_NAME_POOL).toContain('Zap Cooking Helper');
  });

  it('has no duplicates (otherwise hash distribution biases)', () => {
    const set = new Set(ANON_COOK_NAME_POOL);
    expect(set.size).toBe(ANON_COOK_NAME_POOL.length);
  });

  it('every entry is a non-empty string', () => {
    for (const name of ANON_COOK_NAME_POOL) {
      expect(typeof name).toBe('string');
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });

  it('covers a sensibly large slice of the pool when sampled across many pubkeys', () => {
    // Sample 200 pubkey-shaped inputs; with a 33-entry pool we should
    // hit a healthy fraction of distinct entries even via simple hash.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const fakePubkey = i.toString(16).padStart(64, '0');
      seen.add(getAnonChefName(fakePubkey));
    }
    // With 200 samples and 33 pool entries, we expect to cover most of
    // the pool. Threshold leaves a margin for hash bunching.
    expect(seen.size).toBeGreaterThan(ANON_COOK_NAME_POOL.length * 0.5);
  });
});
