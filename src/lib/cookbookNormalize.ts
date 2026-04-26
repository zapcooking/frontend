/**
 * Cookbook content normalization layer.
 *
 * The recipe markdown stored on relays is authored by humans. It can contain
 * markdown emphasis, raw links, embedded sub-headings, accidental duplicate
 * section markers, and the occasional "1. See above" placeholder. Rendering
 * that text directly into a printed cookbook surfaces every artifact.
 *
 * This module is the single seam between raw recipe input and the PDF
 * renderer. It runs `parseMarkdownForEditing` for the structural extraction,
 * then layers cleanup on top:
 *
 *   - Strip markdown formatting (bold, italic, links, headers, code) while
 *     preserving the underlying text.
 *   - Drop localhost / loopback URLs; preserve real attribution links as
 *     plain text.
 *   - Strip duplicate `## Ingredients` / `## Directions` blocks from notes
 *     when structured equivalents already exist (the source of the visible
 *     "duplicate ingredients section" bug).
 *   - Detect placeholder directions ("see above", "n/a", "tbd") and drop
 *     them so the renderer can show a clean "directions not included"
 *     fallback instead of a misleading single step.
 *
 * Importantly, the normalizer is allowed to remove and clean. It is NOT
 * allowed to invent ingredients, rewrite directions, or change recipe
 * meaning. Every transformation is conservative.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { extractRecipeDetails, parseMarkdownForEditing } from '$lib/parser';
import type { CookbookRecipe } from '$lib/cookbookExport';

// ─── Markdown stripping ────────────────────────────────────────────

/**
 * Loopback / localhost host fragment regex. Matches the common cases —
 * full hostnames or trailing-port forms. Anything matching this in a
 * URL means the link is useless to a reader and gets dropped entirely.
 */
const LOCALHOST_HOST_RE = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i;

/** Full localhost URL match — used to delete bare instances of the URL. */
const LOCALHOST_URL_RE =
	/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s]*)?/gi;

/**
 * Strip markdown formatting characters while preserving the underlying
 * text. Conservative: only the syntactic tokens are removed; any text
 * inside emphasis spans, link labels, or headings is kept.
 *
 * Order matters here:
 *   1. Headings first — entire leading `#` markers go.
 *   2. Code spans before emphasis — `` `**foo**` `` shouldn't have its
 *      asterisks consumed before the backticks are stripped.
 *   3. Localhost-link deletion before generic link unwrap, so the label
 *      is dropped along with the URL when the destination is unusable.
 *   4. Bare localhost URLs after, in case any survived without a label.
 *   5. Generic links last — `[label](url)` → `label`.
 */
