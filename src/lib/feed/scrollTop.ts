/**
 * Where the feed actually scrolls.
 *
 * The app's pages scroll inside `#app-scroll` (src/routes/+layout.svelte:
 * `overflow-y-auto`), not the window. Reading `window.scrollY` there always
 * gives 0 and a `window` 'scroll' listener never fires — which is how the
 * Global feed believed it was always "at the top" and spliced live posts
 * into the list under the reader's finger instead of showing the pill.
 */
export const FEED_SCROLLER_ID = 'app-scroll';

/** Pixels from the top within which the reader counts as "at the top". */
export const AT_TOP_PX = 100;

export function feedScroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(FEED_SCROLLER_ID);
}

/** Current scroll offset of the feed, from the app scroller or, failing that, the window. */
export function feedScrollTop(scroller: HTMLElement | null = feedScroller()): number {
  if (scroller) return scroller.scrollTop;
  if (typeof window === 'undefined') return 0;
  return window.scrollY || document.documentElement.scrollTop || 0;
}

/** What to attach the feed's 'scroll' listener to. */
export function feedScrollTarget(scroller: HTMLElement | null = feedScroller()): EventTarget {
  return scroller ?? window;
}

export function isAtTop(scrollTop: number, threshold = AT_TOP_PX): boolean {
  return scrollTop < threshold;
}
