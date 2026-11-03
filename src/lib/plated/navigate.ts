/**
 * Getting to a plated card in the recipe thread: the gallery's "See in
 * comments" and a notification's `#plated-<id>` link share the scroll and
 * focus here.
 *
 * The link's card only exists once the recipe's comments have loaded (and
 * only if the plate survives moderation and its photo loads), so
 * `followPlatedDeepLink` waits for it, then falls back to the comments
 * section. Its timing is injected so it is unit-tested in navigate.test.ts.
 */
import { platedAnchorId } from './plated';

const PLATED_HASH = /^#plated-([0-9a-f]{64})$/;

/** The plate id in a `#plated-<64 hex>` hash; anything else is ignored. */
export function platedIdFromHash(hash: string | null | undefined): string | null {
  const m = typeof hash === 'string' ? PLATED_HASH.exec(hash) : null;
  return m ? m[1] : null;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

export function findPlatedCard(eventId: string): HTMLElement | null {
  return document.getElementById(platedAnchorId(eventId));
}

/** Center the card and move focus to it (the card is tabindex -1). */
export function scrollToPlatedCard(card: HTMLElement): void {
  card.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  card.focus({ preventScroll: true });
}

export function scrollToCommentsSection(): void {
  document.getElementById('comments-section')?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/**
 * Calls `cb` once the visitor scrolls or interacts on their own (wheel,
 * touch, scroll keys, a pointer press). Programmatic scrolls don't count.
 * Returns the unsubscribe.
 */
export function onUserScrollIntent(cb: () => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (SCROLL_KEYS.has(e.key)) cb();
  };
  const opts = { passive: true, capture: true } as const;
  window.addEventListener('wheel', cb, opts);
  window.addEventListener('touchmove', cb, opts);
  window.addEventListener('pointerdown', cb, opts);
  window.addEventListener('keydown', onKey, opts);
  return () => {
    window.removeEventListener('wheel', cb, opts);
    window.removeEventListener('touchmove', cb, opts);
    window.removeEventListener('pointerdown', cb, opts);
    window.removeEventListener('keydown', onKey, opts);
  };
}

export interface PlatedDeepLinkDeps<E> {
  findCard: (eventId: string) => E | null;
  /** Site moderation has settled, so a card still in the thread is allowed. */
  isReady: () => boolean;
  goToCard: (card: E) => void;
  goToComments: () => void;
  onUserScroll: (cb: () => void) => () => void;
  timeoutMs?: number;
  intervalMs?: number;
}

export const PLATED_LINK_TIMEOUT_MS = 8000;
const PLATED_LINK_INTERVAL_MS = 250;

/**
 * Follow a `#plated-<id>` link: once moderation is ready and the card is
 * in the thread, go to it; if it hasn't appeared by the timeout, go to the
 * comments section instead. If the visitor scrolls first, do nothing more.
 * Returns a cancel function (call it on navigation and unmount).
 */
export function followPlatedDeepLink<E>(eventId: string, deps: PlatedDeepLinkDeps<E>): () => void {
  const timeoutMs = deps.timeoutMs ?? PLATED_LINK_TIMEOUT_MS;
  const intervalMs = deps.intervalMs ?? PLATED_LINK_INTERVAL_MS;
  let done = false;
  let waited = 0;

  const stop = () => {
    if (done) return;
    done = true;
    clearInterval(timer);
    unlisten();
  };
  const unlisten = deps.onUserScroll(stop);

  const check = () => {
    if (done) return;
    if (deps.isReady()) {
      const card = deps.findCard(eventId);
      if (card) {
        stop();
        deps.goToCard(card);
        return;
      }
    }
    if (waited >= timeoutMs) {
      stop();
      deps.goToComments();
      return;
    }
    waited += intervalMs;
  };
  const timer = setInterval(check, intervalMs);
  return stop;
}
