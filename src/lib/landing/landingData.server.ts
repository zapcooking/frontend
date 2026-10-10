/**
 * The /explore landing page's data: one aggregate built from the feed
 * relay (anonymous, so the relay's own access rules apply), the relay's
 * NIP-11 topic counts, and public relays (the org's curation lists, cook
 * profiles, curated articles the feed relay doesn't hold).
 *
 * Cached apart from the page under one fixed key, so page URL variants
 * never multiply relay traffic. Stale data is served while a refresh runs
 * in the background; a failed or empty section keeps its last good
 * version. Nothing here throws.
 */

import { verifyEvent } from 'nostr-tools/pure';
import type { ReadsModerationLists } from '$lib/reads/moderationConfig';
import { evaluateReadsContent } from '$lib/reads/moderation';
import { FOOD_LONGFORM_HASHTAGS } from '$lib/foodHashtags';
import {
	collect,
	raceKeyed,
	unionKeyed,
	type Filter,
	type NostrEvent
} from './relayCollect.server';
import {
	LANDING_LISTS,
	ORG_PUBKEY,
	coordinateKey,
	dTag,
	listCoordinates,
	listPubkeys,
	listTopicSlugs,
	pickList,
	type Coordinate,
	type LandingListName
} from './curation';
import {
	capPerAuthor,
	chooseCover,
	eventImage,
	longformCard,
	newestByCoordinate,
	newestProfiles,
	noteCard,
	rotateDaily,
	userHref,
	type Cook,
	type LongformCard,
	type NoteCard,
	type Profile,
	type TopicTile
} from './content';

export const FEED_RELAY = 'wss://feed.zap.cooking';
export const FEED_RELAY_HTTP = 'https://feed.zap.cooking';
/** Where the org's lists live (the feed relay doesn't serve them). */
export const LIST_RELAYS = ['wss://relay.primal.net', 'wss://relay.snort.social', 'wss://nos.lol'];
/**
 * Curated hero recipes the feed relay doesn't hold. Never used for reads:
 * public-relay long-form search is where spam gets in, so reads come only
 * from the feed relay (trusted authors + its food rules).
 */
export const HERO_FALLBACK_RELAYS = ['wss://relay.primal.net', 'wss://nos.lol', 'wss://nostr.wine'];
/** Kind 0 for cooks and bylines (the feed relay's window hides older profiles). */
export const PROFILE_RELAYS = ['wss://purplepag.es', 'wss://relay.primal.net'];

/** The relay's free window (`FREE_WINDOW`), seconds. */
export const FREE_WINDOW_SECONDS = 14 * 24 * 60 * 60;
/**
 * Ask from a minute inside the window: a `since` even a second older than
 * the relay's floor makes it wait out its 1 s AUTH grace.
 */
export const SINCE_PAD_SECONDS = 60;
export const FRESH_KINDS = [1, 30023, 35000, 1068];
export const RECIPE_T_TAGS = ['zapcooking', 'nostrcooking'];

/** Fresh enough to serve without a refresh. */
export const FRESH_FOR_MS = 120_000;
/** Each network round's hard cap. */
export const ROUND_TIMEOUT_MS = 1200;

export const LIMITS = {
	fresh: 6,
	newRecipes: 8,
	topics: 8,
	cooks: 12,
	reads: 4,
	/** The reads section shows only with at least this many cards (else curated only, or hidden). */
	minReads: 2,
	/** Uncurated reads: food long-form from trusted authors published in this window. */
	readsWindowDays: 90,
	picks: 2,
	/** Topic counts below this aren't shown. */
	minTopicCount: 5
};

export interface LandingData {
	v: 1;
	builtAt: number;
	cover: LongformCard | null;
	picks: LongformCard[];
	newRecipes: LongformCard[];
	fresh: NoteCard[];
	topics: TopicTile[];
	cooks: Cook[];
	reads: LongformCard[];
	/**
	 * Sections whose empty result is real (the relay answered in full), so the
	 * last good version must not come back. Only reads uses it: an empty
	 * reads section is hidden on purpose, never padded.
	 */
	settled?: SectionName[];
}

export type SectionName = 'cover' | 'newRecipes' | 'fresh' | 'topics' | 'cooks' | 'reads';

export function emptyLandingData(builtAt = 0): LandingData {
	return { v: 1, builtAt, cover: null, picks: [], newRecipes: [], fresh: [], topics: [], cooks: [], reads: [] };
}

