/**
 * KV-backed Reads moderation store.
 *
 * Layout in GATED_CONTENT (same namespace as cookbook promos):
 *   reads_mod_config              → ReadsModerationLists
 *   reads_mod:autoblock:<pubkey>  → per-author auto-block (merge-safe)
 *   reads_mod:log:<iso>:<id>      → review log row (keyword hits + user reports)
 *
 * Empty KV falls back to DEFAULT_READS_MODERATION so the seed blocklist
 * works in local dev and on first deploy. Keyword auto-blocks are written
 * as individual keys so concurrent hits cannot clobber each other. Admin
 * saves still write `reads_mod_config` (unioned with seed pubkeys/ids/naddrs
 * so a wipe of one field cannot un-block the known spam account).
 */

import { verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { DEFAULT_READS_MODERATION, type ReadsModerationLists } from './moderationConfig';
import {
	cloneLists,
	isHex64,
	isNaddr,
	mergeReadsLists,
	normalizeForScan
} from './moderation';

const HIT_EVENT_KINDS = new Set([30023, 35000]);
const MAX_HIT_EVENT_BYTES = 512 * 1024;

export type ReadsModerationKV =
	| {
			get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
			put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
			delete(key: string): Promise<void>;
			list?(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
				keys: { name: string }[];
				list_complete?: boolean;
				cursor?: string;
			}>;
	  }
	| null
	| undefined;

const CONFIG_KEY = 'reads_mod_config';
const AUTOBLOCK_PREFIX = 'reads_mod:autoblock:';
const LOG_PREFIX = 'reads_mod:log:';
const LOG_TTL_SECONDS = 90 * 24 * 60 * 60;
const HIT_DEDUP_PREFIX = 'reads_mod:dedup:';
const HIT_DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;

export type ReadsReviewKind = 'keyword' | 'report';

export interface ReadsReviewLog {
	kind: ReadsReviewKind;
	eventId: string;
	pubkey: string;
	naddr: string;
	matchedTerm?: string;
	field?: string;
	reason?: string;
	details?: string;
	createdAt: string;
	ipHash: string;
}

let memConfig: ReadsModerationLists | null = null;
const memAutoblocks = new Set<string>();
const memLogs: ReadsReviewLog[] = [];
const memDedup = new Set<string>();

function isListsShape(value: unknown): value is ReadsModerationLists {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		Array.isArray(v.blockedPubkeys) &&
		Array.isArray(v.blockedEventIds) &&
		Array.isArray(v.blockedNaddrs) &&
		Array.isArray(v.denylist)
	);
}

function unionPubkeys(lists: ReadsModerationLists, extra: string[]): ReadsModerationLists {
	if (extra.length === 0) return lists;
	const seen = new Set(lists.blockedPubkeys);
	const blockedPubkeys = [...lists.blockedPubkeys];
	for (const raw of extra) {
		const pk = raw.trim().toLowerCase();
		if (!isHex64(pk) || seen.has(pk)) continue;
		seen.add(pk);
		blockedPubkeys.push(pk);
	}
	return { ...lists, blockedPubkeys };
}

async function listAutoblockPubkeys(kv: ReadsModerationKV): Promise<string[]> {
	if (!kv) return [...memAutoblocks];
	if (!kv.list) return [];
	const pks: string[] = [];
	try {
		let cursor: string | undefined;
		do {
			const page = await kv.list({ prefix: AUTOBLOCK_PREFIX, limit: 1000, cursor });
			for (const key of page.keys) {
				const pk = key.name.slice(AUTOBLOCK_PREFIX.length).toLowerCase();
				if (isHex64(pk)) pks.push(pk);
			}
			cursor = page.list_complete === false ? page.cursor : undefined;
		} while (cursor);
	} catch (err) {
		console.warn('[reads-moderation] KV autoblock list failed:', err);
	}
	return pks;
}

async function pruneAutoblockKeys(kv: ReadsModerationKV, keep: Set<string>): Promise<void> {
	if (!kv) {
		for (const pk of [...memAutoblocks]) {
			if (!keep.has(pk)) memAutoblocks.delete(pk);
		}
		return;
	}
	if (!kv.list) return;
	const extra = await listAutoblockPubkeys(kv);
	for (const pk of extra) {
		if (keep.has(pk)) continue;
		try {
			await kv.delete(AUTOBLOCK_PREFIX + pk);
		} catch (err) {
			console.warn('[reads-moderation] KV autoblock delete failed:', err);
		}
	}
}

export async function loadReadsModerationLists(
	kv: ReadsModerationKV
): Promise<ReadsModerationLists> {
	let lists: ReadsModerationLists;
	if (kv) {
		lists = cloneLists(DEFAULT_READS_MODERATION);
		try {
			const raw = (await kv.get(CONFIG_KEY, 'text')) as string | null;
			if (raw) {
				const parsed = JSON.parse(raw) as unknown;
				if (isListsShape(parsed)) {
					lists = mergeReadsLists(DEFAULT_READS_MODERATION, parsed);
				}
			}
		} catch (err) {
			console.warn('[reads-moderation] KV config read failed:', err);
		}
	} else {
		lists = mergeReadsLists(DEFAULT_READS_MODERATION, memConfig);
	}
	return unionPubkeys(lists, await listAutoblockPubkeys(kv));
}

export async function saveReadsModerationLists(
	kv: ReadsModerationKV,
	lists: ReadsModerationLists
): Promise<ReadsModerationLists> {
	const next = mergeReadsLists(DEFAULT_READS_MODERATION, lists);
	if (kv) {
		await kv.put(CONFIG_KEY, JSON.stringify(next));
	} else {
		memConfig = next;
	}
	await pruneAutoblockKeys(kv, new Set(next.blockedPubkeys));
	return loadReadsModerationLists(kv);
}

