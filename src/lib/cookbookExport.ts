/**
 * Recipe Pack → printable cookbook PDF.
 *
 * Client-side generator. jsPDF is heavy (~150KB gzipped) and only
 * used by Pro members on demand, so the dependency is dynamically
 * imported at call time — no impact on the rest of the app's bundle.
 *
 * Layout (single style for v1; the modal exposes a style selector
 * with the other options TODO'd):
 *
 *     Page 1     — Cover
 *     Page 2     — Table of contents
 *     Page 3     — Introduction (optional, AI-polished or raw)
 *     Page 4..N  — Recipes (one starts a new page; soft-flows over
 *                  multiple pages if long)
 *
 * Image rendering uses a fetch-then-base64 path. CORS failures are
 * tolerated — the recipe page just renders without its image.
 *
 * Caller passes already-resolved recipe events (parsed metadata).
 * Returns the PDF as a Blob and a small report of any per-recipe
 * failures so the UI can surface a "X of Y included" notice.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { extractRecipeDetails, parseMarkdownForEditing } from '$lib/parser';

export interface CookbookRecipe {
	id: string; // a-tag for stable identity
	title: string;
	image?: string;
	creatorName?: string;
	prepTime?: string;
	cookTime?: string;
	servings?: string;
	ingredients: string[];
	directions: string[];
	chefNotes?: string;
}

export interface BuildOptions {
	title: string;
	subtitle?: string;
	coverImage?: string;
	creatorName?: string;
	introduction?: string; // markdown / plain text — light formatting only
	recipes: CookbookRecipe[];
	includeCover: boolean;
	includeToc: boolean;
	includeImages: boolean;
	includeIntroduction: boolean;
	style: 'classic' | 'modern' | 'simple'; // v1 only renders 'modern'
}

export interface BuildResult {
	blob: Blob;
	included: number;
	skipped: { id: string; reason: string }[];
}

/** Convert an NDKEvent (kind 30023) to the parsed CookbookRecipe shape. */
export function recipeEventToCookbookRecipe(event: NDKEvent, creatorName?: string): CookbookRecipe {
	const tags = event.tags || [];
	const find = (name: string) => tags.find((t) => t[0] === name)?.[1];
	const title = find('title') || find('d') || 'Untitled recipe';
	const image = find('image') || undefined;
	const dTag = find('d') || event.id || title;

	const parsed = parseMarkdownForEditing(event.content || '');
	const details = extractRecipeDetails(event.content || '');

	return {
		id: `${event.kind ?? 30023}:${event.pubkey}:${dTag}`,
		title,
		image,
		creatorName,
		prepTime: parsed.information?.prepTime || details.prepTime || undefined,
		cookTime: parsed.information?.cookTime || details.cookTime || undefined,
		servings: parsed.information?.servings || details.servings || undefined,
		ingredients: parsed.ingredients || [],
		directions: parsed.directions || [],
		chefNotes: parsed.chefNotes
	};
}

/** Strip emoji + control chars jsPDF's default fonts can't render. */
function sanitizeForPdf(s: string | undefined | null): string {
	if (!s) return '';
	// Replace common cooking glyphs with words rather than dropping them
	let out = s
		.replace(/⏲️|⏱️/g, '')
		.replace(/🍳/g, '')
		.replace(/🍽️|🍽/g, '')
		.replace(/🔥/g, '')
		.replace(/—/g, '-')
		.replace(/–/g, '-')
		.replace(/'|'/g, "'")
		.replace(/"|"/g, '"')
		.replace(/…/g, '...');
	// Drop anything still outside basic Latin-1 (jsPDF's default fonts
	// don't cover wider Unicode without bundling a custom font).
	out = out.replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');
	return out.trim();
}

/** Fetch an image URL and return as data URI. Returns null on CORS / 404. */
async function imageUrlToDataUri(url: string, signal?: AbortSignal): Promise<string | null> {
	try {
		const res = await fetch(url, { signal, mode: 'cors' });
		if (!res.ok) return null;
		const blob = await res.blob();
		// Cap image size to keep the PDF reasonable. 5MB raw is a rough
		// upper bound; most recipe photos are 200-800KB.
		if (blob.size > 5 * 1024 * 1024) return null;
		const reader = new FileReader();
		return await new Promise((resolve) => {
			reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
			reader.onerror = () => resolve(null);
			reader.readAsDataURL(blob);
		});
	} catch {
		return null;
	}
}

