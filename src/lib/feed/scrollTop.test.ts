/**
 * Guard for the Global feed's "am I at the top?" question.
 *
 * The feed scrolls inside #app-scroll. FoodstrFeedOptimized used to listen on
 * `window` and read `window.scrollY`, which never changes there, so every
 * live post was spliced into the top of the list while the reader was
 * scrolled down (reproduced in the audit: content moved ~436 px under the
 * finger on iOS, the "new posts" pill never showed).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { feedScrollTop, feedScrollTarget, isAtTop, AT_TOP_PX } from './scrollTop';

describe('scrollTop helpers', () => {
  it('reads the app scroller when it exists, not the window', () => {
    const scroller = { scrollTop: 2500 } as unknown as HTMLElement;
    expect(feedScrollTop(scroller)).toBe(2500);
    expect(feedScrollTarget(scroller)).toBe(scroller);
  });

  it('falls back to the window only when there is no app scroller', () => {
    expect(feedScrollTop(null)).toBe(0); // node: no window
    expect(isAtTop(0)).toBe(true);
    expect(isAtTop(AT_TOP_PX - 1)).toBe(true);
    expect(isAtTop(AT_TOP_PX)).toBe(false);
    expect(isAtTop(2500)).toBe(false);
  });
});

describe('FoodstrFeedOptimized tracks the real scroller', () => {
  const src = readFileSync(
    join(__dirname, '..', '..', 'components', 'FoodstrFeedOptimized.svelte'),
    'utf8'
  );

  it('never reads window.scrollY or listens for scroll on the window', () => {
    expect(src).not.toMatch(/window\.scrollY/);
    expect(src).not.toMatch(/window\.addEventListener\(\s*['"]scroll['"]/);
    expect(src).not.toMatch(/documentElement\.scrollTop/);
  });

  it('attaches its scroll listener to the feed scroller and reads from it', () => {
    expect(src).toMatch(/feedScrollTarget\(\)/);
    expect(src).toMatch(/feedScrollTop\(/);
  });
});
