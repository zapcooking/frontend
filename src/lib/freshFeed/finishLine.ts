import type { FloorPrompt } from './floorPrompt';

/**
 * The end of the 14-day window: "You're all caught up", then an opt-in
 * "Keep exploring" (nothing from the archive loads until it's tapped), and
 * at the end of the explore section "Older posts" for members, which
 * resumes paging into history. Readers without member access see the
 * membership (or log-in) card instead.
 */
export type ExploreState = 'closed' | 'loading' | 'open';

export interface FinishLine {
  /** The caught-up card. */
  caughtUp: boolean;
  /** The "Keep exploring" button. */
  exploreButton: boolean;
  /** The explore section (loading or loaded). */
  explore: boolean;
  /** "Older posts" at the end of the explore section. */
  older: boolean;
  /** The membership / log-in card (FreshFloorCard). */
  floorCard: boolean;
}

export function finishLine(o: {
  /** The feed reached the end of the free window. */
  reached: boolean;
  /** Still at the window's end (older posts not asked for yet). */
  atFloor: boolean;
  membershipKnown: boolean;
  prompt: FloorPrompt;
  explore: ExploreState;
}): FinishLine {
  const caughtUp = o.reached && o.membershipKnown;
  const memberAccess = o.prompt.kind === 'none';
  return {
    caughtUp,
    exploreButton: caughtUp && o.explore === 'closed',
    explore: caughtUp && o.explore !== 'closed',
    older: caughtUp && o.explore === 'open' && memberAccess && o.atFloor,
    floorCard: caughtUp && !memberAccess
  };
}
