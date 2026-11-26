import { describe, expect, it } from 'vitest';
import { DISCOVERY_EXCLUSIONS } from './config';
import {
  DISCOVERY_EXCLUDED_PUBKEYS,
  canonicalPubkey,
  exclusionSet,
  isDiscoveryExcluded
} from './exclusion';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('the configured list', () => {
  it('holds only canonical pubkeys, each with a reason and a date', () => {
    for (const entry of DISCOVERY_EXCLUSIONS) {
      expect(entry.pubkey).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.reason.trim().length).toBeGreaterThan(10);
      expect(entry.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(DISCOVERY_EXCLUDED_PUBKEYS.size).toBe(DISCOVERY_EXCLUSIONS.length);
  });

  it('is what the default check reads', () => {
    for (const entry of DISCOVERY_EXCLUSIONS) expect(isDiscoveryExcluded(entry.pubkey)).toBe(true);
    expect(isDiscoveryExcluded(A)).toBe(false);
  });
});

describe('isDiscoveryExcluded', () => {
  const excluded = exclusionSet([{ pubkey: A }]);

  it('matches the canonical pubkey, whatever its case or padding', () => {
    expect(isDiscoveryExcluded(A, excluded)).toBe(true);
    expect(isDiscoveryExcluded(A.toUpperCase(), excluded)).toBe(true);
    expect(isDiscoveryExcluded(`  ${A}\n`, excluded)).toBe(true);
    expect(isDiscoveryExcluded(B, excluded)).toBe(false);
  });

  it('never matches a name, an npub or a missing author', () => {
    for (const notAKey of [
      'NYT Cooking',
      'npub1ufmpper5zn5peh7pztseatd5uccylsxtphakkjlwqpsua5tfd86spdlm32',
      '',
      null,
      undefined
    ]) {
      expect(isDiscoveryExcluded(notAKey, excluded)).toBe(false);
    }
  });

  it('ignores a list entry that is not a pubkey', () => {
    const set = exclusionSet([
      { pubkey: 'NYT Cooking' },
      { pubkey: A.slice(1) },
      { pubkey: B.toUpperCase() }
    ]);
    expect([...set]).toEqual([B]);
    expect(canonicalPubkey('NYT Cooking')).toBeNull();
  });

  it('restores the author when the entry is removed', () => {
    expect(isDiscoveryExcluded(A, exclusionSet([{ pubkey: A }, { pubkey: B }]))).toBe(true);
    expect(isDiscoveryExcluded(A, exclusionSet([{ pubkey: B }]))).toBe(false);
    expect(isDiscoveryExcluded(A, exclusionSet([]))).toBe(false);
  });
});
