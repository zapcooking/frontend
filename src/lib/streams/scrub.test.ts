import { describe, expect, it } from 'vitest';
import { clampSeek, formatClock, isSeekableDuration, percentOf } from './scrub';

describe('formatClock', () => {
  it('formats minutes and hours', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9.9)).toBe('0:09');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(3725)).toBe('1:02:05');
  });
  it('treats junk as zero', () => {
    expect(formatClock(NaN)).toBe('0:00');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(Infinity)).toBe('0:00');
  });
});

describe('isSeekableDuration', () => {
  it('accepts only finite positive durations (a live playlist reports Infinity)', () => {
    expect(isSeekableDuration(120)).toBe(true);
    expect(isSeekableDuration(Infinity)).toBe(false);
    expect(isSeekableDuration(NaN)).toBe(false);
    expect(isSeekableDuration(0)).toBe(false);
  });
});

describe('clampSeek / percentOf', () => {
  it('keeps the target inside the media', () => {
    expect(clampSeek(-3, 100)).toBe(0);
    expect(clampSeek(250, 100)).toBe(100);
    expect(clampSeek(42, 100)).toBe(42);
    expect(clampSeek(NaN, 100)).toBe(0);
  });
  it('computes the filled share of the track', () => {
    expect(percentOf(25, 100)).toBe(25);
    expect(percentOf(500, 100)).toBe(100);
    expect(percentOf(5, Infinity)).toBe(0);
  });
});
