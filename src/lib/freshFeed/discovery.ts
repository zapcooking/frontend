import type { RelayEvent } from './relay';
import { isImageUrl, mediaUrls } from './posts';
import type { Special } from './specials';
import type { SuggestedTopic } from './topicList';

/**
 * The desktop discovery column beside Fresh (FeedDiscoveryRail): "Find
 * your people" from the relay's suggested topics and "Around the table"
 * (one real conversation from the Fresh posts on this page). Pure, so the
 * rules are testable.
 */

/** "Find your people" shows this many suggested topics, then "Browse all topics". */
export const SUGGESTED_SHOWN = 5;

export interface SuggestedRow {
  slug: string;
  name: string;
  /** The admins' one-liner; '' when the list has none. */
  blurb: string;
  /** The topic's picture; '' for the neutral tile. */
  image: string;
  /** The pill ("12 new", from count_14d); '' when the relay counts none. */
  pill: string;
}

/**
 * The first SUGGESTED_SHOWN suggested topics, in the relay's order;
 * [] (the section hides) when the list is missing or empty.
 */
export function suggestedRows(list: SuggestedTopic[] | null): SuggestedRow[] {
  return (list ?? []).slice(0, SUGGESTED_SHOWN).map((t) => ({
    slug: t.slug,
    name: t.label,
    blurb: t.blurb ?? '',
    image: t.image ?? '',
    pill: t.count14d > 0 ? `${t.count14d} new` : ''
  }));
}

// --- Around the table ---

/** A conversation is a note from the last 48 hours... */
export const CONVERSATION_WINDOW_SECONDS = 48 * 3600;
/** ...with at least two replies... */
export const MIN_REPLIES = 2;
/** ...that isn't one of the first posts of the feed (on screen at load). */
export const TOP_ROWS_EXCLUDED = 5;

export interface ConversationCandidate {
  id: string;
  kind: number;
  createdAt: number;
  content: string;
  /** The real reply count; null until it has been fetched. */
  replies: number | null;
}

/**
 * True when the note asks something: a "?" in its own words (links,
 * nostr: references and hashtags don't count).
 */
export function isQuestion(content: string): boolean {
  const words = content
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/nostr:[a-z0-9]+/gi, ' ')
    .replace(/#\S+/g, ' ');
  return /[?？]/.test(words);
}

/**
 * The note for "Around the table", or null to omit the section. Candidates
 * are the feed's posts in display order. Eligible: a kind-1 note, at most
 * 48 hours old, with a known reply count of at least two, not among the
 * first TOP_ROWS_EXCLUDED posts and not in `exclude` (posts on screen or in
 * special cards). Questions first, then the most replies, then the newest.
 */
export function pickConversation(
  candidates: ConversationCandidate[],
  exclude: ReadonlySet<string>,
  now: number
): string | null {
  const since = now - CONVERSATION_WINDOW_SECONDS;
  const eligible = candidates
    .filter(
      (c, i) =>
        i >= TOP_ROWS_EXCLUDED &&
        c.kind === 1 &&
        c.createdAt >= since &&
        c.replies !== null &&
        c.replies >= MIN_REPLIES &&
        !exclude.has(c.id)
    )
    .map((c) => ({ c, question: isQuestion(c.content) }));
  eligible.sort(
    (a, b) =>
      Number(b.question) - Number(a.question) ||
      (b.c.replies ?? 0) - (a.c.replies ?? 0) ||
      b.c.createdAt - a.c.createdAt
  );
  return eligible[0]?.c.id ?? null;
}

/** The note's first picture (an `image` tag, else the first image link), or ''. */
export function firstImage(e: Pick<RelayEvent, 'content' | 'tags'>): string {
  const tag = e.tags.find((t) => t[0] === 'image')?.[1]?.trim();
  return tag || mediaUrls(e.content || '').find((u) => isImageUrl(u)) || '';
}

/** The posts whose reply counts are worth fetching: notes in the window, past the top rows. */
export function conversationPool(candidates: ConversationCandidate[], now: number): string[] {
  const since = now - CONVERSATION_WINDOW_SECONDS;
  return candidates
    .filter((c, i) => i >= TOP_ROWS_EXCLUDED && c.kind === 1 && c.createdAt >= since)
    .map((c) => c.id);
}

// --- What Fresh tells the page (FreshFeed's bound `discovery` prop) ---

/** The ids of posts shown inside special cards (never featured again beside them). */
export function specialPostIds(specials: Special[]): Set<string> {
  const ids = new Set<string>();
  for (const s of specials) {
    if (s.type === 'recipe') ids.add(s.post.id);
    else for (const p of s.posts) ids.add(p.id);
  }
  return ids;
}

export interface FreshDiscovery {
  /** The main feed's posts, in display order. */
  posts: RelayEvent[];
  /** Posts inside special cards. */
  specialIds: Set<string>;
  /** A topic or archive view is open instead of the main feed. */
  viewOpen: boolean;
  timeMachineLocked: boolean;
  timeMachineOpen: boolean;
}

export const NO_DISCOVERY: FreshDiscovery = {
  posts: [],
  specialIds: new Set(),
  viewOpen: false,
  timeMachineLocked: true,
  timeMachineOpen: false
};
