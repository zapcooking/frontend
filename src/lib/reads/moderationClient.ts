/**
 * Client-side Reads moderation: seed lists + KV overlay, keyword-hit
 * reporting, and local auto-block so spam disappears before the server
 * round-trip lands.
 */

import { browser } from '$app/environment';
import { writable } from 'svelte/store';
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
			bumpVersion();
		} catch {
			// Seed lists still apply.
		} finally {
			overlayInFlight = null;
		}
	})();

	return overlayInFlight;
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

function postKeywordHit(hit: ReadsModerationHit): void {
	if (!browser) return;
	const key = hit.eventId || `${hit.pubkey}:${hit.naddr}:${hit.matchedTerm}`;
	if (postedHits.has(key)) return;
	postedHits.add(key);

	const body = JSON.stringify({
		kind: 'keyword',
		eventId: hit.eventId || '',
		pubkey: hit.pubkey || '',
		naddr: hit.naddr || '',
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
		postKeywordHit(result);
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
