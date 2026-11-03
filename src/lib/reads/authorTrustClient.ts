/**
 * The browser side of the "All reads" trust check: a store of verdicts per
 * author, filled in batches as articles arrive (see authorTrust for the
 * rules). Authors not in the store yet are pending.
 *
 * Profiles come from public relays anonymously (raw WebSocket, no NDK, so
 * no signer prompt). Their signatures are checked, so a relay can't attach
 * a NIP-05 the author never claimed, or shadow their real profile with a
 * forged newer one.
 */

import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { verifyEvent } from 'nostr-tools/pure';
import { unionKeyed, type NostrEvent } from '$lib/relayCollect';
import {
	TRUST_TIMEOUT_MS,
	TRUST_URL,
	chunk,
	nip05ClaimsFromProfiles,
	parseTrustResponse,
	resolveAuthorTrust,
	type TrustDeps,
	type TrustVerdict
} from './authorTrust';

export const PROFILE_RELAYS = ['wss://purplepag.es', 'wss://relay.primal.net', 'wss://relay.damus.io'];
export const PROFILE_TIMEOUT_MS = 2500;
export const NIP05_CHECK_TIMEOUT_MS = 5000;
/** Authors per kind-0 subscription. */
const PROFILE_BATCH = 100;
/** Articles arrive in bursts: one lookup covers a burst. */
const FLUSH_DELAY_MS = 100;

/** Verdicts so far; an author absent from it is pending. */
export const readsAuthorTrust = writable<ReadonlyMap<string, TrustVerdict>>(new Map());

async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

function isSigned(e: NostrEvent): boolean {
	try {
		return verifyEvent(e as Parameters<typeof verifyEvent>[0]);
	} catch {
		return false;
	}
}

export const browserTrustDeps: TrustDeps = {
	now: () => Date.now(),
	storage: browser && typeof localStorage !== 'undefined' ? localStorage : null,
	async askRelay(pubkeys) {
		try {
			const res = await withTimeout(
				TRUST_URL,
				{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pubkeys }) },
				TRUST_TIMEOUT_MS
			);
			// 429 (rate limit) and 503 (trust set still loading) mean "ask later", not "untrusted".
			if (!res.ok) return null;
			return parseTrustResponse(await res.json(), pubkeys);
		} catch {
			return null;
		}
	},
	async nip05Claims(pubkeys) {
		const subs: Record<string, Record<string, unknown>> = {};
		chunk(pubkeys, PROFILE_BATCH).forEach((authors, i) => {
			subs[`p${i}`] = { kinds: [0], authors, limit: authors.length * 2 };
		});
		const { events, anyDone } = await unionKeyed(PROFILE_RELAYS, subs, { timeoutMs: PROFILE_TIMEOUT_MS });
		if (!Object.values(anyDone).some(Boolean)) return null;
		return nip05ClaimsFromProfiles(Object.values(events).flat().filter(isSigned));
	},
	async verifyNip05(checks) {
		try {
			const res = await withTimeout(
				'/api/reads/nip05',
				{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checks }) },
				NIP05_CHECK_TIMEOUT_MS
			);
			// 429 and errors: "not verified for now" (the resolver folds them uncached).
			if (!res.ok) return null;
			const body = (await res.json()) as { verified?: unknown; deferred?: unknown };
			if (!Array.isArray(body.verified)) return null;
			const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
			return { verified: new Set(strings(body.verified)), deferred: new Set(strings(body.deferred)) };
		} catch {
			return null;
		}
	}
};

const requested = new Set<string>();
let queued = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(deps: TrustDeps): Promise<void> {
	timer = null;
	const batch = [...queued];
	queued = new Set();
	if (!batch.length) return;
	const verdicts = await resolveAuthorTrust(batch, deps);
	// Anything the resolver skipped (malformed keys) still settles, shown normally.
	for (const pk of batch) if (!verdicts.has(pk)) verdicts.set(pk, 'unknown');
	readsAuthorTrust.update((m) => new Map([...m, ...verdicts]));
}

/** Looks up authors not asked about yet in this session (batched, debounced). */
export function ensureAuthorTrust(pubkeys: Iterable<string>, deps: TrustDeps = browserTrustDeps): void {
	if (!browser) return;
	for (const raw of pubkeys) {
		const pk = raw.toLowerCase();
		if (requested.has(pk)) continue;
		requested.add(pk);
		queued.add(pk);
	}
	if (queued.size && !timer) timer = setTimeout(() => void flush(deps), FLUSH_DELAY_MS);
}
