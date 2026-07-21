# Fix: Social Cards Missing Main Images (Recipes + Kind 1 Notes)

## Symptom

Social preview cards (Facebook/LinkedIn/etc.) for recipe and note links show
the generic zap.cooking placeholder graphic instead of the recipe's cover
photo or the note's embedded image.

## Investigation

### What's confirmed NOT broken

- Bot detection (`recipeOgHtml.server.ts`'s `BOT_UA` regex) is comprehensive —
  covers Facebook, Twitter, LinkedIn, Slack, Discord, Telegram, WhatsApp,
  Pinterest, Reddit, Google, Apple, and more.
- The server emits correct `og:image` + `twitter:image` tags with valid,
  reachable URLs. Verified live against production with a crawler UA:
  - Recipe (`naddr1qvzqqqr4gupzpzmnn33w625mwmpgx6sc567f5jqtd7xeq2u0wqsg8hawyzlkk9deqqf85cedwperzvfdw3jhxapdvfexzan0j0sz28`)
    → `og:image` = `https://blossom.primal.net/13af266b...jpg` (correct, from
    the recipe's `image` tag).
  - Note (`nevent1qqsymazwf8y98gvhqa2777gh59e05dms6x7zyv47gfuppwkls67cpfqcsq3mt`)
    → `og:image` = the first raster URL found in the note's content
    (correct, matched the actual embedded photo).
- Image hosts serve `200 image/jpeg` to crawler UAs (tested `Twitterbot/1.0`
  and `facebookexternalhit/1.1` directly against the image URLs).
- Real (non-test) recipe images are properly sized — sampled 140 KB, 37 KB,
  981 B files, all valid JPEGs.

### Finding 1 — Missing image dimensions (primary suspect, affects both recipes and notes)

`src/lib/recipeOgHtml.server.ts` (the single shared HTML renderer used for
recipes, notes, profiles, and reads) emits:

```html
<meta property="og:image" content="...">
<meta property="og:image:secure_url" content="...">
```

but **never** `og:image:width`, `og:image:height`, or `og:image:type`.

Facebook's and LinkedIn's crawlers are known to silently drop the image from
the preview card when width/height aren't supplied and they can't/won't
fetch-and-measure the image themselves within their crawl budget — the URL
resolving fine in a browser or via curl does not guarantee the crawler
renders it. This would explain the symptom uniformly across recipe cards
*and* note cards, since both paths route through the same renderer.

### Finding 2 — Note image detection gaps (notes only)

`src/lib/noteOg.server.ts` picks the note's card image via:

```ts
const IMG_RE = /(https?:\/\/[^\s"']+\.(?:jpe?g|png|gif|webp|avif|bmp)(?:\?[^\s"']*)?)/i;
const imageInBody = event.content.match(IMG_RE)?.[1]?.replace(TRAILING_PUNCT_RE, '');
```

This only matches URLs with a literal file extension in the content string.
It misses:

- **NIP-92 `imeta` tags** — a growing number of clients (Amethyst, etc.)
  attach images via `imeta` tags rather than (or in addition to) a bare URL
  in content. Confirmed live: several sampled kind:1 events on
  `wss://relay.primal.net` had `imeta` tags with no matching extension-URL in
  content.
- **Extensionless image-host URLs** — `nostr.build/i/<id>`,
  `blossom.primal.net/<hash>` (no `.jpg`/`.png` suffix) are common image URLs
  on nostr and are already recognized by the client-side detector
  (`$lib/imageUrls.ts`'s `isImageUrl()`, which checks known hosts in addition
  to extensions) but NOT by `noteOg.server.ts`'s regex-only approach.

Net effect: a meaningful fraction of notes fall back to the author's avatar
or the static `social-share.png`, even though the note has a clear header
image a human viewer would see.

### Finding 3 — Broken test data (minor, not a code bug)

A few `zapcooking`-tagged test/dev recipes (`"ZC PR11 Test Bravo"`, `"ZC PR11
Test Alpha"`) point their `image` tag at a 292-byte placeholder file — too
small for any crawler to treat as a real photo. Not a code issue; these are
recipes created during earlier PR testing sessions. Separate from the
`hide 19 known dev/e2e test recipes from /recipes` fix already merged
(#553) — that hid them from the recipes list; their OG cards would still be
broken if shared directly, though nobody should be sharing test recipes.

## Recommended Fix (not yet implemented)

### Phase 1 — image dimensions (fixes the systematic/universal cause)

Add a small server-side step to `recipeOgHtml.server.ts`'s render path:

1. Fetch the resolved `meta.image` URL (already have the URL at render time).
2. Parse just enough of the response to read width/height from the file's
   own header bytes — no need for a full decode or a library like `sharp`
   (keeps the worker bundle small, same constraint noted throughout the OG
   code). JPEG (`SOF0`/`SOF2` marker scan), PNG (`IHDR` chunk, fixed offset),
   and WebP (`VP8`/`VP8L`/`VP8X` chunk) are all cheap to hand-parse from the
   first few KB — no need to download the whole image.
3. Cache the result by image URL (in-memory LRU or same cache mechanism as
   the rest of the OG layer) so repeated shares of the same recipe/note don't
   re-fetch the image every time.
4. Emit `og:image:width`, `og:image:height`, `og:image:type` alongside the
   existing `og:image` tags.
5. On any failure (unreachable, unparseable, timeout) — omit the
   dimension tags and fall back to today's behavior (still emits `og:image`
   with no dimensions) rather than blocking the whole card render. Bound
   this fetch with its own short timeout, separate from the note/recipe
   fetch budget, following the pattern already used in `noteOg.server.ts`
   (`NOTE_TIMEOUT_MS` / `AUTHOR_TIMEOUT_MS` split).

### Phase 2 — note image detection (fixes the notes-specific gap)

In `noteOg.server.ts`:

1. Check `imeta` tags first (NIP-92): `['imeta', 'url <url>', 'm <mimetype>',
   ...]` — take the first tag's `url` field if present, before falling back
   to content-regex scanning.
2. Extend the content-URL scan to also recognize known extensionless image
   hosts (mirror `$lib/imageUrls.ts`'s host list: `nostr.build`,
   `blossom.primal.net`, `image.nostr.build`, etc.) rather than requiring a
   literal file extension.
3. Keep the existing extension-regex as the final fallback for anything not
   covered by imeta or the host list.

### Phase 3 — test data cleanup (low priority, optional)

Either delete/replace the placeholder images on the known test recipes, or
leave as-is since they're already hidden from `/recipes` (#553) and unlikely
to be shared directly.

## Files involved

- `src/lib/recipeOgHtml.server.ts` — shared HTML renderer (Phase 1 target)
- `src/lib/recipeOgMeta.ts` — recipe metadata derivation (image tag already
  correct, no change needed here)
- `src/lib/noteOg.server.ts` — note metadata derivation (Phase 2 target)
- `src/lib/recipePackOg.server.ts` — `raceRelays()` helper, reused by the
  image-dimension fetch if Phase 1 needs a relay-agnostic fetch primitive
  (not needed here — this is a plain HTTP image fetch, not a relay query)
- `src/hooks.server.ts` — dispatches bot requests to the above; no change
  expected unless the dimension-fetch timeout needs to be threaded through

## Status

**Implemented** (Phases 1 and 2; Phase 3 test-data cleanup skipped as
low-priority/optional per the original plan).

- New `src/lib/imageDimensions.server.ts`: fetches just the header bytes of
  an image URL (`Range: bytes=0-262143`) and parses width/height/mime from
  JPEG (SOF marker scan), PNG (fixed-offset IHDR), or WebP (VP8/VP8L/VP8X).
  Verified against `sips` ground truth on real JPEG/PNG/WebP files during
  development (byte-exact matches). In-memory cache (500-entry cap, LRU-ish
  eviction), including caching `null` results so a broken image isn't
  re-probed on every card render. Covered by 10 unit tests using hand-built
  minimal-but-valid image buffers (`imageDimensions.server.test.ts`).
- `src/lib/recipeOgHtml.server.ts`'s `renderDocument()` now emits
  `og:image:width` / `og:image:height` / `og:image:type` for every card type
  (recipe, note, profile, reads) — the static fallback graphic's dimensions
  are hardcoded (`STATIC_FALLBACK_DIMENSIONS`) to skip a redundant fetch;
  everything else goes through `probeImageDimensions()`. Falls through
  silently (tags omitted) on any fetch/parse failure, never blocks the rest
  of the card.
- `src/lib/noteOg.server.ts`: added `findCardImage()`, which checks NIP-92
  `imeta` tags first, then falls back to `$lib/imageUrls`'s shared
  `extractImageUrls()` (recognizes both file-extension URLs and known
  extensionless image-CDN hosts — nostr.build, imgur, primal's proxy, etc.),
  replacing the old file-extension-only regex. Covered by 8 unit tests
  (`noteOg.server.test.ts`).
- Verified live against the dev server with the same recipe/note used in
  the original investigation: the note now emits `1280x664 image/jpeg`
  (matches `sips` ground truth exactly); the known test recipe's broken
  292-byte placeholder now correctly emits `64x64` (proving the pipeline
  works end-to-end — that recipe's *fix* is Phase 3, not this code).
- `pnpm run check`: 0 errors. Full test suite: 795/795 passing (including
  the 18 new tests).

Not done (deliberately, per the original plan): Phase 3 (replacing the
broken placeholder images on known test/dev recipes) — those recipes are
already hidden from `/recipes` (#553) and unlikely to be shared directly.
