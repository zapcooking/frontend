/**
 * What the Go live chat hands the on-video overlays.
 *
 * The chat (StreamChat) is the one place that knows which comments are
 * shown — muted, hidden-by-host and hidden-everywhere commenters are
 * already left out — and which zaps passed the ZapTotals check. It writes
 * the live ones here; the overlay on the host page's stage and the one in
 * the persistent player (which lives in the root layout, so it cannot take
 * props from the watch page) read them by the note id they show.
 *
 * Only arrivals after the chat opened are written: the overlay never
 * replays history.
 */

import { writable } from 'svelte/store';
import type { OverlayComment, OverlayZap } from './overlay';

export interface OverlayProfile {
  name: string;
  picture: string | null;
}

export interface OverlayFeedState {
  /** The "Live now" note id the chat hangs off. */
  target: string | null;
  /** Live comments now shown in the chat, oldest first (capped). */
  comments: OverlayComment[];
  /** Live verified zaps, oldest first (capped). */
  zaps: OverlayZap[];
  profiles: Record<string, OverlayProfile>;
}

const EMPTY: OverlayFeedState = { target: null, comments: [], zaps: [], profiles: {} };

export const COMMENTS_KEPT = 12;
export const ZAPS_KEPT = 40;

export const overlayFeed = writable<OverlayFeedState>(EMPTY);

/** The chat for `target` opened: start a fresh feed. */
export function openOverlayFeed(target: string) {
  overlayFeed.set({ ...EMPTY, target });
}

/** The chat for `target` closed: clear the feed if it is still its own. */
export function closeOverlayFeed(target: string) {
  overlayFeed.update((s) => (s.target === target ? EMPTY : s));
}

export function setOverlayComments(target: string, comments: OverlayComment[]) {
  overlayFeed.update((s) =>
    s.target === target ? { ...s, comments: comments.slice(-COMMENTS_KEPT) } : s
  );
}

export function pushOverlayZap(target: string, zap: OverlayZap) {
  overlayFeed.update((s) =>
    s.target === target && !s.zaps.some((z) => z.id === zap.id)
      ? { ...s, zaps: [...s.zaps, zap].slice(-ZAPS_KEPT) }
      : s
  );
}

export function setOverlayProfiles(target: string, profiles: Record<string, OverlayProfile>) {
  overlayFeed.update((s) => (s.target === target ? { ...s, profiles } : s));
}
