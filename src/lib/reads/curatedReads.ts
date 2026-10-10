/**
 * The curated Reads source: long-form articles from the feed relay, which
 * only admits trusted authors and applies its food rules (T2 articles on a
 * food tag alone wait for the labeler, feed-relay #102; admins hide items
 * with curate.sh, #103). Nothing here touches the open hashtag search: spam
 * reaches Reads through public relays, never through this source.
 *
 * Anonymous by construction (raw WebSocket, AUTH challenges ignored), so a
 * signed-in reader is never prompted. Articles are public at any age on the
 * relay, so the whole archive comes back.
 */

import { collect, type NostrEvent } from '$lib/relayCollect';
import { isRecipeEvent, newestByCoordinate, seconds } from '$lib/landing/content';

export const READS_RELAY = 'wss://feed.zap.cooking';
export const CURATED_READS_LIMIT = 300;
export const CURATED_READS_TIMEOUT_MS = 5000;

export interface CuratedReadsResult {
	/** Non-recipe articles, newest version per coordinate, newest first. */
	events: NostrEvent[];
	/** The relay answered in full (EOSE); false on timeout or error. */
	complete: boolean;
}

const publishedAt = (e: NostrEvent) => {
	const p = seconds(Number(e.tags.find((t) => t[0] === 'published_at')?.[1]));
	return Number.isFinite(p) && p > 0 ? p : e.created_at;
};

export async function fetchCuratedReads(timeoutMs = CURATED_READS_TIMEOUT_MS): Promise<CuratedReadsResult> {
	const r = await collect(READS_RELAY, { reads: { kinds: [30023], limit: CURATED_READS_LIMIT } }, { timeoutMs });
	const events = newestByCoordinate(r.events.reads.filter((e) => e.kind === 30023 && !isRecipeEvent(e))).sort(
		(a, b) => publishedAt(b) - publishedAt(a)
	);
	return { events, complete: r.done.reads };
}
