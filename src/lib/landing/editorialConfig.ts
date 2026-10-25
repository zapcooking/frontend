/** Shared editorial clock. Changing cadence never changes the data cache's refresh interval. */
export const EDITORIAL_EDITION_SECONDS = 24 * 60 * 60;
export const DEFAULT_HEADLINE = 'Every kitchen brings something.';
export const EDITORIAL_HEADLINES: readonly string[] = [
  DEFAULT_HEADLINE,
  'Good food finds good company.',
  'Bring your favorites. Find new ones.',
  'Recipes worth passing around.'
];
export const EDITORIAL_SUPPORTING_LINE =
  'Find your next recipe, save the ones you love, and share something from your kitchen.';

export function editionBucket(
  nowSeconds: number,
  cadenceSeconds = EDITORIAL_EDITION_SECONDS
): number {
  const cadence =
    Number.isFinite(cadenceSeconds) && cadenceSeconds > 0
      ? cadenceSeconds
      : EDITORIAL_EDITION_SECONDS;
  return Number.isFinite(nowSeconds) ? Math.floor(nowSeconds / cadence) : 0;
}

export function editionHeadline(
  nowSeconds: number,
  headlines: readonly string[] = EDITORIAL_HEADLINES,
  cadenceSeconds = EDITORIAL_EDITION_SECONDS
): string {
  const usable = headlines.filter((headline) => typeof headline === 'string' && headline.trim());
  if (!usable.length) return DEFAULT_HEADLINE;
  const index =
    ((editionBucket(nowSeconds, cadenceSeconds) % usable.length) + usable.length) % usable.length;
  return usable[index];
}
