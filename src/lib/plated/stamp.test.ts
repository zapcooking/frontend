import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLATED_STAMP_LOAD_MS, PLATED_STAMP_MS, platedStampPhoto, platedStampTimer } from './stamp';

describe('platedStampPhoto', () => {
  it("is the plate's first https image", () => {
    expect(
      platedStampPhoto({
        content: 'So good!\n\nhttps://image.nostr.build/a.jpg https://image.nostr.build/b.jpg'
      })
    ).toBe('https://image.nostr.build/a.jpg');
  });

  it('is null without a usable photo', () => {
    expect(platedStampPhoto(null)).toBeNull();
    expect(platedStampPhoto({ content: 'No photo here' })).toBeNull();
    expect(platedStampPhoto({ content: 'http://example.com/a.jpg' })).toBeNull();
  });
});

describe('platedStampTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays under 1.5 s on screen', () => {
    expect(PLATED_STAMP_MS).toBeLessThan(1500);
  });

  it('shows once the photo loads, then finishes', () => {
    const onShow = vi.fn();
    const onDone = vi.fn();
    const t = platedStampTimer(onShow, onDone);
    expect(onShow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    t.loaded();
    expect(onShow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PLATED_STAMP_MS - 1);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('never shows when the photo fails', () => {
    const onShow = vi.fn();
    const onDone = vi.fn();
    const t = platedStampTimer(onShow, onDone);
    t.failed();
    t.loaded(); // a late load after the error changes nothing
    vi.advanceTimersByTime(10_000);
    expect(onShow).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('skips a photo that loads too late', () => {
    const onShow = vi.fn();
    const onDone = vi.fn();
    const t = platedStampTimer(onShow, onDone);
    vi.advanceTimersByTime(PLATED_STAMP_LOAD_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
    t.loaded();
    expect(onShow).not.toHaveBeenCalled();
  });

  it('a failure after showing does not cut the stamp short', () => {
    const onDone = vi.fn();
    const t = platedStampTimer(() => {}, onDone);
    t.loaded();
    t.failed();
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PLATED_STAMP_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('cancel stops both callbacks', () => {
    const onShow = vi.fn();
    const onDone = vi.fn();
    const t = platedStampTimer(onShow, onDone);
    t.cancel();
    t.loaded();
    vi.advanceTimersByTime(10_000);
    expect(onShow).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
