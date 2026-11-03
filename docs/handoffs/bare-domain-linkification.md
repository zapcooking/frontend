# Handoff: bare-domain linkification across all surfaces

**Status:** web fix shipped in the PR that carries this doc. Native apps + jumble: to implement.

## The problem

A note saying `see zap.cooking/pow` renders the link as plain text, while the
same author pasting `https://zap.cooking/pow` gets a rich preview card. Users
expect bare domains to work the way they do on Twitter/X — "it worked on
Twitter" is the standard bug report. Two distinct root causes exist across our
surfaces:

1. **Scheme-required URL matching** — the pipeline only recognizes `https?://`,
   so any scheme-less domain is invisible to it (web notes before the fix, jumble).
2. **Hand-trimmed TLD allowlists** — the pipeline *does* fuzzy-match bare
   domains, but only against a ~65-entry hardcoded TLD list that omits most of
   the modern gTLD space (`cooking`, `band`, `xyz`-adjacent newcomers, …). The
   same list was copy-pasted between the native apps (the iOS source comments
   literally say "mirrors the Android app's combined regex").

Real case: `note1hrfxfwku95uhpg9v0fvdmtyaqkd95zg6pf6qvt0cmm52jq8kztaqc3vvgm`
announced the /pow page with a bare `zap.cooking/pow`; the OP's follow-up reply
with the full URL rendered a preview card right below it.

## What shipped on web (the reference implementation)

PR: *fix(notes): linkify bare domains in note bodies on the full IANA TLD list*.

| Surface | File | Change |
|---|---|---|
| Markdown bodies (recipes, editor preview, print modal, messenger) | `src/lib/parser.ts` | `md.linkify.tlds(tlds, true)` — merges the full IANA list into markdown-it's linkify. `true` = merge with defaults, keeping the blanket 2-letter-ccTLD rule and `xn--` handling. |
| Note bodies (feed, note pages) | `src/lib/nostrRefScan.ts` | Second pass with a standalone `linkify-it` instance (`fuzzyLink: true, fuzzyEmail: false, fuzzyIP: false`) fed the same `tlds` list. Only `schema === ''` (fuzzy) matches are taken; spans overlapping an existing nostr/URL ref are dropped. |
| Rendering | `src/components/NoteContent.svelte` | Bare matches carry a `bare` flag and render as inline links only — excluded from the media-gallery / LinkPreview / embed cascade and from block layout. |
| Deps | `package.json` | `tlds` (IANA list, JSON) + `linkify-it` (direct, pnpm-strict import) + `@types/linkify-it`. |

Tests: `src/lib/nostrRefScan.test.ts` (bare domain with path, TLD gating,
trailing punctuation, `www.`, no double-match of explicit URLs, scheme-less
blossom URL as one whole link, no overlap with nostr refs) and
`src/lib/parser.linkify.test.ts`.

### The cross-platform contract

These rules are the deliverable — implement them per platform below.

1. **One TLD source of truth**: the full IANA list from the `tlds` npm package
   (JSON, ~1,440 entries, lowercase, punycode-free). No hand-trimmed lists. If
   the runtime can't npm-install it, generate a bundled resource from it (see
   recipes below) — but generate, don't curate.
2. **Scheme-less only.** Explicit `https?://` URLs keep their existing
   pipeline. Fuzzy detection must never double-claim a span the scheme-based
   matcher already found.
3. **Inline links, never preview cards.** A fuzzy match is an inference; a
   false positive (`oven.to`, `recipes.zip`) must cost at most a stray
   underline — never a loaded OpenGraph card, media gallery, or embed.
4. **Overlap protection.** Nostr refs (`npub1…`, `nevent1…`, with or without
   `nostr:` prefix) win over bare domains. Corollary win: scheme-less blossom
   URLs (`npub1….blossom.band/img.png`) become ONE whole link instead of
   plain text / a carved-up npub.
5. **No fuzzy email.** `chef@zap.cooking` as a mailto is a separate decision,
   not bundled here.
6. **Trailing punctuation excluded.** `see jumble.social,` links `jumble.social`.
7. **Synthesize a scheme** for the href. Web uses linkify-it's default
   (`http://`); the native apps already synthesize `https://`. Both work
   (zap.cooking 301s), but pick `https://` in new implementations — see open items.
8. **Expect the perf profile.** The fuzzy scan gets ~9× slower per text with
   1,440 TLDs vs a short list (measured on web: 1.9 → 17.6 ms per ~100 KB
   render). Note-sized text is unaffected in practice (<2 ms); don't run the
   matcher over arbitrarily large documents per keystroke without measuring.

## Per-repo implementation

### zapcooking web — done (this PR)

Capacitor Android/iOS builds (`docs/mobile/BUILD_INSTRUCTIONS.md`) bundle this
web codebase — no work needed beyond shipping the PR and cutting a release.

### zapcooking_ios (`~/GitHub/zapcooking_ios`)

SwiftUI + UIKit `UITextView` pipeline: `ContentParser.parse` → segments →
`RichContentView` / `RichInlineTextView`.

- The gap: `ContentParser.swift:78` — hardcoded TLD alternation interpolated
  into `combinedRegex` at `:90`; `cooking` is not in the list. Bare matches
  already synthesize `https://` at `:271-273` and flow through `classifyUrl`.
