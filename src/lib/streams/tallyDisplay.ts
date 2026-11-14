import type { StreamZapTally } from './streamZaps';

/**
 * Which zap tally the page should show after a scan reports `next`.
 *
 * The page re-scans every minute, and each scan starts with a quick pass
 * and streams partial results before it finishes. A slow or flaky relay
 * makes any of those read lower than the total already on screen, which
 * made the number (and the top-zappers strip) flap between the full
 * figure and a fraction of it. Within one stream the display only moves
 * up: a lower reading never replaces a higher one.
 */
export function keepHigherTally(
  current: StreamZapTally | null,
  next: StreamZapTally
): StreamZapTally {
  if (!current) return next;
  if (next.totalSats > current.totalSats) return next;
  if (next.totalSats === current.totalSats && next.zapCount >= current.zapCount) return next;
  return current;
}