/** Detect image format from a data URI for jsPDF's addImage signature. */
function imageFormatFromDataUri(dataUri: string): 'JPEG' | 'PNG' | 'WEBP' {
	if (dataUri.startsWith('data:image/png')) return 'PNG';
	if (dataUri.startsWith('data:image/webp')) return 'WEBP';
	return 'JPEG';
}

const PAGE_W = 612; // 8.5"
const PAGE_H = 792; // 11"
// Asymmetric margins — extra room on the left for a 3-ring binder gutter,
// so users who print + bind the cookbook don't lose text to the hole punch.
const MARGIN_LEFT = 88; // ~1.22"
const MARGIN_RIGHT = 56; // ~0.78"
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT;
// Visual centerline of the printable area (between the gutters), so
// "centered" content stays visually centered relative to the actual
// content area rather than the physical page edges.
const CENTER_X = (MARGIN_LEFT + (PAGE_W - MARGIN_RIGHT)) / 2;
// Aliases retained for ergonomic edge calls.
const CONTENT_RIGHT = PAGE_W - MARGIN_RIGHT;

/** Build the cookbook PDF. Returns blob + per-recipe failure list. */
export async function buildCookbookPdf(opts: BuildOptions): Promise<BuildResult> {
	// Lazy-load jsPDF so it's only in the bundle when this function is
	// actually called (Pro members exporting a cookbook).
	const { jsPDF } = await import('jspdf');

	const doc = new jsPDF({
		unit: 'pt',
		format: [PAGE_W, PAGE_H],
		orientation: 'portrait',
		compress: true
	});

	const skipped: { id: string; reason: string }[] = [];

	// Pre-resolve images in parallel — failures fall through to "no image"
	// and we keep generating. Skip entirely when includeImages is off.
	const coverImagePromise =
		opts.includeCover && opts.coverImage ? imageUrlToDataUri(opts.coverImage) : Promise.resolve(null);
	const recipeImagePromises = opts.recipes.map((r) =>
		opts.includeImages && r.image ? imageUrlToDataUri(r.image) : Promise.resolve(null)
	);
	// Brand mark — same-origin fetch from /icon.png. If it 404s or fetch
	// fails we just render text-only branding, which is the v0 behavior.
	const brandLogoPromise = imageUrlToDataUri('/icon.png');
	const [coverDataUri, brandLogoDataUri, ...recipeImages] = await Promise.all([
		coverImagePromise,
		brandLogoPromise,
		...recipeImagePromises
	]);

	// First record where each recipe starts so we can write page numbers
	// into the TOC later.
	const recipePageStart: number[] = new Array(opts.recipes.length).fill(0);

	// === Page 1: Cover ===
	if (opts.includeCover) {
		drawCoverPage(doc, {
			title: sanitizeForPdf(opts.title),
			subtitle: sanitizeForPdf(opts.subtitle),
			creatorName: sanitizeForPdf(opts.creatorName),
			coverDataUri,
			recipeCount: opts.recipes.length,
			brandLogoDataUri
		});
	}

	// === Page 2: Table of Contents ===
	let tocPage = 0;
	if (opts.includeToc) {
		if (opts.includeCover) doc.addPage();
		tocPage = doc.getCurrentPageInfo().pageNumber;
		// Draw a placeholder TOC; we'll re-render it after we know page numbers.
		drawTocPage(
			doc,
			opts.recipes.map((r) => sanitizeForPdf(r.title)),
			recipePageStart
		);
	}

	// === Introduction ===
	if (opts.includeIntroduction && opts.introduction && opts.introduction.trim()) {
		if (opts.includeCover || opts.includeToc) doc.addPage();
		drawIntroductionPage(doc, sanitizeForPdf(opts.introduction));
	}

	// === Recipe pages ===
	let included = 0;
	for (let i = 0; i < opts.recipes.length; i++) {
		const r = opts.recipes[i];
		const ingredientsClean = r.ingredients.map(sanitizeForPdf).filter(Boolean);
		const directionsClean = r.directions.map(sanitizeForPdf).filter(Boolean);

		if (ingredientsClean.length === 0 && directionsClean.length === 0) {
			skipped.push({ id: r.id, reason: 'no ingredients or directions' });
			continue;
		}

		if (i > 0 || opts.includeCover || opts.includeToc || opts.includeIntroduction) {
			doc.addPage();
		}
		recipePageStart[i] = doc.getCurrentPageInfo().pageNumber;
		drawRecipePages(doc, {
			title: sanitizeForPdf(r.title),
			creatorName: sanitizeForPdf(r.creatorName),
			prepTime: sanitizeForPdf(r.prepTime),
			cookTime: sanitizeForPdf(r.cookTime),
			servings: sanitizeForPdf(r.servings),
			imageDataUri: recipeImages[i] || null,
			ingredients: ingredientsClean,
			directions: directionsClean,
			chefNotes: sanitizeForPdf(r.chefNotes)
		});
		included++;
	}

	// === Re-render TOC now that we know page numbers ===
	if (opts.includeToc && tocPage > 0) {
		doc.setPage(tocPage);
		// Wipe by drawing a white rectangle over the page area.
		doc.setFillColor(255, 255, 255);
		doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
		drawTocPage(
			doc,
			opts.recipes.map((r, i) => (recipePageStart[i] > 0 ? sanitizeForPdf(r.title) : '')),
			recipePageStart
		);
	}

	// Add small "Created with Zap Cooking" footer to every page except cover
	const nonCoverStart = opts.includeCover ? 2 : 1;
	addFooters(doc, nonCoverStart);
	// Running header (pack title + brand mark) on every non-cover page
	addRunningHeaders(doc, sanitizeForPdf(opts.title), brandLogoDataUri, nonCoverStart);

	const blob = doc.output('blob') as unknown as Blob;
	return { blob, included, skipped };
}

