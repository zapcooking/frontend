/**
 * Server-only helpers for Recipe Pack Open Graph rendering.
 *
 * Fetches kind 30004 packs (and optionally a few referenced recipes for
 * collage / preview names) directly from relays via raw WebSocket — no
 * NDK on the server. Mirrors the pattern used in
 * `/r/[naddr]/+page.server.ts` so we get fast, dependency-free SSR for
 * OG meta and the card image generator.
 */

import { parseCoordinate } from './coordinate';
import { isHiddenRecipeATag, standardRelays } from './consts';
import { isExploreCurationDTag } from './landing/curation';

// The full standard pool, not a hand-picked subset: authors publish to
// different relays, and cards for recipes that only live on nostr.wine went
// generic for months because the race never asked there (the browser pool
// found the same recipes fine, which is what kept making this look
// intermittent). Same list the client NDK pool connects to.
const RELAYS = standardRelays;

const FETCH_TIMEOUT_MS = 3500;

/**
 * Last-good cache for resolved events, keyed by filter. Crawler bursts hit
 * the same URL many times in quick succession; without this every hit paid
 * the relay race again (and a relay flapping mid-burst flipped live cards
 * back to the generic fallback). Positives only — misses are never cached,
 * so a transient outage retries on the next request.
 */
const EVENT_CACHE_TTL_MS = 10 * 60 * 1000;
const EVENT_CACHE_MAX_ENTRIES = 200;
const eventCache = new Map<string, { event: any; expiresAt: number }>();

function eventCacheKey(filter: RelayFilter): string {
	// Only the identity fields — limit/other keys are set by callers, never
	// vary between calls for the same event.
	return JSON.stringify([filter.kinds, filter.authors, filter.ids, filter['#d']]);
}

function cacheEvent(key: string, event: any): void {
	eventCache.set(key, { event, expiresAt: Date.now() + EVENT_CACHE_TTL_MS });
	while (eventCache.size > EVENT_CACHE_MAX_ENTRIES) {
		const oldest = eventCache.keys().next().value;
		if (oldest === undefined) break;
		eventCache.delete(oldest);
	}
}

/** Per-relay end state, for the miss log. */
type RelayOutcome = 'event' | 'eose' | 'timeout' | 'error' | 'aborted';

export interface PackMetadata {
	title: string;
	description: string;
	image: string;
	creatorPubkey: string;
	recipeATags: string[];
	recipeCount: number;
}

export interface RecipePreview {
	id: string; // a-tag
	title: string;
	image?: string;
}

export interface RelayFilter {
	kinds?: number[];
	authors?: string[];
	ids?: string[];
	'#d'?: string[];
	[k: string]: unknown;
}

/**
 * One-shot raw-WebSocket fetch for an event matching `filter` from a
 * single relay. Resolves the matching event JSON, or null with the
 * relay's end state (timeout / EOSE-without-event / failure) so total
 * misses can be logged with a per-relay breakdown.
 *
 * Accepts an AbortSignal so a parent race can cancel pending fetches
 * once a winner has resolved — without that, every relay fetch would
 * hold its socket open until its own timeout fired.
 */
