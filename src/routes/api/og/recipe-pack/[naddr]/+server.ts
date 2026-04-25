/**
 * Recipe Pack Open Graph card.
 *
 * Returns an SVG image at 1200x630 (standard og:image / Twitter
 * summary_large_image dimensions) showing pack title, recipe count,
 * creator, and a "RECIPE PACK" badge — branded so platforms that
 * surface link previews show this is a curated, zappable Recipe Pack
 * on Zap Cooking, not a generic recipe link.
 *
 * Image fallback chain:
 *   1. Pack `image` tag (cover)
 *   2. First-recipe image (when pack has no cover)
 *   3. Branded gradient backdrop (always works, no external fetch)
 *
 * Metadata fallback chain:
 *   - Title: pack title → "Recipe Pack on Zap Cooking"
 *   - Description: pack description → recipe-count line → generic copy
 *   - Recipe count line is hidden when zero
 *
 * Note: SVG og:image is supported by Slack, Discord, Telegram,
 * WhatsApp, iMessage, Signal. Twitter/X and Facebook prefer raster
 * formats; for those a follow-up to convert via @resvg/resvg-wasm or
 * Cloudflare Image Resizing would lift coverage to 100%.
 */

import type { RequestHandler } from './$types';
import { nip19 } from 'nostr-tools';
import {
	fetchPackMetadata,
	fetchRecipePreviews,
	fetchProfileMetadata
} from '$lib/recipePackOg.server';

const WIDTH = 1200;
const HEIGHT = 630;

// Brand
const COLOR_BG = '#0c0c0e';
const COLOR_BG_GRADIENT_FROM = '#1a1112';
const COLOR_BG_GRADIENT_TO = '#0c0c0e';
const COLOR_ORANGE = '#f97316';
const COLOR_AMBER = '#f59e0b';
const COLOR_TEXT = '#ffffff';
const COLOR_MUTED = '#cbd5e1';
const COLOR_DIM = '#94a3b8';

function escapeXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1).trimEnd() + '…';
}

/** Wrap a string into N lines of at most maxChars each, soft-breaking on spaces. */
function wrapLines(s: string, maxChars: number, maxLines: number): string[] {
	if (!s) return [];
	const words = s.split(/\s+/);
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		if (lines.length >= maxLines) break;
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length > maxChars) {
			if (current) {
				lines.push(current);
				current = word;
			} else {
				// Single word longer than maxChars
				lines.push(truncate(candidate, maxChars));
				current = '';
			}
		} else {
			current = candidate;
		}
	}
	if (current && lines.length < maxLines) lines.push(current);
	if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
		lines[lines.length - 1] = truncate(lines[lines.length - 1] + '…', maxChars);
	}
	return lines;
}

interface CardModel {
	title: string;
	description?: string;
	coverImage?: string;
	creatorName?: string;
	recipeCount: number;
	recipePreviews: { title: string; image?: string }[];
}

