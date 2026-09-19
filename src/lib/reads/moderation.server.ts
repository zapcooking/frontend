/**
 * KV-backed Reads moderation store.
 *
 * Layout in GATED_CONTENT (same namespace as cookbook promos):
 *   reads_mod_config          → ReadsModerationLists
 *   reads_mod:log:<iso>:<id>  → review log row (keyword hits + user reports)
 *
 * Empty KV falls back to DEFAULT_READS_MODERATION so the seed blocklist
 * works in local dev and on first deploy. The first admin save or
 * keyword auto-block writes the merged lists to KV, after which KV is
 * the runtime source of truth (unioned with seed pubkeys/ids/naddrs so
 * a wipe of one field cannot un-block the known spam account).
 */

import { DEFAULT_READS_MODERATION, type ReadsModerationLists } from './moderationConfig';
import {
	cloneLists,
	isHex64,
	isNaddr,
	mergeReadsLists,
	normalizeForScan
} from './moderation';

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

export async function loadReadsModerationLists(
	kv: ReadsModerationKV
): Promise<ReadsModerationLists> {
	if (kv) {
		try {
			const raw = (await kv.get(CONFIG_KEY, 'text')) as string | null;
			if (raw) {
				const parsed = JSON.parse(raw) as unknown;
				if (isListsShape(parsed)) {
					return mergeReadsLists(DEFAULT_READS_MODERATION, parsed);
				}
			}
		} catch (err) {
			console.warn('[reads-moderation] KV config read failed:', err);
		}
		return cloneLists(DEFAULT_READS_MODERATION);
	}
	return mergeReadsLists(DEFAULT_READS_MODERATION, memConfig);
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
	return next;
}

export async function addBlockedPubkey(
	kv: ReadsModerationKV,
	pubkey: string
): Promise<ReadsModerationLists> {
	const pk = pubkey.trim().toLowerCase();
	if (!isHex64(pk)) return loadReadsModerationLists(kv);
	const current = await loadReadsModerationLists(kv);
	if (current.blockedPubkeys.includes(pk)) return current;
	return saveReadsModerationLists(kv, {
		...current,
		blockedPubkeys: [...current.blockedPubkeys, pk]
	});
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
