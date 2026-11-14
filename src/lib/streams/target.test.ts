import { describe, it, expect } from 'vitest';
import { isEventTarget, targetFilter, targetTag } from './target';

describe('stream targets', () => {
  const NOTE = 'a'.repeat(64);
  const ADDRESS = `30311:${'b'.repeat(64)}:show`;

  it('tells a note id from a stream address', () => {
    expect(isEventTarget(NOTE)).toBe(true);
    expect(isEventTarget(ADDRESS)).toBe(false);
    expect(isEventTarget('A'.repeat(64))).toBe(false);
    expect(isEventTarget(null)).toBe(false);
    expect(targetTag(NOTE)).toBe('e');
    expect(targetTag(ADDRESS)).toBe('a');
  });

  it('builds the relay filter fragment', () => {
    expect(targetFilter(NOTE)).toEqual({ '#e': [NOTE] });
    expect(targetFilter(ADDRESS)).toEqual({ '#a': [ADDRESS] });
  });
});
