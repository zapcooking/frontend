import { describe, it, expect } from 'vitest';
import { MAX_LINK_HEADER_BYTES, splitLinkHeader, trimLinkHeader } from './linkHeader';

function makeHeader(n: number): string {
  return Array.from(
    { length: n },
    (_, i) => `<./_app/immutable/chunks/chunk${i}.js>; rel="modulepreload"; nopush`
  ).join(', ');
}

describe('trimLinkHeader', () => {
  it('leaves a header under the budget untouched', () => {
    const h = makeHeader(10);
    expect(trimLinkHeader(h)).toBe(h);
  });

  it('caps an oversized header (the ~190-entry note page) under the budget', () => {
    const h = makeHeader(190);
    expect(h.length).toBeGreaterThan(MAX_LINK_HEADER_BYTES);
    const out = trimLinkHeader(h);
    expect(out.length).toBeLessThanOrEqual(MAX_LINK_HEADER_BYTES);
  });

  it('keeps whole entries, in order, never cutting one mid-way', () => {
    const h = makeHeader(190);
    const out = splitLinkHeader(trimLinkHeader(h));
    const all = splitLinkHeader(h);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toEqual(all.slice(0, out.length));
    for (const entry of out) expect(entry).toMatch(/^<[^>]+>; rel="modulepreload"; nopush$/);
  });

  it('honors a custom budget and handles an empty value', () => {
    expect(trimLinkHeader(makeHeader(50), 300).length).toBeLessThanOrEqual(300);
    expect(trimLinkHeader('')).toBe('');
  });
});
