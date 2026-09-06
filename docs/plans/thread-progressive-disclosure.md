# Web Thread Progressive Disclosure — Feasibility Review

Reviewed [zap_cooking_android PR #193](https://github.com/zapcooking/zap_cooking_android/pull/193)
("Collapsible reply threads — depth cap + inline expand") to determine
whether the same approach is feasible for making zap.cooking's desktop/web
threads more fluid to read.

## What Android's PR #193 actually does

A pure `ThreadFlattener.flatten()` function turns a parent→children reply
tree into a flat list of three typed rows (`ThreadItem` sealed type):

- **`Post`** — a real note row, carrying its `depth`, `descendantCount`
  (subtree size, for "+N replies" affordances), and
  `connectorStartsMidAir` (true when the depth-guide rail above this row
  isn't a continuous visible spine, so the UI dashes the rail's top).
- **`CollapsedReplies`** — a folded subtree beyond the depth cap (3 levels),
  rendered as a "Show N more replies" affordance. Tapping expands the whole
  subtree **inline**, in place — the note above the button stays put, no
  navigation.
- **`ShowMoreReplies`** — a fan-out cap (>4 direct siblings under one
  parent); currently built but **disabled** in this PR (`maxSiblingsInline =
  Int.MAX_VALUE`), reserved for later.

Key mechanics:

- **Depth cap + inline expand**: replies deeper than `DEPTH_CAP = 3` fold
  behind the affordance. Expanding one branch only removes that cap one
  level deeper (progressive — expanding doesn't reveal everything at once
  beyond the next fold).
- **Scroll-target exemption**: the path from a freshly-published reply up to
  the root is exempt from both collapse and the depth cap, so a new reply is
  always reachable regardless of how deep it landed.
- **Connector rail**: `threadConnector()` draws a vertical line → rounded
  corner → short horizontal run into the row (Canvas `drawBehind`), replacing
  one straight line per ancestor level. Dashed top when
  `connectorStartsMidAir` is true.
- **Rendering**: `LazyColumn` keyed by `ThreadItem.key`/`contentType`, using
  `Modifier.animateItem()` for the FLIP-style reflow animation when a branch
  expands/collapses.
- **Shared across surfaces**: `ThreadFlattener`/`ThreadItem` and the
  `threadIndentDp`/`threadConnector` helpers are used by **both**
  `ThreadScreen` (note threads) and `ArticleScreen` (article/recipe
  comments) — Android unified two previously-separate rendering paths onto
  one flattener in this same PR.
- **Reply-bar polish**: the sticky bottom "Reply…" bar targets whichever
  note is at the top of the viewport (not always the root); "Replying to X"
  moved to its own row above the avatar/name row, muted color, no tap
  target on the label itself (only the name is a profile link).
- **Testing**: a JVM unit suite for `ThreadFlattener` covering depth cap,
  whole-subtree expand, scroll-target exemption, cycle safety, collapse,
  orphan-connector flagging, and root-null fallback.

Source files reviewed in full:
`ThreadItem.kt`, `ThreadFlattener.kt`, `ThreadIndent.kt`,
`CollapsedRepliesRow.kt`, `ThreadScreen.kt`, `ThreadViewModel.kt`, plus the
commit diff for the reply-attribution polish pass.

## Current web state (what exists today)

Two separate ad-hoc renderers, neither with real depth handling:

### 1. `src/routes/[nip19]/+page.svelte` (kind:1 note threads)

- `directReplies` (a filter, not a tree) + `getNestedReplies(parentId)` (a
  fresh `.filter()` scan re-run per row) simulate nesting.
- Hardcoded to **exactly one level** of nesting, capped at the first 2
  children.
- "Show N more nested replies" is a plain `<a href={noteUrl(reply)}>` —
  it **navigates away** to view the rest, not an inline expand.
- No collapse/expand state, no depth cap beyond the hardcoded 1 level, no
  connector-rail depth cues (nested replies get a flat `ml-4 pl-4
  border-l-2`, not a depth-scaled indent).

### 2. `src/components/comments/CommentThread.svelte` + `CommentCard.svelte`
   (NIP-22 comments — used for both recipe comments and feed-post replies)

- Worse than the note-view path: **no depth concept at all.** Every reply
  gets the same fixed `margin-left: 1rem` / `border-left` regardless of how
  deep it actually is in the tree. A level-5 reply renders identically to a
  level-1 reply — exactly the "threads flatten and it's unclear who's
  replying to whom" problem PR #193's description names as the motivation.
- `getParentCommentId()` resolves each comment's *single* parent
  (correctly), but that per-comment parent link is never used to compute a
  cumulative depth or build a tree for rendering — it's only used to render
  a "Replying to X" line and (optionally) an embedded parent quote.
- `hasReplies` (boolean) drives a `.thread-line` CSS rail from parent
  avatar down to the next card — visually similar in spirit to Android's
  connector rail, but with no depth-cap, no dashed mid-air marker, and no
  branch-collapse affordance.

## Feasibility verdict

**Yes — and the core algorithm is a clean, near-direct port.**

`ThreadItem` + `ThreadFlattener` have zero Android/Compose dependencies —
they're pure data-in/data-out tree-flattening logic (`Map<String,
List<NostrEvent>>` → `List<ThreadItem>`). This translates to TypeScript
almost line for line:

| Android | Web equivalent |
|---|---|
| `sealed interface ThreadItem` (`Post`/`CollapsedReplies`/`ShowMoreReplies`) | TS discriminated union (`type ThreadItem = Post \| CollapsedReplies \| ShowMoreReplies`) |
| `ThreadFlattener.flatten()` | A pure `flattenThread()` function, same signature shape |
| JVM unit tests (`ThreadFlattenerTest.kt`) | Vitest suite, same test cases (depth cap, whole-subtree expand, scroll-target exemption, cycle safety, collapse, orphan-connector, root-null) |
| `LazyColumn` + `Modifier.animateItem()` | Keyed `{#each}` + Svelte's `animate:flip` (the standard FLIP-reflow analog) |
| `threadConnector()` Canvas draw | CSS: `CommentCard.svelte`'s existing `.thread-line` border-left/vertical-line technique already does the basic version; would need extending for depth-scaled indent + dashed mid-air variant |
| Scroll-target/root exemption | Same tree-walk logic port; web's expand-only-adds-rows-below case is actually simpler than Android's (no auto-scroll-to-arbitrary-depth case needed for the inline-expand affordance itself) |

Deliberately **not** in first-pass scope (Android itself either defers or
ships disabled):
- Fan-out cap (`ShowMoreReplies`) — Android ships this disabled
  (`maxSiblingsInline = Int.MAX_VALUE`); defer here too.
- "Reply bar targets top-of-viewport note" — needs a new
  IntersectionObserver-driven mechanism with no existing web equivalent;
  separate follow-up, not required for the core depth/collapse fix.

## Recommended scope

Build one shared `threadFlatten.ts` (mirroring `ThreadItem`/`ThreadFlattener`)
and use it from **both** rendering surfaces — the same consolidation move
Android made unifying `ThreadScreen` + `ArticleScreen` onto one flattener in
this same PR:

1. `src/routes/[nip19]/+page.svelte` (note-view kind:1 threads) — replace
   `directReplies`/`getNestedReplies()` with the shared flattener; replace
   the "Show N more nested replies" navigate-away link with inline expand.
2. `src/components/comments/CommentThread.svelte` /
   `CommentCard.svelte` (NIP-22 recipe/feed comments) — adopt the same
   flattener, fixing the flat-indent bug (every depth currently renders
   identically) as a side effect of the consolidation, not a separate fix.
3. New shared connector-rail helper (CSS), depth-scaled indent, dashed
   "mid-air" rail variant — extends `CommentCard.svelte`'s existing
   `.thread-line` technique rather than building from scratch.
4. Unit tests for the flattener (Vitest), porting the Android test cases.

Suggested implementation order: flattener + tests first (framework-agnostic,
independently verifiable), then wire into the note-view surface (the more
visibly broken of the two — full navigate-away for "show more" is worse UX
than CommentCard's flat-but-present nesting), then the comment surface.

## Status

Review only — **no code changes made, no branch created for implementation
yet**. This doc captures the PR review and feasibility analysis so
implementation can start in a future session without re-deriving it.