function renderCard(model: CardModel): string {
	const titleLines = wrapLines(model.title || 'Recipe Pack on Zap Cooking', 30, 2);
	const descLines = model.description
		? wrapLines(model.description, 80, 2)
		: [];
	const recipeLine =
		model.recipeCount > 0
			? `${model.recipeCount} ${model.recipeCount === 1 ? 'recipe' : 'recipes'} inside`
			: '';
	const previewNames = model.recipePreviews
		.slice(0, 3)
		.map((r) => truncate(r.title, 32))
		.filter(Boolean);

	const creator = model.creatorName ? truncate(model.creatorName, 28) : '';
	const cover = model.coverImage;

	// Layout: 1200x630
	// Left column (text): x=64, width=720 (about 60% of canvas)
	// Right column (cover): x=816, width=320, height=420 — vertical card
	const TEXT_X = 64;

	// Title baseline starts mid-card
	let cursorY = 280;
	const titleLineHeight = 64;
	const titleSize = 56;

	const titleSvg = titleLines
		.map((line, i) => {
			const y = cursorY + i * titleLineHeight;
			return `<text x="${TEXT_X}" y="${y}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="${titleSize}" font-weight="800" fill="${COLOR_TEXT}">${escapeXml(line)}</text>`;
		})
		.join('');
	cursorY += titleLines.length * titleLineHeight;

	// Description (smaller, 2 lines max)
	let descSvg = '';
	if (descLines.length) {
		cursorY += 12;
		const descSize = 22;
		const descLineHeight = 30;
		descSvg = descLines
			.map((line, i) => {
				const y = cursorY + i * descLineHeight;
				return `<text x="${TEXT_X}" y="${y}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="${descSize}" font-weight="400" fill="${COLOR_MUTED}">${escapeXml(line)}</text>`;
			})
			.join('');
		cursorY += descLines.length * descLineHeight;
	}

	// Preview recipe names (small)
	let previewSvg = '';
	if (previewNames.length) {
		cursorY += 16;
		const lineSize = 18;
		const lineHeight = 26;
		previewSvg = previewNames
			.map((name, i) => {
				const y = cursorY + i * lineHeight;
				return `
        <circle cx="${TEXT_X + 5}" cy="${y - 6}" r="3" fill="${COLOR_ORANGE}" />
        <text x="${TEXT_X + 18}" y="${y}" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="${lineSize}" font-weight="400" fill="${COLOR_DIM}">${escapeXml(name)}</text>`;
			})
			.join('');
		cursorY += previewNames.length * lineHeight;
	}

	// Recipe count + lightning, bottom-left of text column (above footer)
	const recipeCountY = HEIGHT - 96;
	const recipeCountSvg = recipeLine
		? `
    <g>
      <path d="M ${TEXT_X + 4} ${recipeCountY - 22} l 0 14 l -7 0 l 14 22 l 0 -14 l 7 0 z"
            fill="${COLOR_AMBER}" stroke="${COLOR_AMBER}" stroke-width="1" stroke-linejoin="round"/>
      <text x="${TEXT_X + 32}" y="${recipeCountY}" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="22" font-weight="600" fill="${COLOR_TEXT}">${escapeXml(recipeLine)}</text>
    </g>`
		: '';

	// "RECIPE PACK" pill, top-left
	const pillSvg = `
    <g transform="translate(64, 64)">
      <rect x="0" y="0" rx="22" ry="22" width="190" height="44" fill="${COLOR_ORANGE}" />
      <text x="22" y="29" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="800" fill="${COLOR_TEXT}" letter-spacing="2">RECIPE PACK</text>
    </g>`;

	// Top-right: zap-cooking wordmark
	const wordmarkSvg = `
    <text x="${WIDTH - 64}" y="92" text-anchor="end" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="700" fill="${COLOR_TEXT}">zap.cooking</text>`;

	// Cover image area on the right (vertical card style)
	const coverX = 816;
	const coverY = 130;
	const coverW = 320;
	const coverH = 380;
	const coverSvg = cover
		? `
    <defs>
      <clipPath id="coverClip">
        <rect x="${coverX}" y="${coverY}" width="${coverW}" height="${coverH}" rx="20" ry="20" />
      </clipPath>
    </defs>
    <rect x="${coverX}" y="${coverY}" width="${coverW}" height="${coverH}" rx="20" ry="20" fill="#222"/>
    <image href="${escapeXml(cover)}" x="${coverX}" y="${coverY}" width="${coverW}" height="${coverH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#coverClip)" />
    <rect x="${coverX}" y="${coverY}" width="${coverW}" height="${coverH}" rx="20" ry="20"
          fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1" />`
		: `
    <rect x="${coverX}" y="${coverY}" width="${coverW}" height="${coverH}" rx="20" ry="20"
          fill="url(#coverGrad)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    <text x="${coverX + coverW / 2}" y="${coverY + coverH / 2 + 16}" text-anchor="middle"
          font-family="Inter, system-ui, sans-serif" font-size="48" font-weight="900"
          fill="rgba(255,255,255,0.9)" letter-spacing="2">PACK</text>`;

	// Footer line — branding + zap callout
	const footerY = HEIGHT - 40;
	const creatorBlock = creator
		? `<text x="${TEXT_X}" y="${footerY}" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="500" fill="${COLOR_DIM}">by ${escapeXml(creator)}  <tspan fill="${COLOR_AMBER}" font-weight="700">·  Save it. Cook it. Zap the creator.</tspan></text>`
		: `<text x="${TEXT_X}" y="${footerY}" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="500" fill="${COLOR_DIM}">Curated on Zap Cooking  <tspan fill="${COLOR_AMBER}" font-weight="700">·  Save it. Cook it. Zap the creator.</tspan></text>`;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${COLOR_BG_GRADIENT_FROM}" />
        <stop offset="100%" stop-color="${COLOR_BG_GRADIENT_TO}" />
      </linearGradient>
      <linearGradient id="coverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${COLOR_ORANGE}" />
        <stop offset="100%" stop-color="${COLOR_AMBER}" />
      </linearGradient>
    </defs>

    <rect width="${WIDTH}" height="${HEIGHT}" fill="${COLOR_BG}" />
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bgGrad)" />

    ${pillSvg}
    ${wordmarkSvg}
    ${titleSvg}
    ${descSvg}
    ${previewSvg}
    ${recipeCountSvg}
    ${coverSvg}
    ${creatorBlock}
  </svg>`;
}

function fallbackBranded(): string {
	return renderCard({
		title: 'Recipe Pack on Zap Cooking',
		description: 'A zappable recipe collection curated on Zap Cooking.',
		recipeCount: 0,
		recipePreviews: []
	});
}

export const GET: RequestHandler = async ({ params }) => {
	const naddr = params.naddr;
	const headers = new Headers({
		'content-type': 'image/svg+xml; charset=utf-8',
		// Cache 1h at edge, 1h at client. Pack updates are rare; replaceable
		// events keep the same naddr so cache can stay warm.
		'cache-control': 'public, max-age=3600, s-maxage=3600'
	});

	let pointer: nip19.AddressPointer | null = null;
	try {
		if (naddr?.startsWith('naddr1')) {
			const decoded = nip19.decode(naddr);
			if (decoded.type === 'naddr') pointer = decoded.data as nip19.AddressPointer;
		}
	} catch {
		/* ignore */
	}
	if (!pointer) {
		return new Response(fallbackBranded(), { headers });
	}

	try {
		const meta = await fetchPackMetadata(pointer.pubkey, pointer.identifier, pointer.kind);
		if (!meta) {
			return new Response(fallbackBranded(), { headers });
		}

		// Resolve a cover image: pack image > first recipe with image.
		let cover = meta.image || undefined;
		let previews: { title: string; image?: string }[] = [];

		if (!cover && meta.recipeATags.length > 0) {
			previews = await fetchRecipePreviews(meta.recipeATags, 4);
			cover = previews.find((r) => r.image)?.image;
		} else if (meta.recipeATags.length > 0) {
			// Pack has its own cover; still fetch a few previews for the names.
			previews = await fetchRecipePreviews(meta.recipeATags, 4);
		}

		// Resolve creator name (best-effort; tolerate failure)
		let creatorName: string | undefined;
		try {
			const profile = await fetchProfileMetadata(meta.creatorPubkey);
			creatorName = profile.display_name || profile.name;
		} catch {
			/* ignore */
		}

		const svg = renderCard({
			title: meta.title || 'Recipe Pack on Zap Cooking',
			description: meta.description || undefined,
			coverImage: cover,
			creatorName,
			recipeCount: meta.recipeCount,
			recipePreviews: previews
		});

		return new Response(svg, { headers });
	} catch (e) {
		console.error('[og recipe-pack] generation failed', e);
		return new Response(fallbackBranded(), { headers });
	}
};
