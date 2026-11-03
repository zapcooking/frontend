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

import { parseCoordinate } from '$lib/coordinate';
import { standardRelays } from '$lib/consts';
import { PACK_KIND, PACK_TAGS, PACK_DISCOVERY_TIMEOUT_MS, packCard, moderatePackCard } from './packs';
import { editionBucket } from './editorialConfig';
import { isEligibleFoodStory } from './storyEligibility';
import { DEFAULT_FRESH_TOPICS, FRESH_TOPIC_CANDIDATES, JUST_SERVED_MAX_AGE_SECONDS, freshNote, freshCardAllowed, freshTopicHref, topicPostOverrides } from './fresh';
import { verifyEvent } from 'nostr-tools/pure';
import type { ReadsModerationLists } from '$lib/reads/moderationConfig';
import { evaluateReadsContent } from '$lib/reads/moderation';
import {
	collect,
	raceKeyed,
	unionKeyed,
	type Filter,
	type NostrEvent
} from '$lib/relayCollect';
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
	rotateDaily,
	userHref,
	type Cook,
	type LongformCard,
	type NoteCard,
	type FreshTopicTile,
	type PackCard,
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
/** Homepage Fresh surfaces photo notes; the full feed keeps its broader kind support. */
export const FRESH_KINDS = [1];
export const RECIPE_T_TAGS = ['zapcooking', 'nostrcooking'];

/** Fresh enough to serve without a refresh. */
export const FRESH_FOR_MS = 120_000;
/** Each network round's hard cap. */
export const ROUND_TIMEOUT_MS = 1200;
/** Bound revision memory to one complete public discovery budget (four relays × 60). */
export const MAX_PACK_REVISIONS = 240;

export const LIMITS = {
	fresh: 6,
	newRecipes: 8,
	topics: 8,
	cooks: 12,
	reads: 8,
	packs: 4,
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
	/** Signed editorial story pool, pinned separately from recent Fresh content. */
	readPool?: LongformCard[];
	readPoolBucket?: number;
	readList?: { version: number; coordinates: string[] };
	freshPool?: NoteCard[];
	freshTopics?: FreshTopicTile[];
	freshTopicsBucket?: number;
	freshTopicList?: { version: number; slugs: string[] };
	/** Optional for compatibility with landing data cached before packs were added. */
	packs?: PackCard[];
	/** Latest signed versions observed, including empty/invalid packs that retire cached cards. */
	packRevisions?: { coordinate: string; version: number }[];
	/** Editorially approved recipes; never padded with unrelated recent content. */
	coverPool?: LongformCard[];
	coverPoolBucket?: number;
	/** Presence distinguishes an authoritative empty list from an unavailable list. */
	coverList?: { version: number; coordinates: string[] };
	/** Shared recipe candidates for non-cover sections and matching cook profiles. */
	recipePool?: LongformCard[];
	/**
	 * Sections whose empty result is real (the relay answered in full), so the
	 * last good version must not come back. Empty reads and packs are hidden
	 * when their discovery sources answered successfully, never padded.
	 */
	settled?: SectionName[];
}

export type SectionName = 'cover' | 'newRecipes' | 'fresh' | 'topics' | 'cooks' | 'reads' | 'packs' | 'freshTopics';

