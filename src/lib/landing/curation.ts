/**
 * The org key's NIP-51 lists that curate the /explore landing page.
 * Pure (no network): parsing, validation, and the Recipe Pack guard.
 *
 * One list per slot, tag order = display order:
 *   30004 d=explore-hero    `a` refs: 1st = cover, next = picks
 *   30004 d=explore-reads   `a` refs: food reads
 *   30015 d=explore-topics  `t` tags: topic slugs
 *   30000 d=feed-foodies    `p` tags: cooks (also the feed relay's trust list).
 *       It holds far more cooks than the page shows (12), so the page shows a
 *       window that starts one cook later each UTC day and wraps: list order
 *       is kept within the window (rotateDaily), everyone gets a turn.
 */

/** zap.cooking's org pubkey (the `_` NIP-05 name). */
export const ORG_PUBKEY = '319ad3e790634dbe86f14db9c2995b26ee3c6228be55f89c4c7fea9acc01d50a';

export const EXPLORE_DTAG_PREFIX = 'explore-';

export const LANDING_LISTS = {
	hero: { kind: 30004, d: 'explore-hero' },
	reads: { kind: 30004, d: 'explore-reads' },
	topics: { kind: 30015, d: 'explore-topics' },
	cooks: { kind: 30000, d: 'feed-foodies' }
} as const;

export type LandingListName = keyof typeof LANDING_LISTS;

/**
 * Kind 30004 is also the Recipe Pack kind. The landing lists are curation,
 * not packs: Recipe Pack code drops any `explore-*` d-tag.
 */
export function isExploreCurationDTag(d: string | undefined | null): boolean {
	return typeof d === 'string' && d.startsWith(EXPLORE_DTAG_PREFIX);
}

export interface ListEventLike {
	pubkey: string;
	kind: number;
	created_at: number;
	tags: string[][];
}

export function dTag(e: Pick<ListEventLike, 'tags'>): string | undefined {
	return e.tags.find((t) => t[0] === 'd')?.[1];
}

/**
 * The newest event that is the named list: exact org pubkey, kind and d-tag,
 * and `verify` passes (signature). Null when none qualifies.
 */
export function pickList<E extends ListEventLike>(
	events: E[],
	name: LandingListName,
	verify: (e: E) => boolean
): E | null {
	const { kind, d } = LANDING_LISTS[name];
	let best: E | null = null;
	for (const e of events) {
		if (e.pubkey !== ORG_PUBKEY || e.kind !== kind || dTag(e) !== d) continue;
		if (best && e.created_at <= best.created_at) continue;
		if (!verify(e)) continue;
		best = e;
	}
	return best;
}

export interface Coordinate {
	kind: number;
	pubkey: string;
	identifier: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** `30023:<pubkey>:<d>` → coordinate (the d-tag may contain colons). */
export function parseCoordinate(a: string | undefined): Coordinate | null {
	if (!a) return null;
	const first = a.indexOf(':');
	const second = a.indexOf(':', first + 1);
	if (first < 1 || second < 0) return null;
	const kind = Number(a.slice(0, first));
	const pubkey = a.slice(first + 1, second).toLowerCase();
	const identifier = a.slice(second + 1);
	if (!Number.isInteger(kind) || !HEX64.test(pubkey) || !identifier) return null;
	return { kind, pubkey, identifier };
}

export function coordinateKey(c: Coordinate): string {
	return `${c.kind}:${c.pubkey}:${c.identifier}`;
}

/** Long-form kinds a landing card can show (recipes and articles). */
export const CARD_KINDS = [30023, 35000];

/** `a` refs in tag order: valid long-form coordinates, first occurrence only. */
export function listCoordinates(e: Pick<ListEventLike, 'tags'>): Coordinate[] {
	const seen = new Set<string>();
	const out: Coordinate[] = [];
	for (const t of e.tags) {
		if (t[0] !== 'a') continue;
		const c = parseCoordinate(t[1]);
		if (!c || !CARD_KINDS.includes(c.kind)) continue;
		const key = coordinateKey(c);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(c);
	}
	return out;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `t` tags in tag order: lower-case slugs, first occurrence only. */
export function listTopicSlugs(e: Pick<ListEventLike, 'tags'>): string[] {
	const out: string[] = [];
	for (const t of e.tags) {
		if (t[0] !== 't') continue;
		const s = (t[1] || '').trim().toLowerCase();
		if (SLUG.test(s) && !out.includes(s)) out.push(s);
	}
	return out;
}

/** `p` tags in tag order: hex pubkeys, first occurrence only. */
export function listPubkeys(e: Pick<ListEventLike, 'tags'>): string[] {
	const out: string[] = [];
	for (const t of e.tags) {
		if (t[0] !== 'p') continue;
		const pk = (t[1] || '').toLowerCase();
		if (HEX64.test(pk) && !out.includes(pk)) out.push(pk);
	}
	return out;
}
