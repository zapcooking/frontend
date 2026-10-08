import { describe, it, expect } from 'vitest';
import { needsFullReload } from './refreshTop';

const at = (t: number) => ({ created_at: t });

describe('needsFullReload', () => {
  it('prepends when the newer posts reach back to the top', () => {
    expect(needsFullReload([at(500), at(450)], 30, 400)).toBe(false);
    expect(needsFullReload([], 30, 400)).toBe(false);
  });

  it('prepends a full page that overlaps the top', () => {
    const page = Array.from({ length: 30 }, (_, i) => at(1000 - i * 10));
    expect(needsFullReload(page, 30, 800)).toBe(false);
  });

  it('reloads when a full page of newer posts leaves a hole', () => {
    const page = Array.from({ length: 30 }, (_, i) => at(1000 - i));
    expect(needsFullReload(page, 30, 100)).toBe(true);
  });

  it('reloads an empty feed', () => {
    expect(needsFullReload([at(1)], 30, null)).toBe(true);
  });
});