interface Nip11Topic {
	slug: string;
	name: string;
	count14d: number | null;
}

export interface Nip11Topics {
	featured: { slug: string; label: string }[];
	bySlug: Map<string, Nip11Topic>;
}

/** The relay's NIP-11 `topics` block → featured slugs + names/counts. */
export function parseNip11Topics(doc: unknown): Nip11Topics | null {
	const t = (doc as { topics?: Record<string, unknown> } | null)?.topics;
	if (!t || typeof t !== 'object') return null;
	const featured = Array.isArray(t.featured_topics)
		? (t.featured_topics as { slug?: unknown; label?: unknown }[])
				.filter((f) => typeof f?.slug === 'string')
				.map((f) => ({ slug: String(f.slug), label: typeof f.label === 'string' ? f.label : String(f.slug) }))
		: [];
	const bySlug = new Map<string, Nip11Topic>();
	const add = (x: { slug?: unknown; name?: unknown; count_14d?: unknown }) => {
		if (typeof x?.slug !== 'string') return;
		bySlug.set(x.slug, {
			slug: x.slug,
			name: typeof x.name === 'string' ? x.name : x.slug,
			count14d: typeof x.count_14d === 'number' ? x.count_14d : null
		});
	};
	const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
	for (const p of Array.isArray(t.parents) ? t.parents : []) {
		if (!isObj(p)) continue;
		add(p);
		for (const c of Array.isArray(p.topics) ? p.topics : []) if (isObj(c)) add(c);
	}
	return { featured, bySlug };
}

