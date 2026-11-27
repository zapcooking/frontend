import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WATCH_SIGN_FAST_MS, WatchRepeatGate } from './watchRepeats';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe('WatchRepeatGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows repeats until told otherwise, and after fast signatures', async () => {
    const gate = new WatchRepeatGate();
    expect(gate.allows(A)).toBe(true);
    const signed = gate.timed(A, () => after(WATCH_SIGN_FAST_MS - 100, 'event'));
    await vi.advanceTimersByTimeAsync(WATCH_SIGN_FAST_MS - 100);
    expect(await signed).toBe('event');
    // Well past the limit: the timer of a finished signature never fires.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gate.allows(A)).toBe(true);
  });

  it('stops repeats once a signature has been pending longer than the limit', async () => {
    const gate = new WatchRepeatGate();
    const signed = gate.timed(A, () => after(60_000, 'event'));
    await vi.advanceTimersByTimeAsync(WATCH_SIGN_FAST_MS - 1);
    expect(gate.allows(A)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    // Still pending, already stopped.
    expect(gate.allows(A)).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    // The slow signature itself is still delivered.
    expect(await signed).toBe('event');
    expect(gate.allows(A)).toBe(false);
  });

  it('stops repeats when a signature fails, and passes the error on', async () => {
    const gate = new WatchRepeatGate();
    await expect(gate.timed(A, () => Promise.reject(new Error('declined')))).rejects.toThrow(
      'declined'
    );
    expect(gate.allows(A)).toBe(false);
  });

  it('is per stream: the next stream starts allowed', async () => {
    const gate = new WatchRepeatGate();
    await gate.timed(A, () => Promise.reject(new Error('declined'))).catch(() => undefined);
    expect(gate.allows(A)).toBe(false);
    expect(gate.allows(B)).toBe(true);
  });
});
