/**
 * "All reads" view helpers: what the spam rules see, which articles fold
 * under which reveal line, and a cover that never holds a folded or
 * moderated article. Pure.
 */

import type { SpamEventLike } from './spamRules';

interface ArticleLike {
	id: string;
	author: { pubkey: string };
	event: { content?: string; tags: string[][] };
}

interface CoverLike<A> {
	hero?: A;
	secondary?: A[];
	tertiary?: A[];
}

export function toSpamEvent(a: ArticleLike): SpamEventLike {
	return { id: a.id, pubkey: a.author.pubkey, content: a.event.content || '', tags: a.event.tags };
}

export function coverArticles<A>(cover: CoverLike<A>): A[] {
	return [cover.hero, ...(cover.secondary ?? []), ...(cover.tertiary ?? [])].filter((a): a is A => !!a);
}

/**
 * The cover as picked, unless it holds an article that mustn't show
 * (`isOut`): then a new pick from the `clean` candidates (null when nothing
 * is left). With no cover yet it picks one once a clean candidate exists:
 * a cover cleared while authors were pending comes back when they're
 * cleared. `clean` is only called in those two cases: the feed re-runs
 * this on every arriving article. Flagged articles stay out of the cover
 * even when the reader reveals them.
 */
export function cleanCover<A, C extends CoverLike<A>>(
	cover: C | null,
	clean: () => A[],
	isOut: (a: A) => boolean,
	recurate: (articles: A[]) => C | null
): C | null {
	if (cover && !coverArticles(cover).some(isOut)) return cover;
	const candidates = clean().filter((a) => !isOut(a));
	return candidates.length ? recurate(candidates) : null;
}

/** An author's trust as the feed sees it; absent = still being looked up. */
export type AuthorTrustLike = 'trusted' | 'stranger' | 'unknown';

/** Which reveal line an article sits under, if any. */
export type FoldReason = 'spam' | 'stranger' | 'pending';

/**
 * Why an article isn't shown normally: spam (whoever wrote it, trusted
 * authors included), else an author with no trust connection, else an
 * author still being looked up. Null: shown. With no trust map (the
 * curated tab) only spam folds.
 */
export function foldReason(
	a: { id: string; author: { pubkey: string } },
	spam: ReadonlyMap<string, unknown>,
	trust: ReadonlyMap<string, AuthorTrustLike> | null
): FoldReason | null {
	if (spam.has(a.id)) return 'spam';
	if (!trust) return null;
	const t = trust.get(a.author.pubkey.toLowerCase());
	if (t === undefined) return 'pending';
	return t === 'stranger' ? 'stranger' : null;
}

/**
 * The feed under the two reveal lines. Spam and strangers are counted
 * (in the list as filtered so far, so the counts match the category the
 * reader is on) and shown in place when their line is revealed. Pending
 * authors are held back uncounted until their answer lands: never shown
 * unchecked, never hidden for good (the lookup always settles).
 */
export function readsFold<A extends { id: string; author: { pubkey: string } }>(
	articles: A[],
	spam: ReadonlyMap<string, unknown>,
	trust: ReadonlyMap<string, AuthorTrustLike> | null,
	reveal: { spam: boolean; strangers: boolean }
): { shown: A[]; spamCount: number; strangerCount: number } {
	const shown: A[] = [];
	let spamCount = 0;
	let strangerCount = 0;
	for (const a of articles) {
		const why = foldReason(a, spam, trust);
		if (why === 'spam') spamCount++;
		if (why === 'stranger') strangerCount++;
		if (why === null || (why === 'spam' && reveal.spam) || (why === 'stranger' && reveal.strangers)) shown.push(a);
	}
	return { shown, spamCount, strangerCount };
}
