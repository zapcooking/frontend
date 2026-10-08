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
  gap: { min: 7, max: 9 },

  /**
   * Rotation pattern, repeating; a type that is capped, turned off or out
   * of unshown content is skipped. Recipes and spotlights lead, a memory
   * every 5th card.
   */
  rotation: ['recipe', 'spotlight', 'recipe', 'spotlight', 'memory'] as SpecialType[],
  /** Per-session caps (members): none, cards go on as long as the reader scrolls. */
  caps: { recipe: Infinity, spotlight: Infinity, memory: Infinity } as Record<SpecialType, number>,
  /** Non-members and signed out: recipe cards, at most one locked spotlight teaser. */
  freeCaps: { recipe: Infinity, spotlight: 1, memory: 0 } as Record<SpecialType, number>,

  /** "Show fewer like this": the type's per-session cap becomes this… */
  fewerCap: 3,
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

  /** "Keep exploring", below "You're all caught up" (opt-in). */
  explore: {
    /** "On this day" posts in the explore section. */
    dayPosts: 6,
    /** Topic spotlights (from different parent groups). */
    spotlights: 2,
    /** Recipes in the recipe-box row. */
    recipes: 8
  },

  /** Device-local memory of what was shown. */
  shownTtlSeconds: 90 * 24 * 60 * 60,
  shownMax: 1000,
  /** How many past spotlight topics are remembered for "favor not shown recently". */
  topicHistoryMax: 100
} as const;