/** Build a sensible filename from a pack title. */
export function cookbookFilename(packTitle: string): string {
	const slug = packTitle
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return `zap-cooking-${slug || 'recipe-pack'}-cookbook.pdf`;
}

// ===== Drawing helpers =====

interface JsPdfDoc {
	setFont: (font: string, style?: string) => void;
	setFontSize: (size: number) => void;
	setTextColor: (r: number, g: number, b: number) => void;
	setFillColor: (r: number, g: number, b: number) => void;
	setDrawColor: (r: number, g: number, b: number) => void;
	setLineWidth: (w: number) => void;
	text: (text: string | string[], x: number, y: number, opts?: any) => void;
	splitTextToSize: (text: string, maxWidth: number) => string[];
	addImage: (
		data: string,
		format: string,
		x: number,
		y: number,
		w: number,
		h: number,
		alias?: string
	) => void;
	addPage: () => void;
	rect: (x: number, y: number, w: number, h: number, style?: string) => void;
	line: (x1: number, y1: number, x2: number, y2: number) => void;
	getCurrentPageInfo: () => { pageNumber: number };
	getNumberOfPages: () => number;
	setPage: (n: number) => void;
}

function drawCoverPage(
	doc: JsPdfDoc,
	opts: {
		title: string;
		subtitle: string;
		creatorName: string;
		coverDataUri: string | null;
		recipeCount: number;
		brandLogoDataUri: string | null;
	}
) {
	// Page background — soft warm tint
	doc.setFillColor(252, 248, 243);
	doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

	// Cover image, if present, sits in a clean centered window in the
	// upper third — not edge-bleed and not page-dominating. Gives it a
	// "framed plate" feel and leaves room for typography.
	// Centered between the actual content margins (gutter-aware), so the
	// cover stays balanced even with the binder gutter offset.
	const coverWindowTop = MARGIN_TOP + 32;
	const coverWindowH = 280;
	const coverWindowW = CONTENT_W - 32;
	const coverWindowX = CENTER_X - coverWindowW / 2;

	if (opts.coverDataUri) {
		try {
			doc.addImage(
				opts.coverDataUri,
				imageFormatFromDataUri(opts.coverDataUri),
				coverWindowX,
				coverWindowTop,
				coverWindowW,
				coverWindowH
			);
		} catch {
			/* skip */
		}
	} else {
		// No image: tasteful empty frame so the page still looks intentional.
		doc.setDrawColor(220, 200, 190);
		doc.setLineWidth(1);
		doc.rect(coverWindowX, coverWindowTop, coverWindowW, coverWindowH);
	}

	// Title block sits in the lower third — gives the cover the feel of
	// a proper book jacket rather than a page with a photo on it.
	const titleY = coverWindowTop + coverWindowH + 80;

	// "RECIPE PACK" eyebrow with thin centered rule
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(10);
	doc.setTextColor(180, 95, 30);
	doc.text('A RECIPE PACK', CENTER_X, titleY - 38, { align: 'center', charSpace: 2 } as any);

	// Decorative rule under the eyebrow
	doc.setDrawColor(180, 95, 30);
	doc.setLineWidth(0.6);
	doc.line(CENTER_X - 18, titleY - 28, CENTER_X + 18, titleY - 28);

	// Title
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(38);
	doc.setTextColor(28, 22, 18);
	const titleLines = doc.splitTextToSize(opts.title || 'Recipe Pack', CONTENT_W * 0.92);
	doc.text(titleLines, CENTER_X, titleY, { align: 'center' });

	let cursorY = titleY + titleLines.length * 40;

	// Subtitle (italic for a published-cookbook feel)
	if (opts.subtitle) {
		cursorY += 12;
		doc.setFont('helvetica', 'italic');
		doc.setFontSize(13);
		doc.setTextColor(80, 70, 65);
		const subLines = doc.splitTextToSize(opts.subtitle, CONTENT_W * 0.8);
		doc.text(subLines, CENTER_X, cursorY, { align: 'center' });
		cursorY += subLines.length * 18;
	}

	// Recipe count badge
	if (opts.recipeCount > 0) {
		cursorY += 10;
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(11);
		doc.setTextColor(140, 130, 125);
		const noun = opts.recipeCount === 1 ? 'recipe' : 'recipes';
		doc.text(`${opts.recipeCount} ${noun}`, CENTER_X, cursorY, { align: 'center' });
	}

	// Creator
	if (opts.creatorName) {
		doc.setFont('helvetica', 'italic');
		doc.setFontSize(12);
		doc.setTextColor(100, 90, 85);
		doc.text(`Curated by ${opts.creatorName}`, CENTER_X, PAGE_H - 92, { align: 'center' });
	}

	// Brand mark — small logo sits above the wordmark, then a thin
	// separator rule, then the "Created with Zap Cooking" line. Whole
	// stack stays in the bottom 90pt so it reads as a publisher mark.
	if (opts.brandLogoDataUri) {
		try {
			const logoSize = 26;
			doc.addImage(
				opts.brandLogoDataUri,
				imageFormatFromDataUri(opts.brandLogoDataUri),
				CENTER_X - logoSize / 2,
				PAGE_H - 96,
				logoSize,
				logoSize,
				'zc-brand'
			);
		} catch {
			// Logo couldn't render — just fall back to the text wordmark.
		}
	}

	doc.setFont('helvetica', 'bold');
	doc.setFontSize(10);
	doc.setTextColor(180, 95, 30);
	doc.text('zap.cooking', CENTER_X, PAGE_H - 60, { align: 'center', charSpace: 1 } as any);
	doc.setFont('helvetica', 'normal');
	doc.setFontSize(9);
	doc.setTextColor(140, 130, 125);
	doc.text('Created with Zap Cooking', CENTER_X, PAGE_H - 46, { align: 'center' });
}

