import { describe, it, expect } from 'vitest';
import { parseCoordinate, formatCoordinate } from './coordinate';
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
