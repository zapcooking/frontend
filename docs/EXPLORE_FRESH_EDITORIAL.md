# Explore Fresh editorial controls

The homepage uses the public Fresh relay and its NIP-11 topic catalog. It selects up to six “Find your flavor” topics and six “Just served” notes from one cached server aggregate. A sparse eligible pool produces fewer cards; the page does not substitute unrelated content.

## Topic selection

Publish the existing signed org list (kind `30015`, `d=explore-topics`) with ordered `t` tags containing supported topic slugs. The org key and source relays live in `src/lib/landing/curation.ts` and `landingData.server.ts`. Unsupported slugs are ignored. A signed empty list clears the topic selection even if the topic catalog is unavailable. That choice remains cached through later list outages and older relay replies until a newer signed nonempty list reopens selection. If the list is unavailable, the relay’s featured topics, `DEFAULT_FRESH_TOPICS` in `fresh.ts`, and supported catalog entries provide candidates.

The builder queries at most ten topics with up to eight public photo-note candidates each. It can substitute supported topics when the preferred ones have no eligible photo. Tiles use the actual post photograph, author profile, and original note link. Their destination is `/feed?tab=fresh&topic=<slug>`, using the same preview and membership rules as Fresh’s topic chips.

Editors can name a specific representative post with an additional tag:

```json
["topic-post", "japanese", "<64-character event id>"]
```

An explicit signed choice can supply a food photograph with an otherwise ambiguous caption. It still must be a public kind-1 photo note within the public window, pass moderation, and not be a reply, sensitive post, or obvious promotion. The source attribution is preserved. Overrides are fetched in one bounded batch, and missing profiles are also fetched in a batch.

Topic order rotates once per editorial edition using `editionBucket` in `editorialConfig.ts` (currently one UTC day). Selected source photographs stay stable within the edition unless the signed list changes or a post becomes ineligible. Canonical image and event checks prevent reusing a photograph or post elsewhere in the edition.

## Recent notes and cache

`JUST_SERVED_MAX_AGE_SECONDS` in `fresh.ts` is currently seven days. Notes are ordered newest first, limited to one per author, and require a concrete food tag or food/ingredient/cooking text. Broad trust-network, protocol, wellness, gardening, farming, and geographic tags alone are insufficient. Moderation applies to the full cached caption metadata as well as event and author identifiers.

Topic photographs use the relay’s public fourteen-day window, with a sixty-second margin to avoid the relay’s authentication grace period. Neither topic tiles nor recent notes require an authenticated browser fetch.

The server aggregate refreshes normally every 120 seconds. Daily headline/cover rotation does not delay new Fresh notes. Every cache read rechecks note age, food relevance, and current moderation; last-good data cannot present expired notes as recent. A completed empty discovery clears the corresponding section, while source outages can retain eligible last-good cards. No new client NDK instance or per-card request is used.