export function emptyLandingData(builtAt = 0): LandingData {
	return { v: 1, builtAt, cover: null, picks: [], newRecipes: [], fresh: [], topics: [], cooks: [], reads: [], readPool: [], readPoolBucket: editionBucket(builtAt), freshPool: [], freshTopics: [], freshTopicsBucket: editionBucket(builtAt), packs: [], packRevisions: [], coverPool: [], recipePool: [] };
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
export function topicHref(slug: string): string {
	return `/tag/${encodeURIComponent(slug)}`;
}

function articleAllowed(_card: LongformCard, e: NostrEvent, lists: ReadsModerationLists | null): boolean {
	if (!lists) return true;
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
	const [feed, nip11Doc, orgLists, packSources] = await Promise.all([
		collect(
			FEED_RELAY,
			{
				fresh: { kinds: FRESH_KINDS, since, limit: 120 },
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
		}),
		// Same public discovery pool as /packs, bounded within the existing first round.
		Promise.all(standardRelays.map((url) => collect(url, {
			packs: { kinds: [PACK_KIND], '#t': PACK_TAGS, limit: 60 }
		}, { timeoutMs: deps.timeoutMs ?? PACK_DISCOVERY_TIMEOUT_MS })))
	]);
	const nip11 = parseNip11Topics(nip11Doc);
	// Verify before deduplication so a forged newer revision cannot hide a valid pack.
	// Choose the latest revision before validating references, so an emptied pack
	// cannot revive an older version still returned by another relay.
	const packEvents = newestByCoordinate(packSources.flatMap((source) => source.events.packs)
		.filter((event) => event.kind === PACK_KIND && verify(event)));
	const packRevisions = packEvents.map((event) => ({
		coordinate: `${PACK_KIND}:${event.pubkey}:${dTag(event)}`, version: event.created_at
	}));
	const packs = packEvents
		.map(packCard)
		.filter((card): card is PackCard => !!card)
		.map((card) => moderatePackCard(card, lists))
		.filter((card): card is PackCard => !!card)
		.sort((a, b) => b.publishedAt - a.publishedAt || a.coordinate.localeCompare(b.coordinate))
		.slice(0, LIMITS.packs);

	const newRecipesAll = newestByCoordinate(feed.events.recipes)
		.filter((e) => !lists || !evaluateReadsContent(e, lists).blocked)
		.map(longformCard)
		.filter((c): c is LongformCard => c?.type === 'recipe')
		.sort((a, b) => b.publishedAt - a.publishedAt);
	const articleEvents = newestByCoordinate(feed.events.articles);
	const fallbackArticles = articleEvents
		.map((e) => [longformCard(e), e] as const)
		.filter(([c, e]) => c?.type === 'article' && isEligibleFoodStory(c) && articleAllowed(c, e, lists))
		.map(([c]) => c as LongformCard)
		.sort((a, b) => b.publishedAt - a.publishedAt);

	const recentCards = feed.events.fresh
		.map((event) => freshNote(event, t, lists))
		.filter((card): card is NoteCard => !!card);

	// Supported topic slugs come from the same NIP-11 catalog used by Fresh.
	const curatedSlugs = orgLists.topics ? listTopicSlugs(orgLists.topics) : null;
	const supported = new Set([...(nip11?.bySlug.keys() ?? []), ...(nip11?.featured.map((f) => f.slug) ?? [])]);
	const requested = curatedSlugs?.length === 0 ? [] : [
		...(curatedSlugs ?? []), ...(nip11?.featured.map((f) => f.slug) ?? []),
		...DEFAULT_FRESH_TOPICS, ...supported
	];
	const slugs = [...new Set(requested)].filter((slug) => supported.has(slug) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 64).slice(0, FRESH_TOPIC_CANDIDATES);
	const topicOverrides = topicPostOverrides(orgLists.topics?.tags ?? []);
	const heroRefs = orgLists.hero ? listCoordinates(orgLists.hero).slice(0, 20) : [];
	const readRefs = orgLists.reads ? listCoordinates(orgLists.reads).slice(0, 6) : [];
	const allRefs = [...heroRefs, ...readRefs];
	const cookPubkeys = orgLists.cooks ? listPubkeys(orgLists.cooks) : [];

	const round2Feed: Record<string, Filter> = {};
	slugs.forEach((slug, i) => {
		round2Feed[`t${i}`] = { kinds: [1], search: `topic:${slug}`, since, limit: 8 };
	});
	const overrideIds = slugs.map((slug) => topicOverrides.get(slug)).filter((id): id is string => !!id);
	if (overrideIds.length) round2Feed.topicOverrides = { kinds: [1], ids: overrideIds, since, limit: FRESH_TOPIC_CANDIDATES };
	const refFilter = refsFilter(allRefs);
	if (refFilter) round2Feed.refs = refFilter;

	const bylinePubkeys = new Set<string>([
		...recentCards.map((c) => c.author.pubkey),
		...packs.map((c) => c.author.pubkey),
		...newRecipesAll.map((c) => c.author.pubkey),
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
	const topicCandidates = new Map<string, NoteCard[]>();
	slugs.forEach((slug, i) => {
		const overrideId = topicOverrides.get(slug);
		const override = (feed2.events.topicOverrides ?? []).find((event) => event.id === overrideId);
		const candidates = [...(override ? [override] : []), ...(feed2.events[`t${i}`] ?? [])]
			.map((event) => freshNote(event, t, lists, event.id === overrideId))
			.filter((card): card is NoteCard => !!card);
		topicCandidates.set(slug, candidates);
	});
	// One bounded batch supplies missing topic-photo bylines; never a fetch per card.
	const topicAuthors = [...new Set([...topicCandidates.values()].flat().map((card) => card.author.pubkey))]
		.filter((pubkey) => !profiles.has(pubkey)).slice(0, 80);
	const topicProfiles = topicAuthors.length
		? unionKeyed(PROFILE_RELAYS, { p: { kinds: [0], authors: topicAuthors, limit: topicAuthors.length } }, { timeoutMs })
		: Promise.resolve({ events: { p: [] as NostrEvent[] } });

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
	const curatedReads = refCards(readRefs).filter(isEligibleFoodStory);
	const readsFloor = t - LIMITS.readsWindowDays * 86400;
	const seen = new Set(curatedReads.map((c) => c.coordinate));
	const windowed = capPerAuthor(
		fallbackArticles.filter((c) => c.publishedAt >= readsFloor && !seen.has(c.coordinate)),
		1
	);
	const combined = [...curatedReads, ...windowed].slice(0, LIMITS.reads);
	const reads = combined.length >= LIMITS.minReads ? combined : curatedReads;
	const settled: SectionName[] = feed.done.articles ? ['reads'] : [];
	if (feed.done.fresh && !feed.closed.fresh) settled.push('fresh');
	if (curatedSlugs?.length === 0) {
		// A signed removal is authoritative even when the topic catalog is unavailable.
		settled.push('freshTopics', 'topics');
	} else if (nip11 && slugs.every((_, i) => feed2.done[`t${i}`] && !feed2.closed[`t${i}`])) settled.push('freshTopics');
	// An empty profile-only relay is insufficient evidence that packs disappeared.
	// Retain last good packs unless every discovery source completed successfully.
	if (packSources.every((source) => source.done.packs && !source.closed.packs)) settled.push('packs');

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

	for (const [pubkey, profile] of newestProfiles((await topicProfiles).events.p.filter(verify))) profiles.set(pubkey, profile);
	const withAuthor = <C extends { author: { pubkey: string; name?: string; picture?: string } }>(c: C): C => {
		const p = profiles.get(c.author.pubkey);
		return p ? { ...c, author: { pubkey: c.author.pubkey, name: p.name, picture: p.picture } } : c;
	};

	const freshPool = [...new Map([...recentCards, ...[...topicCandidates.values()].flat()].map((card) => [card.id, withAuthor(card)])).values()]
		.sort((a, b) => b.createdAt - a.createdAt).slice(0, 120);
	const fresh = capPerAuthor(freshPool.filter((card) => freshCardAllowed(card, t, lists, JUST_SERVED_MAX_AGE_SECONDS)), 1).slice(0, LIMITS.fresh);
	const freshTopics: FreshTopicTile[] = slugs.flatMap((slug) => {
		const candidates = (topicCandidates.get(slug) ?? []).map(withAuthor);
		return candidates.length ? [{ slug, name: topicName(slug, nip11), href: freshTopicHref(slug), image: candidates[0].image, post: candidates[0], alternatives: candidates.slice(1) }] : [];
	});

	return {
		v: 1,
		builtAt: t,
		cover: cover ? withAuthor(cover) : null,
		picks: picks.map(withAuthor),
		newRecipes: newRecipes.map(withAuthor),
		fresh: fresh.map(withAuthor),
		freshPool,
		freshTopics,
		freshTopicsBucket: editionBucket(t),
		...(orgLists.topics ? { freshTopicList: { version: orgLists.topics.created_at, slugs: curatedSlugs ?? [] } } : {}),
		topics,
		cooks,
		reads: reads.map(withAuthor),
		readPool: curatedReads.map(withAuthor),
		readPoolBucket: editionBucket(t),
		...(orgLists.reads ? { readList: { version: orgLists.reads.created_at, coordinates: readRefs.map(coordinateKey) } } : {}),
		packs: packs.map(withAuthor),
		packRevisions,
		coverPool: refCards(heroRefs).filter((c) => c.type === 'recipe').map(withAuthor),
		...(orgLists.hero ? { coverPoolBucket: editionBucket(t), coverList: { version: orgLists.hero.created_at, coordinates: heroRefs.map(coordinateKey) } } : {}),
		recipePool: newestRecipeCards([...refCards(heroRefs), ...newRecipesAll]).map(withAuthor),
		settled
	};
}

function newestRecipeCards(cards: LongformCard[]): LongformCard[] {
	const seen = new Set<string>();
	return cards.filter((c) => {
		if (c.type !== 'recipe' || seen.has(c.coordinate)) return false;
		seen.add(c.coordinate);
		return true;
	});
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
	const packRevisions = mergePackRevisions(next, last);
	const data = { ...next, packRevisions, packs: (next.packs ?? []).filter((card) => !newerPackRevision(packRevisions, card)) };
	// A signed empty list is an editorial removal, not a failed fetch. An outage
	// retains only previously approved candidates, never recent unapproved food.
	const list = next.coverList ?? last.coverList;
	if (list) {
		data.coverList = list;
		const sameEdition = editionBucket(next.builtAt) === (last.coverPoolBucket ?? editionBucket(last.builtAt));
		data.coverPoolBucket = editionBucket(next.builtAt);
		const sameList = JSON.stringify(list) === JSON.stringify(last.coverList);
		const candidates = sameEdition && sameList && last.coverPool?.length
			? last.coverPool
			: [...(next.coverPool ?? []), ...(last.coverPool ?? [])];
		// Preserve editorial order and restore unresolved refs only while still approved.
		data.coverPool = list.coordinates.map((coordinate) => candidates.find((c) => c.coordinate === coordinate))
			.filter((c): c is LongformCard => !!c);
	} else if (!next.coverPool?.length && last.coverPool?.length) {
		data.coverPool = last.coverPool;
	}
	if (!next.recipePool?.length && last.recipePool?.length) data.recipePool = last.recipePool;
	const readList = next.readList ?? last.readList;
	if (readList) {
		data.readList = readList;
		const same = editionBucket(next.builtAt) === (last.readPoolBucket ?? editionBucket(last.builtAt)) && JSON.stringify(readList) === JSON.stringify(last.readList);
		const candidates = same && last.readPool?.length ? last.readPool : [...(next.readPool ?? []), ...(last.readPool ?? [])];
		data.readPool = readList.coordinates.map((coordinate) => candidates.find((card) => card.coordinate === coordinate)).filter((card): card is LongformCard => !!card);
		data.readPoolBucket = editionBucket(next.builtAt);
	} else if (!next.readPool?.length && last.readPool?.length) data.readPool = last.readPool;
	if (!next.freshPool?.length && !next.settled?.includes('fresh') && last.freshPool?.length) data.freshPool = last.freshPool;
	// Retain signed editorial intent through discovery outages and older relay replies.
	// A later nonempty version can reopen an explicitly cleared topic selection.
	const topicList = next.freshTopicList && (!last.freshTopicList || next.freshTopicList.version > last.freshTopicList.version)
		? next.freshTopicList : last.freshTopicList ?? next.freshTopicList;
	const topicsCleared = topicList?.slugs.length === 0;
	const sameTopics = editionBucket(next.builtAt) === last.freshTopicsBucket && JSON.stringify(topicList) === JSON.stringify(last.freshTopicList);
	if (topicsCleared) {
		data.freshTopics = [];
		data.topics = [];
		data.settled = [...new Set([...(next.settled ?? []), 'freshTopics', 'topics'] as SectionName[])];
	} else if (next.freshTopicList && topicList !== next.freshTopicList && JSON.stringify(next.freshTopicList) !== JSON.stringify(topicList)) {
		// Ignore both data and empty markers produced from a superseded list.
		data.freshTopics = last.freshTopics ?? [];
		data.topics = last.topics;
		data.settled = next.settled?.filter((section) => section !== 'freshTopics' && section !== 'topics');
	} else {
		if (sameTopics && next.freshTopics?.length) {
			data.freshTopics = next.freshTopics.map((tile) => last.freshTopics?.find((old) => old.slug === tile.slug) ?? tile);
		}
		if (!next.freshTopics?.length && !next.settled?.includes('freshTopics') && last.freshTopics?.length) data.freshTopics = last.freshTopics;
	}
	data.freshTopicsBucket = editionBucket(next.builtAt);
	data.freshTopicList = topicList;

	if (!next.cover && last.cover) {
		data.cover = last.cover;
		data.picks = last.picks;
		stale.push('cover');
	}
	for (const k of ['newRecipes', 'fresh', 'topics', 'cooks', 'reads'] as const) {
		if (data.settled?.includes(k)) continue;
		if (next[k].length === 0 && last[k].length > 0) {
			(data as Record<string, unknown>)[k] = last[k];
			stale.push(k);
		}
	}
	if (!next.settled?.includes('packs') && !data.packs.length) {
		// Missing sources can preserve unrelated packs, but a signed newer empty,
		// blocked or invalid revision is an authoritative removal of its own card.
		const retained = (last.packs ?? []).filter((card) =>
			!observedPackRevision(next, card) && !newerPackRevision(packRevisions, card)
		);
		if (retained.length) {
			data.packs = retained;
			stale.push('packs');
		}
	}
	return { data, stale };
}

function mergePackRevisions(next: LandingData, last: LandingData): NonNullable<LandingData['packRevisions']> {
	const latest = new Map<string, number>();
	for (const revision of [
		...(last.packRevisions ?? []), ...(next.packRevisions ?? []),
		...(last.packs ?? []).map((card) => ({ coordinate: card.coordinate, version: card.publishedAt })),
		...(next.packs ?? []).map((card) => ({ coordinate: card.coordinate, version: card.publishedAt }))
	]) {
		latest.set(revision.coordinate, Math.max(revision.version, latest.get(revision.coordinate) ?? -1));
	}
	return [...latest].map(([coordinate, version]) => ({ coordinate, version }))
		.sort((a, b) => b.version - a.version || a.coordinate.localeCompare(b.coordinate))
		.slice(0, MAX_PACK_REVISIONS);
}

function newerPackRevision(revisions: NonNullable<LandingData['packRevisions']>, card: PackCard): boolean {
	return revisions.some((revision) => revision.coordinate === card.coordinate && revision.version > card.publishedAt);
}

function observedPackRevision(next: LandingData, card: PackCard): boolean {
	return !!next.packRevisions?.some((revision) =>
		revision.coordinate === card.coordinate && revision.version >= card.publishedAt
	);
}

/**
 * On the first request of a new edition, pin the latest already-cached approved
 * candidates before starting a background refresh. Later discoveries wait for
 * the next edition; a new signed editorial list still takes effect immediately.
 */
export function pinCoverPool(data: LandingData, nowSeconds: number): LandingData {
	const bucket = editionBucket(nowSeconds);
	if ((!data.coverList || data.coverPoolBucket === bucket) && (!data.readList || data.readPoolBucket === bucket)) return data;
	const candidates = [...(data.recipePool ?? []), ...(data.coverPool ?? [])];
	return {
		...data,
		coverPoolBucket: bucket,
		readPoolBucket: bucket,
		readPool: data.readList ? data.readList.coordinates.map((coordinate) => [...data.reads, ...(data.readPool ?? [])].find((card) => card.coordinate === coordinate)).filter((card): card is LongformCard => !!card) : data.readPool,
		coverPool: data.coverList ? data.coverList.coordinates.map((coordinate) => candidates.find((c) => c.coordinate === coordinate))
			.filter((c): c is LongformCard => !!c) : data.coverPool
	};
}

/** Recheck cached candidates so last-good data cannot revive a newly blocked recipe. */
export function moderateLandingData(data: LandingData, lists: ReadsModerationLists | null, nowSeconds = Math.floor(Date.now() / 1000)): LandingData {
	const packs = (data.packs ?? []).map((card) => moderatePackCard(card, lists)).filter((card): card is PackCard => !!card);
	const freshPool = (data.freshPool?.length ? data.freshPool : data.fresh).filter((card) => freshCardAllowed(card, nowSeconds, lists));
	const fresh = data.fresh.filter((card) => freshCardAllowed(card, nowSeconds, lists, JUST_SERVED_MAX_AGE_SECONDS));
	const freshTopics = (data.freshTopics ?? []).flatMap((tile) => {
		const eligible = [tile.post, ...(tile.alternatives ?? [])].filter((card) => freshCardAllowed(card, nowSeconds, lists));
		return eligible.length ? [{ ...tile, image: eligible[0].image, post: eligible[0], alternatives: eligible.slice(1) }] : [];
	});
	if (!lists) return { ...data, packs, fresh, freshPool, freshTopics };
	const allowed = (c: LongformCard) => {
		const coordinate = parseCoordinate(c.coordinate);
		return !evaluateReadsContent({
			id: c.eventId, kind: coordinate?.kind, pubkey: coordinate?.pubkey ?? c.author.pubkey, content: c.moderationText ?? '',
			tags: [['d', coordinate?.identifier ?? ''], ['title', c.title], ['summary', c.summary ?? ''], ...(c.tags ?? []).map((t) => ['t', t])]
		}, lists).blocked;
	};
	return {
		...data,
		packs,
		fresh, freshPool, freshTopics,
		readPool: data.readPool?.filter(allowed),
		cover: data.cover && allowed(data.cover) ? data.cover : null,
		picks: data.picks.filter(allowed),
		newRecipes: data.newRecipes.filter(allowed),
		reads: data.reads.filter(allowed),
		coverPool: data.coverPool?.filter(allowed),
		recipePool: data.recipePool?.filter(allowed)
	};
}

export function hasContent(d: LandingData): boolean {
	return !!d.cover || d.newRecipes.length + d.fresh.length + d.topics.length + d.cooks.length + d.reads.length + (d.packs?.length ?? 0) + (d.freshTopics?.length ?? 0) > 0;
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
		const merged = mergeWithLastGood(next, last?.data ?? null);
		const stale = merged.stale;
		const data = moderateLandingData(merged.data, deps.moderation ?? null, Math.floor(clock() / 1000));
		if (stale.length) console.warn('[landing] serving last good for:', stale.join(', '));
		// A complete empty response must also clear a cache containing only one
		// section; otherwise returning `last` would revive the removed content.
		const clearedSection = next.settled?.some((section) =>
			section === 'packs' ? !!last?.data.packs?.length
				: section === 'reads' ? !!last?.data.reads.length
				: section === 'fresh' ? !!last?.data.fresh.length
				: section === 'freshTopics' && !!last?.data.freshTopics?.length
		) || last?.data.packs?.some((card) => observedPackRevision(next, card));
		// Keep newly observed signed removals even if no visible section remains,
		// so a later stale relay cannot bring an older valid revision back.
		// Keep signed topic-list state even with no visible cards, so an empty
		// editorial choice survives later list outages and default discovery.
		if (!hasContent(data) && !clearedSection && !data.packRevisions?.length && !data.freshTopicList) return last;
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
	if (entry) entry = { ...entry, data: pinCoverPool(entry.data, Math.floor(clock() / 1000)) };
	if (entry && fresh(entry)) {
		memo = entry;
		return moderateLandingData(entry.data, deps.moderation ?? null, Math.floor(clock() / 1000));
	}
	if (entry) {
		memo = entry;
		const p = refresh(entry, deps);
		if (deps.waitUntil) deps.waitUntil(p);
		return moderateLandingData(entry.data, deps.moderation ?? null, Math.floor(clock() / 1000));
	}
	const built = await refresh(null, deps);
	return moderateLandingData(built?.data ?? emptyLandingData(), deps.moderation ?? null, Math.floor(clock() / 1000));
}
