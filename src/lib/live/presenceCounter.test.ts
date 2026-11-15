import { describe, it, expect } from 'vitest';
import { PresenceCounter, isHeartbeatCode, type PresenceLimits } from './presenceCounter';

const code = (n: number) => n.toString(16).padStart(32, '0');
const LIMITS: PresenceLimits = {
  windowMs: 60_000,
  beatsPerWindow: 60,
  newCodesPerWindow: 20,
  maxCodes: 10_000
};

describe('PresenceCounter', () => {
  it('counts distinct codes, and a repeat beat is the same viewer', () => {
    const c = new PresenceCounter(LIMITS);
    expect(c.beat(code(1), 'a', 0)).toEqual({ ok: true, watching: 1, peak: 1, newPeak: true });
    expect(c.beat(code(1), 'a', 30_000)).toEqual({
      ok: true,
      watching: 1,
      peak: 1,
      newPeak: false
    });
    expect(c.beat(code(2), 'b', 30_000)).toMatchObject({ watching: 2, newPeak: true });
    expect(c.watching(30_000)).toBe(2);
  });

  it('drops a code that has not been heard for 60 s, and keeps the peak', () => {
    const c = new PresenceCounter(LIMITS);
    c.beat(code(1), 'a', 0);
    c.beat(code(2), 'b', 10_000);
    expect(c.watching(59_999)).toBe(2);
    expect(c.watching(60_000)).toBe(1);
    expect(c.watching(70_000)).toBe(0);
    expect(c.beat(code(3), 'c', 70_000)).toEqual({
      ok: true,
      watching: 1,
      peak: 2,
      newPeak: false
    });
  });

  it('rate limits beats per source per window', () => {
    const c = new PresenceCounter({ ...LIMITS, beatsPerWindow: 3 });
    for (let i = 0; i < 3; i++) expect(c.beat(code(1), 'a', i).ok).toBe(true);
    expect(c.beat(code(1), 'a', 10)).toEqual({ ok: false, reason: 'rate_limited' });
    // Another source is not affected.
    expect(c.beat(code(2), 'b', 10).ok).toBe(true);
    // A new window resets the source.
    expect(c.beat(code(1), 'a', 60_000).ok).toBe(true);
  });

  it('limits how many new codes one source can add, without linking codes to it', () => {
    const c = new PresenceCounter({ ...LIMITS, newCodesPerWindow: 2 });
    expect(c.beat(code(1), 'a', 0).ok).toBe(true);
    expect(c.beat(code(2), 'a', 0).ok).toBe(true);
    expect(c.beat(code(3), 'a', 0)).toEqual({ ok: false, reason: 'rate_limited' });
    // Known codes from that source still refresh.
    expect(c.beat(code(1), 'a', 1000).ok).toBe(true);
    expect(c.watching(1000)).toBe(2);
  });

  it('stops adding codes at maxCodes but still answers', () => {
    const c = new PresenceCounter({ ...LIMITS, maxCodes: 2 });
    c.beat(code(1), 'a', 0);
    c.beat(code(2), 'b', 0);
    expect(c.beat(code(3), 'c', 0)).toEqual({ ok: true, watching: 2, peak: 2, newPeak: false });
    expect(c.watching(0)).toBe(2);
  });

  it('accepts only 32 lowercase hex codes', () => {
    expect(isHeartbeatCode(code(1))).toBe(true);
    expect(isHeartbeatCode('A'.repeat(32))).toBe(false);
    expect(isHeartbeatCode('a'.repeat(31))).toBe(false);
    expect(isHeartbeatCode(42)).toBe(false);
  });
});

describe('PresenceCounter expiry boundary (review)', () => {
  it('never counts an expired code, even right after a read', () => {
    const c = new PresenceCounter(LIMITS);
    c.beat(code(1), 'a', 0);
    expect(c.watching(59_999)).toBe(1);
    // code(1) expires at 60 000: a different code arriving then is alone.
    expect(c.beat(code(2), 'b', 60_000)).toEqual({
      ok: true,
      watching: 1,
      peak: 1,
      newPeak: false
    });
  });

  it('does not let expired codes block new ones at maxCodes', () => {
    const c = new PresenceCounter({ ...LIMITS, maxCodes: 1 });
    c.beat(code(1), 'a', 0);
    c.beat(code(2), 'b', 60_000);
    expect(c.has(code(2))).toBe(true);
  });
});
