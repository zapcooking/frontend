/**
 * Turning relay events into /explore landing cards (pure, no network).
 * Cards carry raw image URLs; the page sizes them (responsiveImg).
 */

import { nip19 } from 'nostr-tools';
import { RECIPE_TAGS, isHiddenRecipeATag } from '$lib/consts';
import { imageRoute } from '$lib/imageOptimizer';
import type { NostrEvent } from './relayCollect.server';

export interface CardAuthor {
	pubkey: string;
	name?: string;
	picture?: string;
}

/** A recipe or a long-form article. */
export interface LongformCard {
	type: 'recipe' | 'article';
	/** `30023:<pubkey>:<d>`, for de-duplication. */
	coordinate: string;
	href: string;
	title: string;
	summary?: string;
	image: string;
	author: CardAuthor;
	publishedAt: number;
}

export interface NoteCard {
	id: string;
	href: string;
	text: string;
	image: string;
	author: CardAuthor;
	createdAt: number;
}

export interface Cook {
	pubkey: string;
	href: string;
	name: string;
	picture?: string;
	about?: string;
}

export interface TopicTile {
	slug: string;
	name: string;
	/** Posts in the last 14 days; null when too small to show. */
	count: number | null;
	image: string;
	href: string;
}

const tag = (e: Pick<NostrEvent, 'tags'>, name: string) =>
	e.tags.find((t) => t[0] === name)?.[1]?.trim() || undefined;