- The fix, keeping the regex shape:
  1. Replace the `tlds` constant with the full list. Easiest generation:
     `node -e "console.log(require('tlds').join('|'))"` (run anywhere with the
     package; paste output, or write it to a bundled `tlds.txt` read at init and
     `joined.replacingOccurrences(of: "\n", with: "|")`).
  2. **Force inline rendering for bare matches**: where the bare-domain branch
     calls `classifyUrl` (`:271-273`), bypass any `.link` (block/preview)
     classification and emit `.inlineLink` — rule 3.
  3. Keep the existing lookbehind/lookahead guards and alternative order
     untouched; nostr alternatives already precede the bare-domain one, and the
     bare-npub guard `(?!\w|\.[a-zA-Z])` at `:84` is what makes rule 4 hold.
  4. Tests: `wispTests/ContentParser*.swift` — port the web test matrix
     (below); assert segment is `.inlineLink` with synthesized `https://` href.
- Perf: build the `NSRegularExpression` once (it already is); 1,440-alternation
  is a linear scan per position — fine for note text, verify on a long note.

### zap_cooking_android (`~/GitHub/zap_cooking_android`)

Jetpack Compose; same architecture, same copied list.

- The gap: `RichContent.kt:299` — `combinedRegex` with the same ~65-TLD
  alternation (capture group 3); `cooking` missing (and the `co` entry can't
  rescue it — `(?!\w)` rejects `cooking`'s tail). Synthesis at `:335-336`.
- The fix mirrors iOS: swap the alternation for the generated full list, and in
  `parseContent` route bare-domain captures to `InlineLinkSegment` always —
  never a standalone `LinkSegment` (which renders `LinkPreview` at
  `RichContent.kt:1343-1345`) — rule 3.
- Nostr ordering already correct (nostr alternatives first, bare bech32 last,
  blossom guard on bare npub).
- Adjacent gap worth a follow-up ticket: the long-form article tokenizer
  (`ArticleScreen.kt:749`) has **no** http/bare-domain linkification at all.
- Tests: port the matrix; `ImageUrlsTest.kt:158` already documents the
  bare-domain behavior — keep it green.

### wisp iOS (`~/GitHub/wisp-ios`)

One app target (`wisp`) + ShareExtension (does no text rendering).

- `ContentParser.swift` here is a near-twin of zapcooking_ios's (zapcooking_ios
  is a fork of wisp — same file layout, offset line numbers). Gap: TLD list at
  `:73`, bare-domain alternative at `:85`, synthesis at `:236, 241-243`.
- Apply the identical fix as zapcooking_ios; if practical, land it in wisp
  first and let zapcooking_ios re-port, since the files are near-identical.
- Note: `ComposeView.swift:524-526` already documents that NSDataDetector can't
  detect scheme-less domains — that's why the custom regex exists; keep it.
- Chat surfaces (group bubbles in `GroupRoomView.swift:209-232`, DM bubbles via
  `EmojiText`) do no URL linkification today; extending the fix there is
  optional scope — the note feed is the parity target.

### jumble (`~/GitHub/jumble-spark`)

React/TS; two pipelines, neither fuzzy-links bare domains.

- Plain-text pipeline: `EmbeddedUrlParser` (`src/lib/content-parser.ts:134-186`)
  uses `URL_REGEX` (`src/constants.ts:218-219`) which requires `https?://`.
- Markdown pipeline: `react-markdown` + `remark-gfm` autolink literals — covers
  `www.`-prefixed domains only, not arbitrary bare domains.
- The fix — same recipe as zapcooking web:
  1. `pnpm add linkify-it tlds && pnpm add -D @types/linkify-it`.
  2. New `EmbeddedBareDomainParser` using a module-level `new LinkifyIt({
     fuzzyLink: true, fuzzyEmail: false, fuzzyIP: false })` with
     `.tlds(tlds, true)`, taking only `schema === ''` matches and emitting
     nodes the renderer maps to `<ExternalLink>` — **exclude them from
     `lastNormalUrl` WebPreview selection** (`Content/index.tsx:111-113`),
     rule 3.
  3. Append it LAST in the parser list (`Content/index.tsx:72-82`). jumble's
     `parseContent` runs parsers sequentially over remaining text nodes, so
     order is precedence: explicit URLs, prefixed refs, and bare refs all claim
     spans first (rule 4). The existing bare-ref guards
     (`content-parser.ts:78-79` reject tokens followed by `.` or `/`) mean
     scheme-less blossom URLs fall through to your new parser untouched.
  4. Port the test matrix into the content-parser tests.

## Test matrix (all platforms)

| Input | Expected |
|---|---|
| `see zap.cooking/pow for more` | inline link, href `http(s)://zap.cooking/pow`, path intact |
| `go to www.zap.cooking now` | inline link |
| `see https://zap.cooking/pow` | existing pipeline, single match, no fuzzy double-claim |
| `bake at 350.degreesf` / `add 1.5 cups flour` | plain text (no TLD match) |
| `see jumble.social, please` | link span excludes the comma |
| `npub1…(valid) and zap.cooking/pow` in one note | both match, non-overlapping |
| `npub1….blossom.band/img.png` | one whole inline link, npub not carved out |
| bare domain on its own line | still inline (web rule) — **not** a preview/embed card |
| `chef@zap.cooking` | unchanged (no mailto unless deliberately scoped in) |

## Open items

- **Scheme unification**: web markdown surface emits `http://` (markdown-it
  default), web notes `http://` (linkify-it default), native apps `https://`.
  Harmless today (redirects), but pick `https://` for new code and consider a
  follow-up normalizing the web surfaces.
- **Web DMs**: `MessageBubble.svelte` has its own hand-rolled linkifier
  (explicit-scheme only) — same extension applies if chat parity is wanted.
- **dark-wisp** (`~/GitHub/dark-wisp`, Android): assumed to share wisp's
  renderer DNA — not surveyed; check whether it inherits the zap_cooking_android
  `RichContent` pattern and apply the same fix.
- **zapcooking web perf**: `MarkdownEditor.svelte` live preview re-parses per
  keystroke; with the full list that's ~2 ms per 10 KB. Acceptable; revisit if
  long-document editing complaints appear.
