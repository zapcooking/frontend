/**
 * The org key's feed-relay moderation lists, applied to Reads on the client
 * too. Pure (no network): parsing and the merge into the Reads blocklists.
 *
 *   30000 d=feed-block   `p` tags: authors the relay never serves
 *   30000 d=feed-hidden  `e` tags (event ids) and `a` tags (`kind:pubkey:d`,
 *                        every version of an article) the relay won't serve
 *
 * The curated tab already gets this from the relay. "All reads" searches
 * public relays, so it needs the same lists applied here. Only the org key
 * counts (ORG_PUBKEY, like the /explore lists); the relay also merges a
 * second admin key's lists, which this doesn't read.
 */

import { nip19 } from 'nostr-tools';
import { listPubkeys, canonicalCoordinate, type ListEventLike } from '$lib/landing/curation';
import type { ReadsModerationLists } from './moderationConfig';

export const ORG_MODERATION_LISTS = {
	block: { kind: 30000, d: 'feed-block' },
	hidden: { kind: 30000, d: 'feed-hidden' }
} as const;

export type OrgModerationListName = keyof typeof ORG_MODERATION_LISTS;

export interface OrgModeration {
	blockedPubkeys: string[];
	hiddenEventIds: string[];
	/** `kind:pubkey:d`, lower-case pubkey. */
	hiddenCoordinates: string[];
}

export const EMPTY_ORG_MODERATION: OrgModeration = { blockedPubkeys: [], hiddenEventIds: [], hiddenCoordinates: [] };

const HEX64 = /^[0-9a-f]{64}$/;

/** `e` tags in tag order: hex event ids, first occurrence only. */
export function listEventIds(e: Pick<ListEventLike, 'tags'>): string[] {
	const out: string[] = [];
	for (const t of e.tags) {
		if (t[0] !== 'e') continue;
		const id = (t[1] || '').toLowerCase();
		if (HEX64.test(id) && !out.includes(id)) out.push(id);
	}
	return out;
}

/** `a` tags of any kind (the relay hides recipes and articles alike), normalised. */
export function listAnyCoordinates(e: Pick<ListEventLike, 'tags'>): string[] {
	const out: string[] = [];
	for (const t of e.tags) {
		if (t[0] !== 'a') continue;
		const c = canonicalCoordinate(t[1]);
		if (!c) continue;
		const key = `${c.kind}:${c.pubkey}:${c.identifier}`;
		if (!out.includes(key)) out.push(key);
	}
	return out;
}

/** The two lists (either may be missing) as one set of entries. */
export function parseOrgModeration(block: ListEventLike | null, hidden: ListEventLike | null): OrgModeration {
	return {
		blockedPubkeys: block ? listPubkeys(block) : [],
		hiddenEventIds: hidden ? listEventIds(hidden) : [],
		hiddenCoordinates: hidden ? listAnyCoordinates(hidden) : []
	};
}

/** `kind:pubkey:d` → the naddr Reads moderation matches articles by (no relay hints). */
export function coordinateToNaddr(coordinate: string): string | null {
	const c = canonicalCoordinate(coordinate);
	if (!c) return null;
	try {
		return nip19.naddrEncode({ kind: c.kind, pubkey: c.pubkey, identifier: c.identifier });
	} catch {
		return null;
	}
}

/** The org entries as a Reads moderation overlay (merged with mergeReadsLists). */
export function orgModerationAsReadsLists(org: OrgModeration): Omit<ReadsModerationLists, 'denylist'> {
	return {
		blockedPubkeys: [...org.blockedPubkeys],
		blockedEventIds: [...org.hiddenEventIds],
		blockedNaddrs: org.hiddenCoordinates.map(coordinateToNaddr).filter((n): n is string => !!n)
	};
}
