import { describe, it, expect } from 'vitest';
import { parseCoordinate, formatCoordinate, newRecipeIdentifier, coordinateAsWritten } from './coordinate';
import vectors from '../test/fixtures/coordinate.vectors.json';

describe('parseCoordinate (shared vectors)', () => {
  for (const v of vectors.parse) {
    it(v.id, () => {
      expect(parseCoordinate(v.input)).toEqual(v.expected);
    });
  }

  it('round-trips through formatCoordinate', () => {
    for (const v of vectors.parse) {
      const c = parseCoordinate(v.input);
      if (c) expect(formatCoordinate(c)).toBe(v.input);
    }
  });

  it('rejects non-strings', () => {
    expect(parseCoordinate(undefined)).toBeNull();
    expect(parseCoordinate(30023)).toBeNull();
    expect(parseCoordinate(['30023'])).toBeNull();
  });
});

describe('newRecipeIdentifier (shared vectors)', () => {
  for (const v of vectors.newRecipeIdentifier) {
    it(v.id, () => {
      expect(newRecipeIdentifier(v.title)).toBe(v.expected);
    });
  }
});

describe('coordinateAsWritten', () => {
  const P = 'ab'.repeat(32);
  it('keeps an existing entry\'s spelling (an naddr round trip lower-cases the pubkey)', () => {
    const upper = `30023:${P.toUpperCase()}:pasta:-weeknight`;
    expect(coordinateAsWritten({ kind: 30023, pubkey: P, identifier: 'pasta:-weeknight' }, ['x', upper])).toBe(upper);
  });
  it('the canonical form when no entry matches', () => {
    expect(coordinateAsWritten({ kind: 30023, pubkey: P, identifier: 'new' }, [`30023:${P}:other`])).toBe(`30023:${P}:new`);
  });
  it('kind and identifier must match exactly', () => {
    expect(coordinateAsWritten({ kind: 30023, pubkey: P, identifier: 'A' }, [`30023:${P}:a`])).toBe(`30023:${P}:A`);
    expect(coordinateAsWritten({ kind: 30024, pubkey: P, identifier: 'a' }, [`30023:${P}:a`])).toBe(`30024:${P}:a`);
  });
});