function drawTocPage(doc: JsPdfDoc, titles: string[], pageNumbers: number[]) {
	doc.setFillColor(255, 255, 255);
	doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

	// Eyebrow
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.setTextColor(180, 95, 30);
	doc.text('TABLE OF CONTENTS', MARGIN_LEFT, 92, { charSpace: 2 } as any);

	// Heading
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(28);
	doc.setTextColor(28, 22, 18);
	doc.text('Contents', MARGIN_LEFT, 124);

	// Heading rule
	doc.setDrawColor(220, 200, 190);
	doc.setLineWidth(0.8);
	doc.line(MARGIN_LEFT, 138, CONTENT_RIGHT, 138);

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(12);
	doc.setTextColor(40, 30, 25);

	let y = 176;
	const rowHeight = 22;
	const pageColX = CONTENT_RIGHT;
	const titleMaxW = CONTENT_W - 56; // leaves room for the page number

	for (let i = 0; i < titles.length; i++) {
		const title = titles[i];
		if (!title) continue;
		const pageStr = pageNumbers[i] > 0 ? String(pageNumbers[i]) : '';

		// Long titles wrap to a second line; we keep the page number on the
		// last line so the dot leaders read naturally.
		const lines = doc.splitTextToSize(title, titleMaxW);
		const lastLineIdx = lines.length - 1;

		for (let li = 0; li < lines.length; li++) {
			if (y > PAGE_H - 90) {
				// Overflow into a second TOC page if the pack is huge.
				doc.addPage();
				doc.setFillColor(255, 255, 255);
				doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(12);
				doc.setTextColor(40, 30, 25);
				y = MARGIN_TOP + 16;
			}
			doc.text(lines[li], MARGIN_LEFT, y);

			if (li === lastLineIdx && pageStr) {
				// Dot leaders between title end and page number
				const titleW = (doc as any).getTextWidth
					? (doc as any).getTextWidth(lines[li])
					: lines[li].length * 6;
				const pageW = (doc as any).getTextWidth
					? (doc as any).getTextWidth(pageStr)
					: pageStr.length * 6;
				const leaderStart = MARGIN_LEFT + titleW + 6;
				const leaderEnd = pageColX - pageW - 6;
				if (leaderEnd > leaderStart) {
					doc.setTextColor(200, 190, 185);
					const dotW = (doc as any).getTextWidth ? (doc as any).getTextWidth('.') : 3;
					const space = Math.max(3, dotW + 2);
					let dx = leaderStart;
					while (dx < leaderEnd) {
						doc.text('.', dx, y);
						dx += space;
					}
					doc.setTextColor(40, 30, 25);
				}
				doc.text(pageStr, pageColX, y, { align: 'right' });
			}
			y += rowHeight;
		}
	}
}

