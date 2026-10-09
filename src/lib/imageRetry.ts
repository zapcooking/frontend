/**
 * One fallback to the original URL before an image is given up on.
 *
 * Feed tiles load a rewritten URL (resize parameters). Some hosts reject
 * it, some are flaky for a moment; the tile was then hidden for good while
 * the same image opened fine in the lightbox, which uses the original URL.
 *
 * The decision is kept as component STATE (a set of URLs now served
 * un-rewritten), never as an imperative `img.src` write: Svelte re-applies
 * the `src` binding on every re-render, which undid such a swap.
 */
export function retryOriginal(fallback: Set<string>, currentSrc: string, original: string): boolean {
  if (!original) return false;
  if (fallback.has(original)) return false; // already on the original: a real failure
  if (currentSrc === original) return false; // nothing to fall back to
  fallback.add(original);
  return true;
}
