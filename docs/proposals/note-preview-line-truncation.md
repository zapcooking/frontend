# Issue: Line-based truncation for collapsed note previews

## Problem

Collapsed note previews (`NoteContent.svelte`) truncate by **character count**
(`maxLength`, currently 500) rather than by visual rows. Two consequences:

- The preview length varies with content width and font — a 500-char cut is a
  different number of lines depending on the viewport, so previews look ragged.
- It originally sliced mid-word (e.g. "…has been a catal"). This is now mitigated
  by backing up to the last word boundary, but the cut still isn't aligned to a
  consistent number of rows.

## What we want

A collapsed preview clamped to a fixed number of **lines** (e.g. 6–8 rows of
text), with a "View more" toggle, so every preview is visually consistent
regardless of viewport width.

## Why it wasn't done now

Note content is **mixed** — text, inline images, media carousels, quoted-note
embeds, lightning invoices. A naive CSS `line-clamp` on the rendered container
would clamp/clip media parts (cut an image in half, hide an embed) rather than
just trimming trailing text, so it can't be dropped in as-is.

## Possible approaches

1. **Text-only line-clamp + media below the fold.** Clamp only the leading text
   block to N lines via CSS `-webkit-line-clamp`; treat any media/embeds as
   always-expanded blocks that live under the "View more" boundary. Requires
   splitting the parsed parts into "leading text" vs "rich blocks".
2. **Measure-and-cut.** After render, measure line height and the container, then
   compute how many characters fit in N rows and re-truncate. Accurate but adds a
   layout-measure pass and reflow per note (perf cost in long feeds).
3. **Hybrid.** Keep the character cap as a cheap upper bound, then apply a CSS
   line-clamp to the text spans only for the visual ceiling.

Approach 1 is likely the cleanest: it keeps truncation purely declarative for the
common text-only case and sidesteps measuring.

## Affected code

- `src/components/NoteContent.svelte` — `shouldCollapse`, `truncateAtUrlBoundary`,
  `displayContent`, `renderParts`, and the "View more / View less" toggle.

## Current state

Word-boundary truncation is in place (no more mid-word slices). This issue tracks
the larger move to consistent line-based previews.