function drawIntroductionPage(doc: JsPdfDoc, intro: string) {
	doc.setFillColor(255, 255, 255);
	doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

	// Eyebrow
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(9);
	doc.setTextColor(180, 95, 30);
	doc.text('INTRODUCTION', CENTER_X, 110, { align: 'center', charSpace: 2 } as any);

	// Decorative rule
	doc.setDrawColor(180, 95, 30);
	doc.setLineWidth(0.6);
	doc.line(CENTER_X - 18, 122, CENTER_X + 18, 122);

	// Heading
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(28);
	doc.setTextColor(28, 22, 18);
	doc.text('A Note on This Pack', CENTER_X, 158, { align: 'center' });

	// Body — narrower measure for readability (~70 chars per line at 12pt)
	const colW = Math.min(CONTENT_W, 380);
	const colX = CENTER_X - colW / 2;

	doc.setFont('helvetica', 'normal');
	doc.setFontSize(12);
	doc.setTextColor(50, 40, 35);

	const paragraphs = intro.split(/\n\s*\n/);
	let y = 200;
	const lineH = 17;
	const paragraphGap = 12;
	for (const p of paragraphs) {
		const text = p.trim();
		if (!text) continue;
		const lines = doc.splitTextToSize(text, colW);
		for (const line of lines) {
			if (y > PAGE_H - 90) {
				doc.addPage();
				doc.setFillColor(255, 255, 255);
				doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(12);
				doc.setTextColor(50, 40, 35);
				y = MARGIN_TOP + 16;
			}
			doc.text(line, colX, y);
			y += lineH;
		}
		y += paragraphGap;
	}
}

