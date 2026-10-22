/** Small display helpers for the landing page (pure). */

import { nip19 } from 'nostr-tools';

/** `npub1abcd…wxyz` for someone without a profile name. */
export function shortName(pubkey: string): string {
	try {
		const npub = nip19.npubEncode(pubkey);
		return `${npub.slice(0, 9)}…${npub.slice(-4)}`;
	} catch {
		return 'a cook';
	}
}

/** "46 posts in 14 days". */
export function topicCountLabel(n: number): string {
	return `${n} ${n === 1 ? 'post' : 'posts'} in 14 days`;
}

/** Tag pages take the tag as written in CURATED_TAG_SECTIONS. */
export function tagHref(tag: string): string {
	return `/tag/${encodeURIComponent(tag)}`;
}