export function stripMarkdownFormatting(input: string): string {
	if (!input) return '';
	let out = input;

	// Drop heading markers (line-level)
	out = out.replace(/^#{1,6}\s+/gm, '');

	// Inline code first
	out = out.replace(/`([^`\n]+)`/g, '$1');

	// Strikethrough
	out = out.replace(/~~([^~\n]+)~~/g, '$1');

	// Bold (**foo**, __foo__)
	out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1');
	out = out.replace(/__([^_\n]+)__/g, '$1');

	// Italic (*foo*, _foo_) — restrict to forms unlikely to collide with
	// regular punctuation usage. Underscore variant only when bordered by
	// whitespace/start/end so we don't break snake_case identifiers.
	out = out.replace(/(?<![*\w])\*([^\s*][^*\n]*?[^\s*])\*(?!\w)/g, '$1');
	out = out.replace(/(?<![\w_])_([^\s_][^_\n]*?[^\s_])_(?!\w)/g, '$1');

	// Drop links whose destination is localhost/loopback entirely —
	// label and URL both gone, since the reader can't follow them.
	out = out.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
		if (LOCALHOST_HOST_RE.test(url)) return '';
		// Otherwise unwrap to the label text.
		return label;
	});

	// Bare localhost URLs (no markdown wrapper) — drop.
	out = out.replace(LOCALHOST_URL_RE, '');

	// Blockquote markers
	out = out.replace(/^>\s+/gm, '');

	// Collapse double-dashes to a single hyphen. The PDF font doesn't
	// render en/em dashes (sanitizeForPdf strips them), so a single ASCII
	// hyphen is the cleanest outcome for ranges like "1--2".
	out = out.replace(/-{2,}/g, '-');

	// Collapse runs of internal whitespace within a line, but preserve
	// newlines so paragraphs stay readable.
	out = out.replace(/[ \t]+/g, ' ');

	// Collapse triple+ blank lines to a single blank line.
	out = out.replace(/\n{3,}/g, '\n\n');

	return out.trim();
}

// ─── Per-line cleaners ────────────────────────────────────────────

/**
 * Clean a single ingredient string. Strips markdown, leading bullets,
 * accidental leading numbers (when an author wrote "1. flour" inside a
 * bulleted list), and collapses whitespace.
 */
export function cleanIngredientLine(raw: string): string {
	return stripMarkdownFormatting(raw)
		.replace(/^[-*•]\s+/, '')
		.replace(/^\d+[.)]\s+/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Clean a single direction step. Strips markdown, leading numbers /
 * bullets that survived the parser, and collapses whitespace.
 */
export function cleanDirectionLine(raw: string): string {
	return stripMarkdownFormatting(raw)
		.replace(/^\d+[.)]\s+/, '')
		.replace(/^[-*•]\s+/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// ─── Placeholder detection ────────────────────────────────────────

/**
 * Phrases that pretend to be a direction step but carry no information.
 * Conservative — only matches the entire stripped step, not a substring,
 * and only when paired with very short content (so "See above for the
 * dressing" still survives).
 */
const PLACEHOLDER_DIRECTION_RE =
	/^(?:see\s+above|see\s+notes?|n\/?a|tbd|tba|to\s+do|coming\s+soon|same\s+as\s+above)\.?$/i;

/**
 * A direction step is "placeholder" when it's short AND its trimmed text
 * matches one of the known placeholder phrases. The length cap prevents
 * legitimate one-step recipes (rare but possible) from being suppressed.
 */
export function isPlaceholderDirection(step: string): boolean {
	const t = step.trim().replace(/^\d+[.)]?\s*/, '');
	if (t.length > 24) return false;
	return PLACEHOLDER_DIRECTION_RE.test(t);
}

// ─── Notes cleanup ────────────────────────────────────────────────

/**
 * Strip embedded ingredient / direction sub-blocks from a notes string.
 * Without this, a Chef's notes block that contains `## Ingredients` as
 * an inline sub-heading (or any author reference to those sections)
 * causes the renderer to print the same content twice — once via the
 * structured ingredients list and again as part of the notes.
 *
 * Only runs the strip when the structured equivalent is present, so a
 * notes-only recipe (no parsed ingredients) keeps its content intact as
 * the fallback path.
 */
export function stripDuplicateRecipeBlocks(
	notes: string,
	hasIngredients: boolean,
	hasDirections: boolean
): string {
	let out = notes;
	if (hasIngredients) {
		// Match `## Ingredients` (any header level) up to the next header
		// of any level OR the end of input.
		out = out.replace(/^#{1,6}\s*ingredients\b[\s\S]*?(?=^#{1,6}\s|\Z)/gim, '');
	}
	if (hasDirections) {
		out = out.replace(/^#{1,6}\s*directions\b[\s\S]*?(?=^#{1,6}\s|\Z)/gim, '');
		// Also catch the "Steps" / "Method" variants that some recipes use.
		out = out.replace(/^#{1,6}\s*(?:steps|method)\b[\s\S]*?(?=^#{1,6}\s|\Z)/gim, '');
	}
	return out;
}

/**
 * Full notes cleanup. Strips duplicate sub-blocks first (otherwise the
 * heading marker would already be removed by stripMarkdownFormatting and
 * we'd have no anchor to match against), then runs the general markdown
 * cleanup.
 */
export function cleanNotesBlock(
	notes: string | undefined,
	hasIngredients: boolean,
	hasDirections: boolean
): string {
	if (!notes) return '';
	const dedup = stripDuplicateRecipeBlocks(notes, hasIngredients, hasDirections);
	return stripMarkdownFormatting(dedup);
}

// ─── Public entry point ───────────────────────────────────────────

/**
 * Normalize an NDKEvent into a print-ready CookbookRecipe. Replaces the
 * inline shape-only conversion previously in `recipeEventToCookbookRecipe`.
 *
 * Pipeline:
 *   1. Pull the basics from event tags (title, image, identity).
 *   2. Run `parseMarkdownForEditing` for structured fields.
 *   3. Clean each ingredient / direction line individually.
 *   4. Drop placeholder direction sets (single "see above" etc).
 *   5. Build cleaned chefNotes by stripping any embedded ingredient /
 *      direction sub-blocks, then running general markdown cleanup.
 */
export function normalizeRecipeForCookbook(
	event: NDKEvent,
	creatorName?: string
): CookbookRecipe {
	const tags = event.tags || [];
	const find = (name: string) => tags.find((t) => t[0] === name)?.[1];
	const rawTitle = find('title') || find('d') || 'Untitled recipe';
	const title = stripMarkdownFormatting(rawTitle).replace(/\s+/g, ' ').trim() || 'Untitled recipe';
	const image = find('image') || undefined;
	const dTag = find('d') || event.id || rawTitle;

	const parsed = parseMarkdownForEditing(event.content || '');
	const details = extractRecipeDetails(event.content || '');

	const ingredients = (parsed.ingredients || [])
		.map(cleanIngredientLine)
		.filter((s) => s.length > 0);

	let directions = (parsed.directions || [])
		.map(cleanDirectionLine)
		.filter((s) => s.length > 0);

	// Single-placeholder direction set → drop entirely so the renderer
	// can show its "directions not included" message rather than printing
	// "1. See above" verbatim.
	if (directions.length <= 1 && directions.some(isPlaceholderDirection)) {
		directions = [];
	}

	const chefNotes = cleanNotesBlock(parsed.chefNotes, ingredients.length > 0, directions.length > 0);

	return {
		id: `${event.kind ?? 30023}:${event.pubkey}:${dTag}`,
		title,
		image,
		creatorName,
		prepTime: parsed.information?.prepTime || details.prepTime || undefined,
		cookTime: parsed.information?.cookTime || details.cookTime || undefined,
		servings: parsed.information?.servings || details.servings || undefined,
		ingredients,
		directions,
		chefNotes: chefNotes || undefined
	};
}