function drawRecipePages(
	doc: JsPdfDoc,
	r: {
		title: string;
		creatorName: string;
		prepTime: string;
		cookTime: string;
		servings: string;
		imageDataUri: string | null;
		ingredients: string[];
		directions: string[];
		chefNotes: string;
	}
) {
	doc.setFillColor(255, 255, 255);
	doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

	const PAGE_BOTTOM = PAGE_H - 90;
	const PAGE_TOP = MARGIN_TOP + 16;

	// Continue onto a fresh page and reset to a known-safe state. Used by
	// the orphan-heading guards below.
	const newPage = (): number => {
		doc.addPage();
		doc.setFillColor(255, 255, 255);
		doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
		return PAGE_TOP;
	};

	let y = PAGE_TOP;

	// Title
	doc.setFont('helvetica', 'bold');
	doc.setFontSize(22);
	doc.setTextColor(28, 22, 18);
	const titleLines = doc.splitTextToSize(r.title || 'Recipe', CONTENT_W);
	doc.text(titleLines, MARGIN_LEFT, y);
	y += titleLines.length * 26;

	// Accent rule under the title
	doc.setDrawColor(180, 95, 30);
	doc.setLineWidth(1.2);
	doc.line(MARGIN_LEFT, y - 18, MARGIN_LEFT + 36, y - 18);

	// Creator attribution
	if (r.creatorName) {
		doc.setFont('helvetica', 'italic');
		doc.setFontSize(11);
		doc.setTextColor(110, 100, 95);
		doc.text(`by ${r.creatorName}`, MARGIN_LEFT, y);
		y += 16;
	}

	// Image — graceful fallthrough on addImage failure (e.g. malformed
	// data URI), keeping y where it was so the rest of the page reflows.
	if (r.imageDataUri) {
		y += 6;
		try {
			const imgW = CONTENT_W;
			const imgH = imgW * 0.55; // 16:9-ish
			doc.addImage(
				r.imageDataUri,
				imageFormatFromDataUri(r.imageDataUri),
				MARGIN_LEFT,
				y,
				imgW,
				imgH
			);
			y += imgH + 14;
		} catch {
			// Image failed: continue without consuming vertical space.
		}
	}

	// Servings + times row
	const meta = [
		r.servings ? `Serves ${r.servings}` : '',
		r.prepTime ? `Prep ${r.prepTime}` : '',
		r.cookTime ? `Cook ${r.cookTime}` : ''
	]
		.filter(Boolean)
		.join('   •   ');
	if (meta) {
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(10);
		doc.setTextColor(110, 100, 95);
		doc.text(meta, MARGIN_LEFT, y, { charSpace: 0.5 } as any);
		y += 20;
	}

	// Chef's notes (italic, indented quote-style)
	if (r.chefNotes) {
		y += 4;
		doc.setFont('helvetica', 'italic');
		doc.setFontSize(11);
		doc.setTextColor(85, 75, 70);
		// Subtle left rule
		const notesLines = doc.splitTextToSize(r.chefNotes, CONTENT_W - 18);
		const notesStartY = y;
		for (const line of notesLines) {
			if (y > PAGE_BOTTOM) {
				y = newPage();
				doc.setFont('helvetica', 'italic');
				doc.setFontSize(11);
				doc.setTextColor(85, 75, 70);
			}
			doc.text(line, MARGIN_LEFT + 14, y);
			y += 15;
		}
		// Draw the quote rule once at the end (covers wrapped lines).
		doc.setDrawColor(220, 200, 190);
		doc.setLineWidth(1.5);
		doc.line(MARGIN_LEFT + 2, notesStartY - 10, MARGIN_LEFT + 2, y - 10);
		y += 10;
	}

	const sectionHeading = (label: string) => {
		doc.setFont('helvetica', 'bold');
		doc.setFontSize(13);
		doc.setTextColor(180, 95, 30);
		doc.text(label.toUpperCase(), MARGIN_LEFT, y, { charSpace: 1.5 } as any);
		// thin rule across the column
		doc.setDrawColor(220, 200, 190);
		doc.setLineWidth(0.5);
		doc.line(MARGIN_LEFT, y + 6, CONTENT_RIGHT, y + 6);
		y += 22;
	};

	// Ingredients
	if (r.ingredients.length) {
		// Orphan-heading guard: the heading + at least 2 lines of body must
		// fit on the current page; otherwise start fresh.
		if (y > PAGE_BOTTOM - 60) {
			y = newPage();
		}
		y += 6;
		sectionHeading('Ingredients');
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(11);
		doc.setTextColor(40, 30, 25);
		for (const item of r.ingredients) {
			const lines = doc.splitTextToSize(item, CONTENT_W - 18);
			for (let i = 0; i < lines.length; i++) {
				if (y > PAGE_BOTTOM) {
					y = newPage();
					doc.setFont('helvetica', 'normal');
					doc.setFontSize(11);
					doc.setTextColor(40, 30, 25);
				}
				if (i === 0) {
					doc.setTextColor(180, 95, 30);
					doc.text('•', MARGIN_LEFT, y);
					doc.setTextColor(40, 30, 25);
				}
				doc.text(lines[i], MARGIN_LEFT + 14, y);
				y += 15;
			}
		}
		y += 10;
	}

	// Directions
	if (r.directions.length) {
		// Same orphan guard for the Directions heading.
		if (y > PAGE_BOTTOM - 60) {
			y = newPage();
		}
		y += 4;
		sectionHeading('Directions');
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(11);
		doc.setTextColor(40, 30, 25);
		for (let i = 0; i < r.directions.length; i++) {
			const step = r.directions[i];
			const numStr = `${i + 1}`;
			const lines = doc.splitTextToSize(step, CONTENT_W - 32);

			// Keep the step number with at least the first line of its body
			// to avoid a stranded number at page bottom.
			if (y > PAGE_BOTTOM - 18) {
				y = newPage();
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(11);
				doc.setTextColor(40, 30, 25);
			}

			doc.setFont('helvetica', 'bold');
			doc.setTextColor(180, 95, 30);
			doc.text(numStr, MARGIN_LEFT, y);
			doc.setFont('helvetica', 'normal');
			doc.setTextColor(40, 30, 25);

			for (let j = 0; j < lines.length; j++) {
				if (j > 0 && y > PAGE_BOTTOM) {
					y = newPage();
					doc.setFont('helvetica', 'normal');
					doc.setFontSize(11);
					doc.setTextColor(40, 30, 25);
				}
				doc.text(lines[j], MARGIN_LEFT + 28, y);
				y += 16;
			}
			y += 6;
		}
	}
}

