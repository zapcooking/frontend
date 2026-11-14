/**
 * Announcements that clutter the directory without being a stream anyone
 * wants to open: developers' test runs and empty shells.
 *
 * Observed on the live relays, "Test A" / "Test B" / "Test D" from crew-game
 * tooling (ended, no image, no recording, a handful per author), "Canary
 * stage (automated test)", and a long tail of announcements with no title,
 * no picture and nothing to replay — they render as a blank card captioned
 * "Untitled livestream".
 *
 * Deliberately narrow on titles: this is a cooking site, so "Test Kitchen
 * Live" and "Blind taste test" are real streams and must stay.
 */
import type { StreamItem } from './types';

/** The title `parseStreamEvent` falls back to when the tag is missing. */
const DEFAULT_TITLE = 'Untitled livestream';

/** "Test", "Test A", "Test 2", "testing 1 2 3", "test stream", "test live". */
const BARE_TEST_TITLE =
  /^\s*(?:test|testing)(?:\s+(?:stream|live|livestream|video|recording|run|[a-z0-9]{1,2}))*\s*[!.]*\s*$/i;

/** "stream test", "live test", "livestream testing". */
const STREAM_TEST_TITLE = /^\s*(?:stream|live|livestream)\s+test(?:ing)?\s*[!.]*\s*$/i;

/** "Canary stage (automated test)", "[test] kickoff" — a bracketed test marker. */
const BRACKETED_TEST_TITLE = /[(\[][^)\]]*\btest(?:ing)?\b[^)\]]*[)\]]/i;

const TEST_TAGS = new Set(['test', 'testing']);

/** True when the title or tags mark the announcement as a test. */
export function isTestStream(item: Pick<StreamItem, 'title' | 'categories'>): boolean {
  const title = (item.title || '').trim();
  if (
    BARE_TEST_TITLE.test(title) ||
    STREAM_TEST_TITLE.test(title) ||
    BRACKETED_TEST_TITLE.test(title)
  ) {
    return true;
  }
  return (item.categories || []).some((tag) => TEST_TAGS.has(String(tag).toLowerCase()));
}

/**
 * An ended announcement with nothing to show for itself: no replay to play
 * and no picture to put on the card.
 */
export function isEmptyShell(
  item: Pick<StreamItem, 'recording' | 'image' | 'thumb'>
): boolean {
  return !item.recording && !item.image && !item.thumb;
}

/** No title was ever set, and there is no replay to make up for it. */
export function isUntitledWithoutReplay(item: Pick<StreamItem, 'title' | 'recording'>): boolean {
  const title = (item.title || '').trim();
  return !item.recording && (!title || title === DEFAULT_TITLE || /^untitled\b/i.test(title));
}

/** Everything the Past tab should leave out. */
export function isPastNoise(
  item: Pick<StreamItem, 'title' | 'categories' | 'recording' | 'image' | 'thumb'>
): boolean {
  return isTestStream(item) || isEmptyShell(item) || isUntitledWithoutReplay(item);
}
