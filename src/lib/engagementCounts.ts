/**
 * Reconciling engagement counts from sources that each see only part of
 * the picture.
 *
 * A NIP-45 COUNT answers for the handful of relays that were asked, and
 * a relay that never saw a reaction answers zero honestly. The
 * subscription, meanwhile, counts whatever arrives from a different set
 * of relays. Neither is authoritative, but between them the larger
 * number is always the closer one to the truth: a count can only ever be
 * missing events, never inventing them.
 */

/**
 * Folds a counted value into the count we already hold.
 *
 * `null` means the source could not answer, which is not the same as
 * answering zero. A real zero is accepted only when nothing higher is
 * known, so a partial view can never erase engagement another source
 * already found.
 */
export function raiseCount(current: number, counted: number | null | undefined): number {
  if (counted === null || counted === undefined) return current;
  return Math.max(current, counted);
}
