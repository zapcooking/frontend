import { describe, it, expect } from 'vitest';
import {
  HIDDEN_RECIPE_COORDINATES,
  isHiddenRecipeCoordinate,
  isHiddenRecipeEvent,
  isHiddenRecipeATag
} from './consts';

const LISTED = '30023:8b739c62ed2a9b76c2836a18a6bc9a480b6f8d902b8f702083dfae20bf6b15b9:zc-pr11-test-bravo';
const [LISTED_KIND, LISTED_PUBKEY, LISTED_DTAG] = [30023, LISTED.split(':')[1], 'zc-pr11-test-bravo'];

describe('isHiddenRecipeCoordinate', () => {
  it('hides exact listed coordinates', () => {
    expect(isHiddenRecipeCoordinate(LISTED_KIND, LISTED_PUBKEY, LISTED_DTAG)).toBe(true);
  });

  it('hides every coordinate on the exact list', () => {
    for (const coord of HIDDEN_RECIPE_COORDINATES) {
      const [kind, pubkey, ...d] = coord.split(':');
      expect(isHiddenRecipeCoordinate(Number(kind), pubkey, d.join(':'))).toBe(true);
    }
  });

  it('hides any pubkey whose d-tag matches a listed prefix', () => {
    expect(isHiddenRecipeCoordinate(30023, 'f'.repeat(64), 'ios-2.3-live-publish-0001')).toBe(true);
    expect(isHiddenRecipeCoordinate(30023, 'a'.repeat(64), 'ios-2.3-live-publish-')).toBe(true);
    // premium recipe kind is prefix-matched too
    expect(isHiddenRecipeCoordinate(35000, 'f'.repeat(64), 'ios-2.3-live-publish-1')).toBe(true);
  });

  it('limits prefix matching to recipe kinds', () => {
    // a kind-30001 cookbook list with a colliding d-tag is not swallowed
    expect(isHiddenRecipeCoordinate(30001, 'f'.repeat(64), 'ios-2.3-live-publish-1')).toBe(false);
    expect(isHiddenRecipeCoordinate(30078, 'f'.repeat(64), 'ios-2.3-live-publish-1')).toBe(false);
  });

  it('does not hide normal recipes', () => {
    expect(isHiddenRecipeCoordinate(30023, 'f'.repeat(64), 'grandmas-lasagna')).toBe(false);
    // prefix must match the start, not the middle
    expect(isHiddenRecipeCoordinate(30023, 'f'.repeat(64), 'my-ios-2.3-live-publish-copy')).toBe(
      false
    );
  });

  it('does not hide a listed d-tag under a different pubkey unless prefix-matched', () => {
    expect(isHiddenRecipeCoordinate(30023, 'f'.repeat(64), LISTED_DTAG)).toBe(false);
  });

  it('returns false for missing parts', () => {
    expect(isHiddenRecipeCoordinate(null, LISTED_PUBKEY, LISTED_DTAG)).toBe(false);
    expect(isHiddenRecipeCoordinate(LISTED_KIND, '', LISTED_DTAG)).toBe(false);
    expect(isHiddenRecipeCoordinate(LISTED_KIND, LISTED_PUBKEY, null)).toBe(false);
  });
});

describe('isHiddenRecipeEvent', () => {
  it('hides an event with a prefix-matched d-tag', () => {
    expect(
      isHiddenRecipeEvent({
        kind: 30023,
        pubkey: 'f'.repeat(64),
        tags: [['d', 'ios-2.3-live-publish-42'], ['title', 'junk']]
      })
    ).toBe(true);
  });

  it('does not hide a normal event', () => {
    expect(
      isHiddenRecipeEvent({ kind: 30023, pubkey: 'f'.repeat(64), tags: [['d', 'real-recipe']] })
    ).toBe(false);
  });

  it('does not hide an event without a d tag', () => {
    expect(isHiddenRecipeEvent({ kind: 30023, pubkey: 'f'.repeat(64), tags: [] })).toBe(false);
  });
});

describe('isHiddenRecipeATag', () => {
  it('hides exact listed a-tags', () => {
    expect(isHiddenRecipeATag(LISTED)).toBe(true);
  });

  it('hides prefix-matched a-tags', () => {
    expect(isHiddenRecipeATag(`30023:${'f'.repeat(64)}:ios-2.3-live-publish-9`)).toBe(true);
  });

  it('handles d-tags containing colons', () => {
    expect(isHiddenRecipeATag(`30023:${'f'.repeat(64)}:ios-2.3-live-publish-a:b`)).toBe(true);
  });

  it('does not hide normal a-tags or malformed input', () => {
    expect(isHiddenRecipeATag(`30023:${'f'.repeat(64)}:grandmas-lasagna`)).toBe(false);
    expect(isHiddenRecipeATag('')).toBe(false);
    expect(isHiddenRecipeATag(null)).toBe(false);
    expect(isHiddenRecipeATag('not-a-coordinate')).toBe(false);
  });
});
