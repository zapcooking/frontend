/**
 * Which image a stream card shows.
 *
 * Announcements point at remote images that are often dead (purged uploads,
 * hosts that blocked hotlinking). An `<img>` that fails to load leaves the
 * browser's broken-image icon and alt text on the card, so the card tracks
 * the URLs that failed and moves on: the small `thumb`, then the full
 * `image`, then a placeholder tile.
 */
import { isValidImageUrl } from '$lib/placeholderImages';

interface ThumbSources {
  thumb?: string | null;
  image?: string | null;
}

/** Candidate URLs in preference order, deduplicated, known-broken patterns dropped. */
export function thumbCandidates(item: ThumbSources): string[] {
  const out: string[] = [];
  for (const url of [item.thumb, item.image]) {
    if (url && isValidImageUrl(url) && !out.includes(url)) out.push(url);
  }
  return out;
}

/**
 * The first candidate that has not failed to load, or null when none is
 * left. `hadImage` distinguishes "every image broke" (show the "image
 * unavailable" tile) from "the announcement never had one".
 */
export function pickThumb(
  item: ThumbSources,
  failed: ReadonlySet<string>
): { url: string | null; broken: boolean } {
  const candidates = thumbCandidates(item);
  const url = candidates.find((c) => !failed.has(c)) ?? null;
  return { url, broken: url === null && candidates.length > 0 };
}