async function fetchNip11Default(timeoutMs: number): Promise<unknown> {
	try {
		const res = await fetch(FEED_RELAY_HTTP, {
			headers: { Accept: 'application/nostr+json' },
			signal: AbortSignal.timeout(timeoutMs)
		});
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

export interface BuildDeps {
	/** Seconds since the epoch. */
	now?: () => number;
	verify?: (e: NostrEvent) => boolean;
	fetchNip11?: (timeoutMs: number) => Promise<unknown>;
	moderation?: ReadsModerationLists | null;
	timeoutMs?: number;
}

function topicName(slug: string, nip11: Nip11Topics | null): string {
	const known = nip11?.bySlug.get(slug)?.name || nip11?.featured.find((f) => f.slug === slug)?.label;
	if (known) return known;
	const s = slug.replace(/-/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Where a topic tile links. One place, so a topic deep link changes one line. */
export function topicHref(_slug: string): string {
	return '/feed';
}

const FOOD_TAGS = new Set(FOOD_LONGFORM_HASHTAGS.map((t) => t.toLowerCase()));

/** Uncurated articles need a food hashtag (the relay admits health/bitcoin posts too). */
function hasFoodTag(e: NostrEvent): boolean {
	return e.tags.some((t) => t[0] === 't' && FOOD_TAGS.has((t[1] || '').toLowerCase()));
}

function articleAllowed(card: LongformCard, e: NostrEvent, lists: ReadsModerationLists | null): boolean {
	if (card.type !== 'article' || !lists) return true;
	return !evaluateReadsContent(e, lists).blocked;
}

/** One build from the network. Sections that fail come back empty. */
export async function buildLandingData(deps: BuildDeps = {}): Promise<LandingData> {
	const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
	const verify = deps.verify ?? ((e: NostrEvent) => verifyEvent(e as Parameters<typeof verifyEvent>[0]));
	const fetchNip11 = deps.fetchNip11 ?? fetchNip11Default;
	const lists = deps.moderation ?? null;
	const timeoutMs = deps.timeoutMs ?? ROUND_TIMEOUT_MS;
	const t = now();
	const since = t - FREE_WINDOW_SECONDS + SINCE_PAD_SECONDS;

	// Round 1: feed relay sections, NIP-11, the org's lists. Events from the
	// feed relay aren't re-verified (it checks id + signature on ingest);
	// everything from public relays is.
	const listSubs: Record<string, Filter> = {};
	for (const name of Object.keys(LANDING_LISTS) as LandingListName[]) {
		const { kind, d } = LANDING_LISTS[name];
		listSubs[name] = { kinds: [kind], authors: [ORG_PUBKEY], '#d': [d], limit: 2 };
	}
	const [feed, nip11Doc, orgLists] = await Promise.all([
		collect(
			FEED_RELAY,
			{
				fresh: { kinds: FRESH_KINDS, since, limit: 30 },
				recipes: { kinds: [30023, 35000], '#t': RECIPE_T_TAGS, limit: 30 },
				// 30023 only can't reach past the window (recipes are public at any
				// age), so `since` here is just the 90-day reads window, by created_at.
				articles: { kinds: [30023], since: t - LIMITS.readsWindowDays * 86400, limit: 300 }
			},
			{ timeoutMs }
		),
		fetchNip11(timeoutMs),
		raceKeyed(LIST_RELAYS, listSubs, (k, evs) => pickList(evs, k as LandingListName, verify), {
			timeoutMs
		})
	]);
	const nip11 = parseNip11Topics(nip11Doc);

	const newRecipesAll = newestByCoordinate(feed.events.recipes)
		.map(longformCard)
		.filter((c): c is LongformCard => c?.type === 'recipe')
		.sort((a, b) => b.publishedAt - a.publishedAt);
	const articleEvents = newestByCoordinate(feed.events.articles);
	const fallbackArticles = articleEvents
		.map((e) => [longformCard(e), e] as const)
		.filter(([c, e]) => c?.type === 'article' && hasFoodTag(e) && articleAllowed(c, e, lists))
		.map(([c]) => c as LongformCard)
		.sort((a, b) => b.publishedAt - a.publishedAt);

	const fresh = capPerAuthor(
		feed.events.fresh
			.slice()
			.sort((a, b) => b.created_at - a.created_at)
			.map(noteCard)
			.filter((c): c is NoteCard => !!c),
		1
	).slice(0, LIMITS.fresh);

	// Round 2: topic previews + curated refs on the feed relay, profiles on public relays.
	const slugs = (
		orgLists.topics ? listTopicSlugs(orgLists.topics) : (nip11?.featured.map((f) => f.slug) ?? [])
	).slice(0, LIMITS.topics);
	const heroRefs = orgLists.hero ? listCoordinates(orgLists.hero).slice(0, 6) : [];
	const readRefs = orgLists.reads ? listCoordinates(orgLists.reads).slice(0, 6) : [];
	const allRefs = [...heroRefs, ...readRefs];
	const cookPubkeys = orgLists.cooks ? listPubkeys(orgLists.cooks) : [];

	const round2Feed: Record<string, Filter> = {};
	slugs.forEach((slug, i) => {
		round2Feed[`t${i}`] = { kinds: FRESH_KINDS, search: `topic:${slug}`, since, limit: 5 };
	});
	const refFilter = refsFilter(allRefs);
	if (refFilter) round2Feed.refs = refFilter;

	const bylinePubkeys = new Set<string>([
		...fresh.map((c) => c.author.pubkey),
		...newRecipesAll.slice(0, LIMITS.newRecipes + 3).map((c) => c.author.pubkey),
		...fallbackArticles.slice(0, LIMITS.reads).map((c) => c.author.pubkey),
		...allRefs.map((r) => r.pubkey),
		...cookPubkeys
	]);

	const [feed2, profileRes] = await Promise.all([
		collect(FEED_RELAY, round2Feed, { timeoutMs }),
		unionKeyed(
			PROFILE_RELAYS,
			// One kind 0 per author is enough; the limit also bounds what a relay may send.
			{ p: { kinds: [0], authors: [...bylinePubkeys].slice(0, 150), limit: Math.min(bylinePubkeys.size, 150) } },
			{ timeoutMs }
		)
	]);
	const profiles = newestProfiles(profileRes.events.p.filter(verify));

	// Curated refs: the feed relay first. A hero recipe it lacks may come from
	// public relays (first valid answer); a read it lacks is skipped (below).
	const resolved = new Map<string, NostrEvent>();
	for (const e of newestByCoordinate(feed2.events.refs ?? [])) {
		const d = dTag(e);
		if (d && verify(e)) resolved.set(`${e.kind}:${e.pubkey}:${d}`, e);
	}
	for (const r of readRefs) {
		if (!resolved.has(coordinateKey(r))) {
			console.warn(
				`[landing] explore-reads: skipped ${coordinateKey(r)}: not on the feed relay ` +
					'(author outside the trust network, or not food). Add the author to the trust network first.'
			);
		}
	}
	const missing = heroRefs.filter((r) => !resolved.has(coordinateKey(r)));
	if (missing.length) {
		const subs: Record<string, Filter> = {};
		missing.forEach((r, i) => {
			subs[`r${i}`] = { kinds: [r.kind], authors: [r.pubkey], '#d': [r.identifier], limit: 1 };
		});
		const won = await raceKeyed(
			HERO_FALLBACK_RELAYS,
			subs,
			(k, evs) => {
				const r = missing[Number(k.slice(1))];
				const match = newestByCoordinate(evs).find(
					(e) => e.kind === r.kind && e.pubkey === r.pubkey && dTag(e) === r.identifier && verify(e)
				);
				return match ?? null;
			},
			{ timeoutMs }
		);
		for (const e of Object.values(won)) resolved.set(`${e.kind}:${e.pubkey}:${dTag(e)}`, e);
	}
	const refCards = (refs: Coordinate[]) =>
		refs
			.map((r) => resolved.get(coordinateKey(r)))
			.filter((e): e is NostrEvent => !!e)
			.map((e) => [longformCard(e), e] as const)
			.filter(([c, e]) => !!c && articleAllowed(c, e, lists))
			.map(([c]) => c as LongformCard);

	const { cover, picks } = chooseCover(refCards(heroRefs), newRecipesAll, LIMITS.picks);
	const shown = new Set([cover, ...picks].filter(Boolean).map((c) => c!.coordinate));
	const newRecipes = capPerAuthor(
		newRecipesAll.filter((c) => !shown.has(c.coordinate)),
		1
	).slice(0, LIMITS.newRecipes);

	// Reads: curated first, then the newest food long-form by trusted authors
	// from the last 90 days (feed relay only, no recipe-type articles). Fewer
	// than 2 in all: the curated ones alone, or no section; never padding.
	const curatedReads = refCards(readRefs);
	const readsFloor = t - LIMITS.readsWindowDays * 86400;
	const seen = new Set(curatedReads.map((c) => c.coordinate));
	const windowed = capPerAuthor(
		fallbackArticles.filter((c) => c.publishedAt >= readsFloor && !seen.has(c.coordinate)),
		1
	);
	const combined = [...curatedReads, ...windowed].slice(0, LIMITS.reads);
	const reads = combined.length >= LIMITS.minReads ? combined : curatedReads;
	const settled: SectionName[] = feed.done.articles ? ['reads'] : [];

	const topics: TopicTile[] = [];
	slugs.forEach((slug, i) => {
		const evs = feed2.events[`t${i}`] ?? [];
		const image = evs.map((e) => eventImage(e)).find(Boolean);
		if (!image) return;
		const n = nip11?.bySlug.get(slug)?.count14d ?? null;
		topics.push({
			slug,
			name: topicName(slug, nip11),
			count: n !== null && n >= LIMITS.minTopicCount ? n : null,
			image,
			href: topicHref(slug)
		});
	});

	const cooks = rotateDaily(
		cookPubkeys
			.map((pk) => ({ pk, p: profiles.get(pk) }))
			.filter((x): x is { pk: string; p: Profile & { name: string } } => !!x.p?.name)
			.map(({ pk, p }) => ({ pubkey: pk, href: userHref(pk), name: p.name, picture: p.picture, about: p.about })),
		LIMITS.cooks,
		t
	);

	const withAuthor = <C extends { author: { pubkey: string; name?: string; picture?: string } }>(c: C): C => {
		const p = profiles.get(c.author.pubkey);
		return p ? { ...c, author: { pubkey: c.author.pubkey, name: p.name, picture: p.picture } } : c;
	};

	return {
		v: 1,
		builtAt: t,
		cover: cover ? withAuthor(cover) : null,
		picks: picks.map(withAuthor),
		newRecipes: newRecipes.map(withAuthor),
		fresh: fresh.map(withAuthor),
		topics,
		cooks,
		reads: reads.map(withAuthor),
		settled
	};
}

/** One filter for a set of coordinates (cross product, matched afterwards). */
function refsFilter(refs: Coordinate[]): Filter | null {
	if (!refs.length) return null;
	return {
		kinds: [...new Set(refs.map((r) => r.kind))],
		authors: [...new Set(refs.map((r) => r.pubkey))],
		'#d': [...new Set(refs.map((r) => r.identifier))]
	};
}

/**
 * Per section, the new build if it has something, else the last good one.
 * The cover keeps its picks with it.
 */
export function mergeWithLastGood(next: LandingData, last: LandingData | null): {
	data: LandingData;
	stale: SectionName[];
} {
	if (!last) return { data: next, stale: [] };
	const stale: SectionName[] = [];
	const data = { ...next };
	if (!next.cover && last.cover) {
		data.cover = last.cover;
		data.picks = last.picks;
		stale.push('cover');
	}
	for (const k of ['newRecipes', 'fresh', 'topics', 'cooks', 'reads'] as const) {
		if (next.settled?.includes(k)) continue;
		if (next[k].length === 0 && last[k].length > 0) {
			(data as Record<string, unknown>)[k] = last[k];
			stale.push(k);
		}
	}
	return { data, stale };
}

export function hasContent(d: LandingData): boolean {
	return !!d.cover || d.newRecipes.length + d.fresh.length + d.topics.length + d.cooks.length + d.reads.length > 0;
}

// --- Cache -----------------------------------------------------------------

export interface CacheLike {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

/** Not a routable URL: the adapter's page cache can never serve it. */
export const CACHE_KEY = 'https://landing-data.zap.cooking.invalid/v1';
const KEEP_SECONDS = 30 * 24 * 60 * 60;

interface Entry {
	data: LandingData;
	/** ms */
	storedAt: number;
}

let memo: Entry | null = null;
let inflight: Promise<Entry | null> | null = null;

/** Tests only. */
export function __resetLandingMemo(): void {
	memo = null;
	inflight = null;
}

async function readCache(cache: CacheLike | null): Promise<Entry | null> {
	if (!cache) return null;
	try {
		const res = await cache.match(new Request(CACHE_KEY));
		if (!res) return null;
		const entry = (await res.json()) as Entry;
		return entry?.data?.v === 1 ? entry : null;
	} catch {
		return null;
	}
}

async function writeCache(cache: CacheLike | null, entry: Entry): Promise<void> {
	if (!cache) return;
	try {
		await cache.put(
			new Request(CACHE_KEY),
			new Response(JSON.stringify(entry), {
				headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${KEEP_SECONDS}` }
			})
		);
	} catch (err) {
		console.warn('[landing] cache write failed:', err);
	}
}

export interface GetDeps extends BuildDeps {
	cache?: CacheLike | null;
	waitUntil?: (p: Promise<unknown>) => void;
	/** ms */
	clock?: () => number;
	build?: (deps: BuildDeps) => Promise<LandingData>;
}

function refresh(last: Entry | null, deps: GetDeps): Promise<Entry | null> {
	if (inflight) return inflight;
	const clock = deps.clock ?? Date.now;
	const build = deps.build ?? buildLandingData;
	inflight = (async () => {
		let next: LandingData;
		try {
			next = await build(deps);
		} catch (err) {
			console.warn('[landing] build failed:', err);
			next = emptyLandingData(Math.floor(clock() / 1000));
		}
		const { data, stale } = mergeWithLastGood(next, last?.data ?? null);
		if (stale.length) console.warn('[landing] serving last good for:', stale.join(', '));
		if (!hasContent(data)) return last;
		const entry = { data, storedAt: clock() };
		memo = entry;
		await writeCache(deps.cache ?? null, entry);
		return entry;
	})().finally(() => {
		inflight = null;
	});
	return inflight;
}

/**
 * The landing data: fresh from memory or the cache when it can be; stale
 * while a background refresh runs; built (bounded by the round timeouts)
 * only when nothing is stored at all. Empty sections when even that fails.
 */
export async function getLandingData(deps: GetDeps = {}): Promise<LandingData> {
	const clock = deps.clock ?? Date.now;
	const fresh = (e: Entry | null) => !!e && clock() - e.storedAt < FRESH_FOR_MS;

	let entry = memo;
	if (!fresh(entry)) {
		const cached = await readCache(deps.cache ?? null);
		if (cached && (!entry || cached.storedAt > entry.storedAt)) entry = cached;
	}
	if (entry && fresh(entry)) {
		memo = entry;
		return entry.data;
	}
	if (entry) {
		const p = refresh(entry, deps);
		if (deps.waitUntil) deps.waitUntil(p);
		return entry.data;
	}
	const built = await refresh(null, deps);
	return built?.data ?? emptyLandingData();
}
