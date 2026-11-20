import { describe, it, expect, vi, afterEach } from 'vitest';
import { PUBLISH_RETRY_DELAYS_MS, publishWithRetry } from './publishRetry';

afterEach(() => vi.useRealTimers());

describe('publishWithRetry', () => {
  it('publishes once when the first try is accepted', async () => {
    const publish = vi.fn().mockResolvedValue(new Set(['relay']));
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(await publishWithRetry(publish, { wait })).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('tries the same publish again after a failure, waiting in between', async () => {
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error('no relay accepted'))
      .mockResolvedValue(new Set(['relay']));
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(await publishWithRetry(publish, { wait })).toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(wait.mock.calls).toEqual([[PUBLISH_RETRY_DELAYS_MS[0]]]);
  });

  it('stops after two retries and reports failure without throwing', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('down'));
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(await publishWithRetry(publish, { wait })).toBe(0);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual(PUBLISH_RETRY_DELAYS_MS.map((ms) => [ms]));
  });

  it('counts a try that never answers as failed, and moves on', async () => {
    vi.useFakeTimers();
    const publish = vi
      .fn()
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValue(new Set(['relay']));
    const done = publishWithRetry(publish, { timeoutMs: 1000, delaysMs: [50] });
    await vi.advanceTimersByTimeAsync(999);
    expect(publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 + 50);
    expect(await done).toBe(2);
  });

  it('a publish that throws at once is a failed try too', async () => {
    const publish = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('not connected');
      })
      .mockResolvedValue(1);
    expect(await publishWithRetry(publish, { wait: async () => undefined })).toBe(2);
  });
});
