/**
 * Client-side Reads moderation: seed lists + KV overlay, keyword-hit
 * reporting, and local auto-block so spam disappears before the server
 * round-trip lands.
 */

import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import { DEFAULT_READS_MODERATION, type ReadsModerationLists } from './moderationConfig';
import {
	compileModerationLists,
	evaluateReadsContent,
	isBlockedReadsPointer,
	mergeReadsLists,
	type CompiledReadsLists,
	type ReadsEventLike,
	type ReadsModerationHit,
	type ReadsPointer
} from './moderation';

const OVERLAY_TTL_MS = 60 * 1000;

let overlay: Partial<ReadsModerationLists> | null = null;
let overlayFetchedAt = 0;
let overlayInFlight: Promise<void> | null = null;
const localBlockedPubkeys = new Set<string>();
const postedHits = new Set<string>();

/** Reactive compiled lists so feed UIs can re-filter after overlay load. */
export const readsModerationVersion = writable(0);

/**
 * True once the first overlay fetch has settled (loaded or failed). "All
 * reads" waits for it, so an org-blocked or hidden article never renders
 * while the lists are still on their way.
 */
export const readsModerationReady = writable(false);

/**
 * True once an overlay fetch has succeeded: the curated hides are really
 * here. Unlike `readsModerationReady` (which a failed fetch also sets),
 * this is what a surface that must never show a hidden article waits for
 * (the /feed column's Fresh reads).
 */
export const readsModerationLoaded = writable(false);

function bumpVersion() {
	readsModerationVersion.update((n) => n + 1);
}

function mergedLists(): ReadsModerationLists {
	const merged = mergeReadsLists(DEFAULT_READS_MODERATION, overlay);
	if (localBlockedPubkeys.size > 0) {
		for (const pk of localBlockedPubkeys) {
			if (!merged.blockedPubkeys.includes(pk)) merged.blockedPubkeys.push(pk);
		}
	}
	return merged;
}

function compiled(): CompiledReadsLists {
	return compileModerationLists(mergedLists());
}

async function fetchOverlay(): Promise<void> {
	if (!browser) return;
	const now = Date.now();
	if (overlay && now - overlayFetchedAt < OVERLAY_TTL_MS) return;
	if (overlayInFlight) return overlayInFlight;

	overlayInFlight = (async () => {
		try {
			const res = await fetch('/api/reads/moderation', {
				headers: { accept: 'application/json' }
			});
			if (!res.ok) return;
			const data = (await res.json()) as Partial<ReadsModerationLists>;
			overlay = {
				blockedPubkeys: Array.isArray(data.blockedPubkeys) ? data.blockedPubkeys : [],
				blockedEventIds: Array.isArray(data.blockedEventIds) ? data.blockedEventIds : [],
				blockedNaddrs: Array.isArray(data.blockedNaddrs) ? data.blockedNaddrs : [],
				denylist: Array.isArray(data.denylist) ? data.denylist : []
			};
			overlayFetchedAt = Date.now();
			readsModerationLoaded.set(true);
			bumpVersion();
		} catch {
			// Seed lists still apply.
		} finally {
			overlayInFlight = null;
			readsModerationReady.set(true);
		}
	})();

	return overlayInFlight;
}

/**
 * Fetches the overlay unless it is fresh (a failed one is tried again), and
 * says whether the curated hides are loaded — for surfaces that must stay
 * hidden rather than show an article the hides would remove.
 */
export async function readsModerationAvailable(): Promise<boolean> {
	if (!browser) return false;
	await fetchOverlay();
	return get(readsModerationLoaded);
}

export function ensureReadsModerationLoaded(): void {
	if (!browser) return;
	void fetchOverlay();
}

function rememberLocalBlock(pubkey: string | undefined) {
	if (!pubkey) return;
	const pk = pubkey.toLowerCase();
	if (localBlockedPubkeys.has(pk)) return;
	localBlockedPubkeys.add(pk);
	bumpVersion();
}

function serializeSignedEvent(event: ReadsEventLike): Record<string, unknown> | null {
	const maybeRaw = event as ReadsEventLike & {
		rawEvent?: () => unknown;
		sig?: string;
		created_at?: number;
	};
	const raw = typeof maybeRaw.rawEvent === 'function' ? maybeRaw.rawEvent() : maybeRaw;
	if (!raw || typeof raw !== 'object') return null;
	const e = raw as Record<string, unknown>;
	if (typeof e.id !== 'string' || typeof e.pubkey !== 'string' || typeof e.sig !== 'string') {
		return null;
	}
	if (typeof e.kind !== 'number' || typeof e.created_at !== 'number' || typeof e.content !== 'string') {
		return null;
	}
	if (!Array.isArray(e.tags)) return null;
	return {
		id: e.id,
		pubkey: e.pubkey,
		created_at: e.created_at,
		kind: e.kind,
		tags: e.tags,
		content: e.content,
		sig: e.sig
	};
}

function postKeywordHit(hit: ReadsModerationHit, event: ReadsEventLike): void {
	if (!browser) return;
	const signed = serializeSignedEvent(event);
	if (!signed) return;
	const key = hit.eventId || `${hit.pubkey}:${hit.naddr}:${hit.matchedTerm}`;
	if (postedHits.has(key)) return;
	postedHits.add(key);

	const body = JSON.stringify({
		event: signed,
		matchedTerm: hit.matchedTerm || '',
		field: hit.field || ''
	});

	try {
		void fetch('/api/reads/moderation/hit', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			keepalive: true
		});
	} catch {
		// Logging is best-effort.
	}
}

export function isBlockedReadsPointerClient(pointer: ReadsPointer): boolean {
	ensureReadsModerationLoaded();
	return isBlockedReadsPointer(pointer, compiled());
}

/**
 * Filter used by every client Reads query/render path. Keyword matches
 * auto-block the author locally and fire a review-log write.
 */
export function isBlockedFromReads(event: ReadsEventLike): boolean {
	ensureReadsModerationLoaded();
	const result = evaluateReadsContent(event, compiled());
	if (!result.blocked) return false;
	if (result.reason === 'keyword') {
		rememberLocalBlock(result.pubkey);
		postKeywordHit(result, event);
	}
	return true;
}

export async function submitReadsReport(input: {
	eventId?: string;
	pubkey?: string;
	naddr?: string;
	reason: 'nsfw' | 'spam' | 'other';
	details?: string;
}): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await fetch('/api/reads/moderation/report', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(input)
		});
		if (res.status === 429) return { ok: false, error: 'rate_limited' };
		if (!res.ok) return { ok: false, error: 'network' };
		return { ok: true };
	} catch {
		return { ok: false, error: 'network' };
	}
}