/**
 * Merge-safe auto-block: each pubkey is its own KV key so two concurrent
 * hits cannot overwrite each other's append to `reads_mod_config`.
 */
export async function addBlockedPubkey(
	kv: ReadsModerationKV,
	pubkey: string
): Promise<ReadsModerationLists> {
	const pk = pubkey.trim().toLowerCase();
	if (!isHex64(pk)) return loadReadsModerationLists(kv);
	if (kv) {
		await kv.put(AUTOBLOCK_PREFIX + pk, '1');
	} else {
		memAutoblocks.add(pk);
	}
	return loadReadsModerationLists(kv);
}

/**
 * Accept a signed kind 30023/35000 event from a public client. Returns null
 * unless the signature verifies — callers must not auto-block on the
 * unauthenticated `pubkey` field alone.
 */
export function parseVerifiedReadsEvent(raw: unknown): NostrEvent | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	let encoded: Uint8Array;
	try {
		encoded = new TextEncoder().encode(JSON.stringify(raw));
	} catch {
		return null;
	}
	if (encoded.length > MAX_HIT_EVENT_BYTES) return null;

	const e = raw as Record<string, unknown>;
	if (typeof e.id !== 'string' || typeof e.pubkey !== 'string' || typeof e.sig !== 'string') {
		return null;
	}
	if (typeof e.content !== 'string' || typeof e.kind !== 'number' || typeof e.created_at !== 'number') {
		return null;
	}
	if (!HIT_EVENT_KINDS.has(e.kind) || !Array.isArray(e.tags)) return null;

	// Rebuild a plain event so a copied `Symbol(verified)` cannot skip schnorr.
	const ev: NostrEvent = {
		id: e.id,
		pubkey: e.pubkey,
		created_at: e.created_at,
		kind: e.kind,
		tags: e.tags as NostrEvent['tags'],
		content: e.content,
		sig: e.sig
	};
	try {
		if (!verifyEvent(ev)) return null;
	} catch {
		return null;
	}
	return ev;
}

function sanitizeLog(input: Partial<ReadsReviewLog>, ipHash: string): ReadsReviewLog | null {
	const pubkey = (input.pubkey || '').trim().toLowerCase();
	const eventId = (input.eventId || '').trim().toLowerCase();
	const naddr = (input.naddr || '').trim().toLowerCase();
	if (!isHex64(pubkey)) return null;
	if (eventId && !isHex64(eventId)) return null;
	if (naddr && !isNaddr(naddr)) return null;

	const kind: ReadsReviewKind = input.kind === 'report' ? 'report' : 'keyword';
	return {
		kind,
		eventId,
		pubkey,
		naddr,
		matchedTerm: typeof input.matchedTerm === 'string' ? input.matchedTerm.slice(0, 64) : undefined,
		field: typeof input.field === 'string' ? input.field.slice(0, 32) : undefined,
		reason: typeof input.reason === 'string' ? input.reason.slice(0, 32) : undefined,
		details: typeof input.details === 'string' ? input.details.slice(0, 500) : undefined,
		createdAt: new Date().toISOString(),
		ipHash
	};
}

export async function recordReadsReview(
	kv: ReadsModerationKV,
	input: Partial<ReadsReviewLog>,
	ipHash: string
): Promise<{ recorded: boolean; duplicate?: boolean; log?: ReadsReviewLog }> {
	const log = sanitizeLog(input, ipHash);
	if (!log) return { recorded: false };

	const dedupKey = `${log.kind}:${log.eventId || log.naddr || log.pubkey}:${log.matchedTerm || log.reason || ''}`;

	if (kv) {
		try {
			const existing = (await kv.get(HIT_DEDUP_PREFIX + dedupKey, 'text')) as string | null;
			if (existing) return { recorded: true, duplicate: true, log };
			await kv.put(HIT_DEDUP_PREFIX + dedupKey, '1', {
				expirationTtl: HIT_DEDUP_TTL_SECONDS
			});
			const logKey = `${LOG_PREFIX}${log.createdAt}:${crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10)}`;
			await kv.put(logKey, JSON.stringify(log), { expirationTtl: LOG_TTL_SECONDS });
			return { recorded: true, log };
		} catch (err) {
			console.error('[reads-moderation] KV log write failed:', err);
			return { recorded: false };
		}
	}

	if (memDedup.has(dedupKey)) return { recorded: true, duplicate: true, log };
	memDedup.add(dedupKey);
	memLogs.unshift(log);
	if (memLogs.length > 500) memLogs.length = 500;
	return { recorded: true, log };
}

export async function listReadsReviewLogs(
	kv: ReadsModerationKV,
	limit = 200
): Promise<ReadsReviewLog[]> {
	if (!kv?.list) {
		return memLogs.slice(0, limit);
	}

	const logs: ReadsReviewLog[] = [];
	try {
		let cursor: string | undefined;
		do {
			const page = await kv.list({ prefix: LOG_PREFIX, limit: 1000, cursor });
			for (const key of page.keys) {
				const raw = (await kv.get(key.name, 'text')) as string | null;
				if (!raw) continue;
				try {
					logs.push(JSON.parse(raw) as ReadsReviewLog);
				} catch {
					// skip malformed
				}
			}
			cursor = page.list_complete === false ? page.cursor : undefined;
		} while (cursor && logs.length < limit);
	} catch (err) {
		console.error('[reads-moderation] KV log list failed:', err);
	}

	logs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	return logs.slice(0, limit);
}

export function termIsInDenylist(term: string, lists: ReadsModerationLists): boolean {
	const needle = normalizeForScan(term);
	if (!needle) return false;
	return lists.denylist.some((t) => normalizeForScan(t) === needle);
}
