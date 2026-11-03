/**
 * Which kind 30004 events are Recipe Packs (pure; used by /packs).
 *
 * Kind 30004 is also used by the org key's /explore curation lists
 * (`explore-*` d-tags, $lib/landing/curation); those are never packs.
 */

import { isExploreCurationDTag } from './landing/curation';

export interface PackEventLike {
	pubkey: string;
	created_at?: number;
	tags?: string[][];
}

/**
 * Drop anything missing a `d` tag or an `a` reference (Recipe Packs are
 * addressable; empty or bare-d packs would render as broken cards) and the
 * /explore curation lists, keep only the newest event per (pubkey, d-tag),
 * then sort newest first.
 */
export function sortAndDedupePacks<E extends PackEventLike>(events: E[]): E[] {
	const byKey = new Map<string, E>();
	for (const e of events) {
		const dTag = e.tags?.find((t) => t[0] === 'd')?.[1];
		if (!dTag || isExploreCurationDTag(dTag) || !e.tags?.some((t) => t[0] === 'a')) continue;
		const key = `${e.pubkey}:${dTag}`;
		const existing = byKey.get(key);
		if (!existing || (e.created_at || 0) > (existing.created_at || 0)) byKey.set(key, e);
	}
	return Array.from(byKey.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}
