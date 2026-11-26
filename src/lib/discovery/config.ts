/**
 * Discovery settings for the web app: how much room one author may take at
 * the top of the default recipe feed, and which accounts are held out of
 * discovery. Change them here; nothing else hardcodes either.
 *
 * Dependency-free on purpose (server loaders, client pages and vitest all
 * import it).
 */

/**
 * At most this many recipes per author (Nostr pubkey) in the opening of the
 * default recipe feed (/recipes). Set it to 3 to tighten the cap.
 */
export const RECIPE_FEED_AUTHOR_CAP = 4;

/** How many leading results the cap applies to. */
export const RECIPE_FEED_CAP_WINDOW = 20;

export interface DiscoveryExclusion {
  /** Canonical Nostr pubkey: 64 lower-case hex characters. Never a name. */
  pubkey: string;
  /** Why the account is held out, for whoever reads this next. */
  reason: string;
  /** ISO date the entry was added. */
  since: string;
}

/**
 * Accounts held out of web discovery: the /explore homepage (featured slots,
 * every author-attributed card, paid boosts), the /recipes feed, and recipe
 * recommendations (the Fresh feed's recipe-box cards, Cheffy's meal-plan
 * catalog, the "More from this chef" rail).
 *
 * Not a takedown. Direct recipe URLs, search, profile and tag pages, relay
 * storage and the native apps are untouched; for those, the Reads blocklist
 * (`$lib/reads/moderationConfig`, /admin/reads-moderation) is the tool.
 *
 * Reversible: delete the entry and deploy. Nothing is stored anywhere else,
 * and cached homepage data is re-checked against this list on every read
 * (`moderateLandingData`), so both adding and removing take effect with the
 * deploy.
 *
 * Entries are matched by pubkey only. An entry that is not 64 hex characters
 * is ignored (and fails `exclusion.test.ts`).
 */
export const DISCOVERY_EXCLUSIONS: readonly DiscoveryExclusion[] = [
  {
    // npub1ufmpper5zn5peh7pztseatd5uccylsxtphakkjlwqpsua5tfd86spdlm32
    pubkey: 'e27610e47414e81cdfc112e19eadb4e6304fc0cb0dfb6b4bee0061ced16969f5',
    reason:
      'Temporary, pending review of source and permissions: reported as an unofficial ' +
      'NYT Cooking archiver. On 2026-11-25 it authored 230 of the 500 newest recipes on ' +
      'feed.zap.cooking, every one with an `r` tag on cooking.nytimes.com.',
    since: '2026-11-25'
  }
];
