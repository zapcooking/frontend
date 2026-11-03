# Explore magazine

`/explore` renders a shared, anonymous server response without hydrating the application. Recipe search is a native GET form; the existing small scripts enhance the drawer, import handoff, and membership controls. Import drafts and account state stay in browser storage, outside the public cache.

## Editorial configuration

- `src/lib/landing/editorialConfig.ts` holds the four headlines, fixed supporting line, and edition cadence. The default is one UTC day. An empty headline configuration falls back to “Every kitchen brings something.”
- The signed org list `30004:explore-hero` supplies the approved recipe cover pool; `30004:explore-reads` supplies approved food stories. Use the existing org key, list publication process, and `a` coordinate tags described in `src/lib/landing/curation.ts`. A missing eligible story falls back to another approved recipe, then fewer features.
- The four bounded “More inspiration” URLs select from the same cached pool. They do not initiate a separate content fetch. Headline rotation and pinned editorial candidates are independent of the normal 120-second aggregate refresh.
- Food stories retain actual titles, bylines, and summaries or literal short excerpts. Homepage food eligibility is narrower than the full Reads feed. Current moderation also applies to cached cards.
- [Fresh editorial controls](EXPLORE_FRESH_EDITORIAL.md) document supported topics, signed representative-post overrides, public access windows, and recent-note selection.
- The page reuses canonical image identities to avoid repeating photographs between the cover, recipes, stories, Fresh topics, recent notes, recipe-pack previews, and paid placements. Paid placements retain their separate disclosure.

Changing the page copy or cadence requires a code change. Changing signed editorial lists uses the existing publication workflow. No schema migration, additional secret, font download, or new service is required.

## Recipe packs

The landing discovery uses the same four public relays as `/packs`, requesting up to 60 matching kind-30004 events per relay. It verifies signatures, selects the latest revisions, excludes curation lists and moderated/empty packs, and shows up to four eligible cards. Images are optional. Recipe counts come from distinct eligible recipe references; the page does not infer counts from images.

Each pack uses its existing cover, or a collage from referenced recipes already in the cached recipe pool. If neither supplies an unused image, the pack still renders with a book illustration. A single result gets a wide feature layout. The loader allows 2.5 seconds for pack discovery and retains eligible last-good results during source outages.

The earlier one-pack display was not caused by a fetch limit of one or an image requirement. Live attempts from the development environment failed to connect to all four relays, so the number of currently published eligible packs and the exact cause of the observed single result remain unverified. No packs are fabricated to fill the layout.

## Verification boundaries

Layout screenshots use explicit test fixtures and existing local image assets, not a claim about current published content. Browser tests use mocked relay and extraction responses to exercise real routing, public preview limits, import errors, handoff, and editor state. Authentication and publication are not performed with a real account, and no paid extraction, deployment, or merge is part of this change.

The existing URL-only anonymous import policy, explicit review/edit step, source attribution, save/publish authentication, and Cheffy allowance remain unchanged.