function addFooters(doc: JsPdfDoc, fromPage: number) {
	const total = doc.getNumberOfPages();
	for (let p = fromPage; p <= total; p++) {
		doc.setPage(p);
		doc.setFont('helvetica', 'normal');
		doc.setFontSize(9);
		doc.setTextColor(160, 150, 145);
		doc.text('Created with Zap Cooking', CENTER_X, PAGE_H - 28, { align: 'center' });
		doc.text(String(p), CONTENT_RIGHT, PAGE_H - 28, { align: 'right' });
	}
}

/**
 * Subtle running header — pack title (left) + Zap Cooking logo (right),
 * with a hairline rule below. Skipped for the cover (which has its own
 * typography). Drawn after all pages exist so we iterate by page number.
 *
 * The logo is added with a stable alias ('zc-brand') so jsPDF dedupes
 * the image data across every page rather than embedding it N times.
 */
function addRunningHeaders(
	doc: JsPdfDoc,
	packTitle: string,
	brandLogoDataUri: string | null,
	fromPage: number
) {
	const trimmed = (packTitle || '').trim();
	if (!trimmed && !brandLogoDataUri) return;
	const total = doc.getNumberOfPages();
	const logoSize = 12;
	const logoFmt = brandLogoDataUri ? imageFormatFromDataUri(brandLogoDataUri) : 'PNG';
	for (let p = fromPage; p <= total; p++) {
		doc.setPage(p);
		if (trimmed) {
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(8);
			doc.setTextColor(160, 150, 145);
			// Truncate over-long titles so they don't collide with the logo.
			let label = trimmed;
			if (label.length > 50) label = label.slice(0, 47) + '...';
			doc.text(label, MARGIN_LEFT, 38, { charSpace: 1.5 } as any);
		}
		if (brandLogoDataUri) {
			try {
				doc.addImage(
					brandLogoDataUri,
					logoFmt,
					CONTENT_RIGHT - logoSize,
					30,
					logoSize,
					logoSize,
					'zc-brand'
				);
			} catch {
				// Logo failed — header text alone is enough.
			}
		}
		doc.setDrawColor(230, 220, 215);
		doc.setLineWidth(0.4);
		doc.line(MARGIN_LEFT, 46, CONTENT_RIGHT, 46);
	}
}
