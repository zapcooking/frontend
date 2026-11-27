/** Live stream sharing: which path a device gets, and the composer text. */
import { describe, it, expect } from 'vitest';
import { appendPrefill, liveShareText, prefersNativeShare } from './share';

describe('prefersNativeShare', () => {
  it('uses the native sheet only on touch-first devices that have one', () => {
    expect(prefersNativeShare({ hasNativeShare: true, coarsePointer: true })).toBe(true);
    // Desktop Safari/Chrome have navigator.share, but get the menu.
    expect(prefersNativeShare({ hasNativeShare: true, coarsePointer: false })).toBe(false);
    // A phone browser without navigator.share falls back to the menu.
    expect(prefersNativeShare({ hasNativeShare: false, coarsePointer: true })).toBe(false);
    expect(prefersNativeShare({ hasNativeShare: false, coarsePointer: false })).toBe(false);
  });
});

describe('liveShareText', () => {
  it('names the stream and carries the link on its own line', () => {
    expect(liveShareText('Seth is cooking Pizza Beans', 'https://zap.cooking/live/s/ab')).toBe(
      '🔴 Live on Zap Cooking: Seth is cooking Pizza Beans\nhttps://zap.cooking/live/s/ab'
    );
  });

  it('has a fallback name for an empty title', () => {
    expect(liveShareText('  ', 'https://x/live/s/1')).toBe(
      '🔴 Live on Zap Cooking: a live cook-along\nhttps://x/live/s/1'
    );
  });
});

describe('appendPrefill', () => {
  it('starts an empty composer with the share text', () => {
    expect(appendPrefill('', 'share')).toBe('share');
    expect(appendPrefill('  \n', 'share')).toBe('share');
  });

  it('keeps an unsent draft and adds the share text after a blank line', () => {
    expect(appendPrefill('my draft\n', 'share')).toBe('my draft\n\nshare');
  });
});
