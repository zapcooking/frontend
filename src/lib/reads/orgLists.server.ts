/**
 * Fetches the org's feed-block and feed-hidden lists from public relays
 * (where the /explore lists live), cached like the /explore landing data:
 * one fixed Cache API key, fresh for 2 minutes, stale served while a
 * background refresh runs. A list that doesn't come back keeps its last
 * good version, so a relay hiccup never un-hides anything. Nothing here
 * throws.
 */

import { verifyEvent } from 'nostr-tools/pure';
import { unionKeyed, type NostrEvent } from '$lib/relayCollect';
import { ORG_PUBKEY, pickOrgList } from '$lib/landing/curation';
import { LIST_RELAYS } from '$lib/landing/landingData.server';
import {
	EMPTY_ORG_MODERATION,
	ORG_MODERATION_LISTS,
	parseOrgModeration,
	type OrgModeration,
	type OrgModerationListName
} from './orgLists';

export const ORG_LISTS_FRESH_FOR_MS = 120_000;
export const ORG_LISTS_TIMEOUT_MS = 1500;
/** Not a routable URL: the adapter's page cache can never serve it. */
export const ORG_LISTS_CACHE_KEY = 'https://reads-org-lists.zap.cooking.invalid/v1';
const KEEP_SECONDS = 30 * 24 * 60 * 60;

/** One list as last seen: its event time (so an older copy never wins) and entries. */
interface ListSlot {
	createdAt: number;
	event: Pick<NostrEvent, 'tags' | 'pubkey' | 'kind' | 'created_at'>;
}

interface Entry {
	v: 1;
	/** ms */
	storedAt: number;
	lists: Partial<Record<OrgModerationListName, ListSlot>>;
}

interface CacheLike {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

export interface OrgListsDeps {
	cache?: CacheLike | null;
	waitUntil?: (p: Promise<unknown>) => void;
	/** ms */
	clock?: () => number;
	/** The newest verified org list per name; defaults to the relay race. */
	fetchLists?: () => Promise<Partial<Record<OrgModerationListName, NostrEvent>>>;
}

let memo: Entry | null = null;
let inflight: Promise<Entry | null> | null = null;

/** Tests only. */
export function __resetOrgListsMemo(): void {
	memo = null;
	inflight = null;
}

export async function fetchOrgListsFromRelays(
	timeoutMs = ORG_LISTS_TIMEOUT_MS
): Promise<Partial<Record<OrgModerationListName, NostrEvent>>> {
	const subs: Record<string, Record<string, unknown>> = {};
	for (const name of Object.keys(ORG_MODERATION_LISTS) as OrgModerationListName[]) {
		const { kind, d } = ORG_MODERATION_LISTS[name];
		subs[name] = { kinds: [kind], authors: [ORG_PUBKEY], '#d': [d], limit: 2 };
	}
	const verify = (e: NostrEvent) => verifyEvent(e as Parameters<typeof verifyEvent>[0]);
	// Every relay's answer, not the first: a fast relay holding a stale list
	// must not keep a newer block/hide update from taking effect.
	const { events } = await unionKeyed(LIST_RELAYS, subs, { timeoutMs });
	const out: Partial<Record<OrgModerationListName, NostrEvent>> = {};
	for (const name of Object.keys(subs) as OrgModerationListName[]) {
		const best = pickOrgList(events[name] ?? [], ORG_MODERATION_LISTS[name], verify);
		if (best) out[name] = best;
	}
	return out;
}

/** New lists over the last good ones: a missing list keeps its old copy, an older copy never replaces a newer one. */
export function mergeOrgLists(
	last: Entry['lists'],
	next: Partial<Record<OrgModerationListName, NostrEvent>>
): Entry['lists'] {
	const out: Entry['lists'] = { ...last };
	for (const name of Object.keys(ORG_MODERATION_LISTS) as OrgModerationListName[]) {
		const e = next[name];
		if (!e) continue;
		if (out[name] && out[name]!.createdAt > e.created_at) continue;
		out[name] = { createdAt: e.created_at, event: { tags: e.tags, pubkey: e.pubkey, kind: e.kind, created_at: e.created_at } };
	}
	return out;
}

function toModeration(entry: Entry | null): OrgModeration {
	if (!entry) return EMPTY_ORG_MODERATION;
	return parseOrgModeration(entry.lists.block?.event ?? null, entry.lists.hidden?.event ?? null);
}

async function readCache(cache: CacheLike | null): Promise<Entry | null> {
	if (!cache) return null;
	try {
		const res = await cache.match(new Request(ORG_LISTS_CACHE_KEY));
		if (!res) return null;
		const entry = (await res.json()) as Entry;
		return entry?.v === 1 && entry.lists && typeof entry.storedAt === 'number' ? entry : null;
	} catch {
		return null;
	}
}

async function writeCache(cache: CacheLike | null, entry: Entry): Promise<void> {
	if (!cache) return;
	try {
		await cache.put(
			new Request(ORG_LISTS_CACHE_KEY),
			new Response(JSON.stringify(entry), {
				headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${KEEP_SECONDS}` }
			})
		);
	} catch (err) {
		console.warn('[reads] org lists cache write failed:', err);
	}
}

function refresh(last: Entry | null, deps: OrgListsDeps): Promise<Entry | null> {
	if (inflight) return inflight;
	const clock = deps.clock ?? Date.now;
	const fetchLists = deps.fetchLists ?? (() => fetchOrgListsFromRelays());
	inflight = (async () => {
		let next: Partial<Record<OrgModerationListName, NostrEvent>> = {};
		try {
			next = await fetchLists();
		} catch (err) {
			console.warn('[reads] org lists fetch failed:', err);
		}
		const entry: Entry = { v: 1, storedAt: clock(), lists: mergeOrgLists(last?.lists ?? {}, next) };
		memo = entry;
		await writeCache(deps.cache ?? null, entry);
		return entry;
	})().finally(() => {
		inflight = null;
	});
	return inflight;
}

/**
 * The org's block/hide entries: fresh from memory or the cache when it can
 * be; stale while a background refresh runs; fetched (bounded by the
 * timeout) only when nothing is stored. Empty when even that fails.
 */
export async function getOrgModeration(deps: OrgListsDeps = {}): Promise<OrgModeration> {
	const clock = deps.clock ?? Date.now;
	const fresh = (e: Entry | null) => !!e && clock() - e.storedAt < ORG_LISTS_FRESH_FOR_MS;

	let entry = memo;
	if (!fresh(entry)) {
		const cached = await readCache(deps.cache ?? null);
		if (cached && (!entry || cached.storedAt > entry.storedAt)) entry = cached;
	}
	if (entry && fresh(entry)) {
		memo = entry;
		return toModeration(entry);
	}
	if (entry) {
		const p = refresh(entry, deps);
		if (deps.waitUntil) deps.waitUntil(p);
		return toModeration(entry);
	}
	return toModeration(await refresh(null, deps));
}
