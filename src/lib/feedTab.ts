/**
 * Which /feed tab opens. An explicit `?tab=` link always wins; otherwise
 * the tab this device last chose; otherwise Fresh. Following needs a
 * signed-in reader, so signed out it falls back to Fresh. The choice is
 * kept in localStorage only.
 */

export type FeedTab = 'fresh' | 'global' | 'following' | 'replies' | 'members';

/** Left to right on /feed. */
export const FEED_TABS: readonly FeedTab[] = ['fresh', 'global', 'following', 'replies', 'members'];

export const DEFAULT_FEED_TAB: FeedTab = 'fresh';
export const FEED_TAB_KEY = 'zapcooking_feed_tab';

export function parseFeedTab(value: string | null | undefined): FeedTab | null {
  return value && (FEED_TABS as readonly string[]).includes(value) ? (value as FeedTab) : null;
}

export function initialFeedTab(
  param: string | null | undefined,
  stored: string | null | undefined,
  signedIn: boolean
): FeedTab {
  const tab = parseFeedTab(param) ?? parseFeedTab(stored) ?? DEFAULT_FEED_TAB;
  return tab === 'following' && !signedIn ? DEFAULT_FEED_TAB : tab;
}

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function readStoredFeedTab(s: StorageLike | null = storage()): FeedTab | null {
  try {
    return parseFeedTab(s?.getItem(FEED_TAB_KEY));
  } catch {
    return null;
  }
}

/** Remember a tab the reader picked (not one a link opened). */
export function storeFeedTab(tab: FeedTab, s: StorageLike | null = storage()): void {
  try {
    s?.setItem(FEED_TAB_KEY, tab);
  } catch {
    // Private mode or a full quota: the default applies next time.
  }
}
