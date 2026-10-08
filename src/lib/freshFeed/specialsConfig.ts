/**
 * Every tunable number for Fresh's special cards (recipe box, topic
 * spotlight, memory) and the explore section, in one place.
 */

export type SpecialType = 'recipe' | 'spotlight' | 'memory';

export const SPECIALS = {
  /** Posts at the top of the feed that never get a card before them. */
  leadPosts: 5,
  /** The first card's position in the feed (1-based, inclusive range). */
  firstPosition: { min: 6, max: 8 },
  /** Posts between two cards (inclusive range, jittered per gap). */
  gap: { min: 7, max: 10 },

  /** Rotation order; a type at its cap is skipped. */
  rotation: ['recipe', 'spotlight', 'memory'] as SpecialType[],
  /** Per-session caps (members). */
  caps: { recipe: 3, spotlight: 2, memory: 2 } as Record<SpecialType, number>,
  /** Non-members and signed out: recipe cards, at most one locked spotlight teaser. */
  freeCaps: { recipe: 3, spotlight: 1, memory: 0 } as Record<SpecialType, number>,

  /** "Show fewer like this": the type's cap becomes this… */
  fewerCap: 1,
  /** …and it takes its rotation turn only every Nth time it comes up. */
  fewerTurnEvery: 2,

  spotlight: {
    /** Posts in a spotlight row. */
    posts: 3,
    /** A topic with fewer eligible posts than this is skipped. */
    minPosts: 3,
    /** Posts asked for per topic (older than the free window). */
    fetchLimit: 40,
    /** Topics tried before giving up on preparing one spotlight. */
    maxTopicTries: 4
  },

  memory: {
    /** "One year ago today": posts on the card. */
    dayPosts: { min: 1, max: 2 },
    /** "From the archive": one standout post. */
    archivePosts: 1,
    /** Random months tried for one "From the archive" card. */
    archiveMonthTries: 3
  },

  /** Device-local memory of what was shown. */
  shownTtlSeconds: 90 * 24 * 60 * 60,
  shownMax: 1000,
  /** How many past spotlight topics are remembered for "favor not shown recently". */
  topicHistoryMax: 100
} as const;
