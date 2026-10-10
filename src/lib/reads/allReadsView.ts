/**
 * "All reads" view helpers: what the spam rules see, and a cover that never
 * holds a flagged or moderated article. Pure.
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
 * is left). `clean` is only called then: the feed re-runs this on every
 * arriving article. Flagged articles stay out of the cover even when the
 * reader reveals them.
 */
export function cleanCover<A, C extends CoverLike<A>>(
	cover: C | null,
	clean: () => A[],
	isOut: (a: A) => boolean,
	recurate: (articles: A[]) => C | null
): C | null {
	if (!cover) return null;
	if (!coverArticles(cover).some(isOut)) return cover;
	const candidates = clean().filter((a) => !isOut(a));
	return candidates.length ? recurate(candidates) : null;
}

/**
 * The feed under the reveal line: flagged articles out unless revealed,
 * and how many there are (in the list as filtered so far, so the count
 * matches the category the reader is on).
 */
export function spamView<A extends { id: string }>(
	articles: A[],
	reasons: ReadonlyMap<string, unknown>,
	reveal: boolean
): { shown: A[]; spamCount: number } {
	const clean = articles.filter((a) => !reasons.has(a.id));
	return { shown: reveal ? articles : clean, spamCount: articles.length - clean.length };
}