const IMAGE_URL = /https?:\/\/[^\s<>"')\]]+?\.(?:jpe?g|png|webp|avif|gif)(?:\?[^\s<>"')\]]*)?/i;

function httpsUrl(u: string | undefined): string | undefined {
	if (!u) return undefined;
	try {
		const url = new URL(u);
		return url.protocol === 'https:' ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

/** The first image of an event: `image` tag, then `imeta url`, then the content. */
export function eventImage(e: Pick<NostrEvent, 'tags' | 'content'>): string | undefined {
	const fromTag = httpsUrl(tag(e, 'image'));
	if (fromTag) return fromTag;
	for (const t of e.tags) {
		if (t[0] !== 'imeta') continue;
		const url = t.find((p) => p.startsWith('url '))?.slice(4);
		const ok = httpsUrl(url);
		if (ok) return ok;
	}
	return httpsUrl(e.content.match(IMAGE_URL)?.[0]);
}

/** A host the routing table resizes quickly (Cloudflare zone or native params). */
export function isFastResizeImage(url: string): boolean {
	const r = imageRoute(url);
	return r === 'cloudflare' || r === 'native';
}

export function isRecipeEvent(e: Pick<NostrEvent, 'kind' | 'tags'>): boolean {
	if (e.kind === 35000) return true;
	if (e.kind !== 30023) return false;
	return e.tags.some((t) => t[0] === 't' && RECIPE_TAGS.includes((t[1] || '').toLowerCase()));
}

function naddr(e: NostrEvent, d: string): string | null {
	try {
		return nip19.naddrEncode({ kind: e.kind, pubkey: e.pubkey, identifier: d });
	} catch {
		return null;
	}
}

function clip(s: string, max: number): string {
	const t = s.replace(/\s+/g, ' ').trim();
	if (t.length <= max) return t;
	const cut = t.slice(0, max - 1);
	const sp = cut.lastIndexOf(' ');
	return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** A recipe/article card, or null when it can't be shown (no title, no image, hidden). */
export function longformCard(e: NostrEvent): LongformCard | null {
	if (e.kind !== 30023 && e.kind !== 35000) return null;
	const d = tag(e, 'd');
	if (!d) return null;
	const coordinate = `${e.kind}:${e.pubkey}:${d}`;
	if (isHiddenRecipeATag(coordinate)) return null;
	if (e.tags.some((t) => t[0] === 'content-warning')) return null;
	const title = tag(e, 'title');
	const image = eventImage(e);
	const link = naddr(e, d);
	if (!title || !image || !link) return null;
	const recipe = isRecipeEvent(e);
	const summary = tag(e, 'summary');
	const published = Number(tag(e, 'published_at'));
	return {
		type: recipe ? 'recipe' : 'article',
		coordinate,
		href: recipe ? `/recipe/${link}` : `/reads/${link}`,
		title: clip(title, 120),
		summary: summary ? clip(summary, 200) : undefined,
		image,
		author: { pubkey: e.pubkey },
		publishedAt: Number.isFinite(published) && published > 0 ? published : e.created_at
	};
}

const NOSTR_REF = /nostr:[a-z0-9]+/gi;
const URL_ANY = /https?:\/\/\S+/g;

/** A Fresh post card: a kind 1 note with a photo that isn't a reply. */
export function noteCard(e: NostrEvent): NoteCard | null {
	if (e.kind !== 1) return null;
	if (e.tags.some((t) => t[0] === 'e')) return null; // replies and quote threads
	if (e.tags.some((t) => t[0] === 'content-warning')) return null;
	const image = eventImage(e);
	if (!image) return null;
	let href: string;
	try {
		href = `/${nip19.noteEncode(e.id)}`;
	} catch {
		return null;
	}
	const text = clip(e.content.replace(URL_ANY, '').replace(NOSTR_REF, ''), 140);
	return { id: e.id, href, text, image, author: { pubkey: e.pubkey }, createdAt: e.created_at };
}

export interface Profile {
	name?: string;
	picture?: string;
	about?: string;
}

/** Kind 0 content → name/picture/about (display_name first). */
export function parseProfile(e: Pick<NostrEvent, 'content'>): Profile {
	try {
		const p = JSON.parse(e.content) as Record<string, unknown>;
		const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
		const name = str(p.display_name) || str(p.displayName) || str(p.name);
		return {
			name: name ? clip(name, 60) : undefined,
			picture: httpsUrl(str(p.picture)),
			about: str(p.about) ? clip(str(p.about)!, 140) : undefined
		};
	} catch {
		return {};
	}
}

/** Newest kind 0 per pubkey. */
export function newestProfiles(events: NostrEvent[]): Map<string, Profile> {
	const newest = new Map<string, NostrEvent>();
	for (const e of events) {
		if (e.kind !== 0) continue;
		const cur = newest.get(e.pubkey);
		if (!cur || e.created_at > cur.created_at) newest.set(e.pubkey, e);
	}
	return new Map([...newest].map(([pk, e]) => [pk, parseProfile(e)]));
}

export function userHref(pubkey: string): string {
	try {
		return `/user/${nip19.npubEncode(pubkey)}`;
	} catch {
		return `/user/${pubkey}`;
	}
}

/** Newest version per coordinate (replaceable events). */
export function newestByCoordinate(events: NostrEvent[]): NostrEvent[] {
	const by = new Map<string, NostrEvent>();
	for (const e of events) {
		const d = tag(e, 'd');
		if (!d) continue;
		const key = `${e.kind}:${e.pubkey}:${d}`;
		const cur = by.get(key);
		if (!cur || e.created_at > cur.created_at) by.set(key, e);
	}
	return [...by.values()];
}

/** At most `perAuthor` items per author, order kept. */
export function capPerAuthor<T extends { author: CardAuthor }>(items: T[], perAuthor: number): T[] {
	const n = new Map<string, number>();
	return items.filter((it) => {
		const c = n.get(it.author.pubkey) ?? 0;
		n.set(it.author.pubkey, c + 1);
		return c < perAuthor;
	});
}

/**
 * Cover + picks from the editor's candidates (in list order). The cover is
 * the first candidate whose photo is on a fast-resize host; when the
 * editor's first choice isn't, the next valid one is promoted and the rest
 * keep their order as picks. `fallback` fills an empty cover and short picks.
 * With no fast photo anywhere the cover is null (the page shows its static
 * editorial cover) and the candidates still fill the picks.
 */
export function chooseCover(
	candidates: LongformCard[],
	fallback: LongformCard[],
	picks = 2
): { cover: LongformCard | null; picks: LongformCard[] } {
	const seen = new Set<string>();
	const pool = [...candidates, ...fallback].filter((c) => {
		if (seen.has(c.coordinate)) return false;
		seen.add(c.coordinate);
		return true;
	});
	const coverIdx = pool.findIndex((c) => isFastResizeImage(c.image));
	if (coverIdx < 0) return { cover: null, picks: pool.slice(0, picks) };
	const cover = pool[coverIdx];
	const rest = pool.filter((_, i) => i !== coverIdx);
	return { cover, picks: rest.slice(0, picks) };
}

/** A day-stable window of `n` items starting at day % length (UTC days). */
export function rotateDaily<T>(items: T[], n: number, nowSec: number): T[] {
	if (items.length <= n) return items.slice();
	const day = Math.floor(nowSec / 86400);
	const start = day % items.length;
	return [...items.slice(start), ...items.slice(0, start)].slice(0, n);
}