function fetchEventFromRelay(
	relayUrl: string,
	filter: RelayFilter,
	signal?: AbortSignal
): Promise<{ event: any | null; outcome: RelayOutcome }> {
	if (typeof WebSocket === 'undefined') return Promise.resolve({ event: null, outcome: 'error' });
	if (signal?.aborted) return Promise.resolve({ event: null, outcome: 'aborted' });

	return new Promise((resolve) => {
		let ws: WebSocket | null = null;
		let resolved = false;

		const cleanup = () => {
			if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
				try {
					ws.close();
				} catch {
					/* ignore */
				}
			}
		};
		const safeResolve = (event: any | null, outcome: RelayOutcome) => {
			if (resolved) return;
			resolved = true;
			cleanup();
			signal?.removeEventListener('abort', onAbort);
			resolve({ event, outcome });
		};

		const onAbort = () => safeResolve(null, 'aborted');
		signal?.addEventListener('abort', onAbort, { once: true });

		const timeout = setTimeout(() => safeResolve(null, 'timeout'), FETCH_TIMEOUT_MS);

		try {
			ws = new WebSocket(relayUrl);
		} catch {
			clearTimeout(timeout);
			safeResolve(null, 'error');
			return;
		}

		const subId = `og-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		ws.onopen = () => {
			if (!ws || resolved) return;
			try {
				ws.send(JSON.stringify(['REQ', subId, { ...filter, limit: 1 }]));
			} catch {
				clearTimeout(timeout);
				safeResolve(null, 'error');
			}
		};

		ws.onmessage = (msgEvent) => {
			if (!ws || resolved) return;
			try {
				const msg = JSON.parse((msgEvent as MessageEvent).data);
				if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
					clearTimeout(timeout);
					safeResolve(msg[2], 'event');
				} else if (msg[0] === 'EOSE' && msg[1] === subId) {
					clearTimeout(timeout);
					safeResolve(null, 'eose');
				}
			} catch {
				/* parse error — wait for next */
			}
		};

		ws.onerror = () => {
			clearTimeout(timeout);
			safeResolve(null, 'error');
		};
		ws.onclose = () => {
			clearTimeout(timeout);
			if (!resolved) safeResolve(null, 'error');
		};
	});
}

function describeFilter(filter: RelayFilter): string {
	const parts: string[] = [];
	if (filter.kinds) parts.push(`kinds=${filter.kinds.join('|')}`);
	if (filter.authors) parts.push(`authors=${filter.authors.join('|').slice(0, 16)}…`);
	if (filter.ids) parts.push(`ids=${filter.ids.join('|').slice(0, 16)}…`);
	if (filter['#d']) parts.push(`d=${filter['#d'].join('|')}`);
	return parts.join(' ');
}

/**
 * True first-non-null race across relays: spawn all in parallel, take
 * the first one that produces a non-null result, abort the rest. If
 * every relay returns null, the overall result is null.
 *
 * Uses a single AbortController so winning settles all pending fetches
 * immediately — no zombie sockets waiting on FETCH_TIMEOUT_MS.
 *
 * Served from the last-good cache on repeat lookups; total misses are
 * logged with per-relay outcomes so a future "why is this card generic"
 * investigation is one grep away from the answer.
 */
export async function raceRelays(filter: RelayFilter): Promise<any | null> {
	if (typeof WebSocket === 'undefined') return null;

	const cacheKey = eventCacheKey(filter);
	const cached = eventCache.get(cacheKey);
	if (cached) {
		if (cached.expiresAt > Date.now()) return cached.event;
		eventCache.delete(cacheKey);
	}

	const controller = new AbortController();
	const result = await new Promise<any | null>((resolve) => {
		let pending = RELAYS.length;
		let settled = false;
		const outcomes = new Map<string, RelayOutcome>();

		const finish = (value: any | null) => {
			if (settled) return;
			settled = true;
			controller.abort();
			if (value === null) {
				const breakdown = RELAYS.map(
					(url) => `${url}=${outcomes.get(url) ?? 'aborted'}`
				).join(' ');
				console.warn(`[og] relay miss ${describeFilter(filter)} — ${breakdown}`);
			}
			resolve(value);
		};

		for (const url of RELAYS) {
			fetchEventFromRelay(url, filter, controller.signal).then(
				({ event, outcome }) => {
					outcomes.set(url, outcome);
					if (event !== null) {
						finish(event);
					} else if (--pending === 0) {
						finish(null);
					}
				},
				() => {
					outcomes.set(url, 'error');
					if (--pending === 0) finish(null);
				}
			);
		}
	});

	if (result !== null) cacheEvent(cacheKey, result);
	return result;
}

/**
 * Fetch a Recipe Pack (kind 30004) by author + d-tag and shape the
 * result into PackMetadata. Returns null if the event can't be found.
 */
export async function fetchPackMetadata(
	pubkey: string,
	dTag: string,
	kind: number
): Promise<PackMetadata | null> {
	// The org's /explore curation lists share kind 30004; they aren't packs.
	if (isExploreCurationDTag(dTag)) return null;
	const evt = await raceRelays({ kinds: [kind], authors: [pubkey], '#d': [dTag] });
	if (!evt) return null;

	const tags: string[][] = Array.isArray(evt.tags) ? evt.tags : [];
	const find = (name: string) => tags.find((t) => t[0] === name)?.[1];

	const title = find('title') || find('d') || '';
	const description = find('description') || '';
	const image = find('image') || '';
	const recipeATags = tags
		.filter((t) => t[0] === 'a' && typeof t[1] === 'string')
		.map((t) => t[1])
		.filter((a) => !isHiddenRecipeATag(a));

	return {
		title,
		description,
		image,
		creatorPubkey: typeof evt.pubkey === 'string' ? evt.pubkey : pubkey,
		recipeATags,
		recipeCount: recipeATags.length
	};
}

/**
 * Fetch the first N recipes from a list of a-tags. Used to build a
 * fallback collage / preview-name list when the pack itself has no
 * cover image. Failures per-recipe are tolerated — we return whatever
 * came back.
 */
export async function fetchRecipePreviews(
	aTags: string[],
	limit: number = 4
): Promise<RecipePreview[]> {
	const targets = aTags.slice(0, limit);
	const results = await Promise.all(
		targets.map(async (aTag): Promise<RecipePreview | null> => {
			const parsed = parseCoordinate(aTag);
			if (!parsed?.identifier) return null;
			const { kind: kindNum, pubkey, identifier: dTag } = parsed;
			const evt = await raceRelays({ kinds: [kindNum], authors: [pubkey], '#d': [dTag] });
			if (!evt) return null;
			const tags: string[][] = Array.isArray(evt.tags) ? evt.tags : [];
			const title = tags.find((t) => t[0] === 'title')?.[1] || dTag;
			const image = tags.find((t) => t[0] === 'image')?.[1];
			return { id: aTag, title, image };
		})
	);
	return results.filter((r): r is RecipePreview => r !== null);
}

/**
 * Fetch a NIP-01 kind:0 metadata event for a pubkey to resolve display
 * name / picture for the OG card. Reuses raceRelays so losing relay
 * sockets get closed as soon as a winner resolves.
 */
export async function fetchProfileMetadata(
	pubkey: string
): Promise<{ name?: string; display_name?: string; picture?: string }> {
	if (typeof WebSocket === 'undefined') return {};
	const evt = await raceRelays({ kinds: [0], authors: [pubkey] });
	if (!evt?.content) return {};
	try {
		const parsed = JSON.parse(evt.content);
		return {
			name: typeof parsed.name === 'string' ? parsed.name : undefined,
			display_name: typeof parsed.display_name === 'string' ? parsed.display_name : undefined,
			picture: typeof parsed.picture === 'string' ? parsed.picture : undefined
		};
	} catch {
		return {};
	}
}
