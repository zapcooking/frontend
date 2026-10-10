/**
 * Client-side spam rules for "All reads" (the open hashtag search).
 *
 * Each rule is a small pure function. A hit doesn't remove the article: the
 * page folds it under a "N hidden as likely spam · show" line, so nothing is
 * hidden silently. (Admin moderation, i.e. the org's block/hide lists and the
 * KV denylist, still never renders; see moderationClient.)
 *
 * The curated tab doesn't use these: the feed relay admits only trusted
 * authors and applies its own food rules.
 */

import { hashtagCount, MAX_HASHTAGS } from '$lib/hashtags';
import { normalizeForScan } from './moderation';

export interface SpamEventLike {
	id: string;
	pubkey: string;
	content: string;
	tags: string[][];
}

export type SpamReason = 'adult' | 'hashtags' | 'links' | 'duplicate' | 'short';

/**
 * Adult platforms. A link to any of these (or a subdomain) anywhere in the
 * article, its summary or its image tags is a hit. One list, one place.
 */
export const ADULT_PLATFORM_DOMAINS: readonly string[] = [
	'onlyfans.com',
	'fansly.com',
	'fanvue.com',
	'loyalfans.com',
	'justfor.fans',
	'fancentro.com',
	'manyvids.com',
	'clips4sale.com',
	'chaturbate.com',
	'stripchat.com',
	'myfreecams.com',
	'camsoda.com',
	'bongacams.com',
	'pornhub.com',
	'xvideos.com',
	'xhamster.com',
	'xnxx.com',
	'redtube.com',
	'youporn.com'
];

/**
 * Explicit adult words, matched whole-word after normalizeForScan (so
 * "n.s.f.w" and homoglyphs still hit). Deliberately narrow: words with food
 * meanings ("naked cake", "nude lipstick" colours, "foodporn") aren't here.
 */
export const ADULT_KEYWORDS: readonly string[] = [
	'onlyfans',
	'only fans',
	'fansly',
	'porn',
	'porno',
	'pornhub',
	'xxx',
	'nsfw',
	'nudes',
	'camgirl',
	'cam girl',
	'escort',
	'escorts',
	'hentai',
	'sex tape',
	'sexting'
];

/** Hashtag stuffing: the relay's (and web's) kind-1 cap, counted the same way. */
export const SPAM_MAX_HASHTAGS = MAX_HASHTAGS;
/** Link-dominated: fewer prose words than this alongside any link… */
export const LINKS_MIN_PROSE_WORDS = 60;
/** …or URLs making up more than this share of the article's characters. */
export const LINKS_MAX_URL_SHARE = 0.5;
/** Very short: fewer words than this (URLs and markup not counted). */
export const MIN_ARTICLE_WORDS = 120;
/** Duplicates: bodies shorter than this aren't compared (too little to fingerprint). */
export const DUPLICATE_MIN_CHARS = 200;

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]"']+/gi;
const NOSTR_REF_RE = /\bnostr:[a-z0-9]+/gi;

function tagValues(tags: string[][], name: string): string[] {
	return tags.filter((t) => t[0] === name && typeof t[1] === 'string').map((t) => t[1]);
}

function hostOf(url: string): string | null {
	try {
		const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
		return u.hostname.toLowerCase().replace(/\.$/, '');
	} catch {
		return null;
	}
}

function isAdultHost(host: string): boolean {
	return ADULT_PLATFORM_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

let keywordPatterns: RegExp[] | null = null;
function adultKeywordPatterns(): RegExp[] {
	if (!keywordPatterns) {
		keywordPatterns = ADULT_KEYWORDS.map((k) => {
			const words = normalizeForScan(k).split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
			return new RegExp(`\\b${words.join('\\s+')}\\b`);
		});
	}
	return keywordPatterns;
}

/** Links to an adult platform, or explicit adult words, anywhere in the article. */
export function isAdultSpam(e: SpamEventLike): boolean {
	const fields = [e.content, ...tagValues(e.tags, 'title'), ...tagValues(e.tags, 'summary'), ...tagValues(e.tags, 'image')];
	for (const field of fields) {
		for (const m of field.match(URL_RE) ?? []) {
			const host = hostOf(m);
			if (host && isAdultHost(host)) return true;
		}
	}
	const text = normalizeForScan([...fields, ...tagValues(e.tags, 't')].join(' '));
	return adultKeywordPatterns().some((p) => p.test(text));
}

/** More hashtags than the feed's cap: the greater of body hashtags and `t` tags. */
export function isHashtagStuffed(e: SpamEventLike): boolean {
	return hashtagCount(e.content, e.tags) > SPAM_MAX_HASHTAGS;
}

/**
 * The article's prose: markdown images, link targets, bare URLs, nostr:
 * references and markup removed. Link text stays (it's words a reader reads).
 */
export function proseOf(content: string): string {
	return content
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(URL_RE, ' ')
		.replace(NOSTR_REF_RE, ' ')
		.replace(/[#>*_~`|-]+/g, ' ');
}

export function wordCount(text: string): number {
	return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Links with almost no prose around them, or mostly URL characters. */
export function isLinkDominated(e: SpamEventLike): boolean {
	const urls = e.content.match(URL_RE) ?? [];
	if (urls.length === 0) return false;
	if (wordCount(proseOf(e.content)) < LINKS_MIN_PROSE_WORDS) return true;
	const urlChars = urls.reduce((n, u) => n + u.length, 0);
	const total = e.content.replace(/\s+/g, '').length;
	return total > 0 && urlChars / total > LINKS_MAX_URL_SHARE;
}

/** Fewer than MIN_ARTICLE_WORDS words of prose. */
export function isVeryShort(e: SpamEventLike): boolean {
	return wordCount(proseOf(e.content)) < MIN_ARTICLE_WORDS;
}

/** The body reduced to letters and digits: same text, any formatting. */
export function contentFingerprint(content: string): string | null {
	const norm = normalizeForScan(proseOf(content)).replace(/\s+/g, ' ');
	return norm.length >= DUPLICATE_MIN_CHARS ? norm : null;
}

/** Ids of every article in a fingerprint group with two or more authors. */
function duplicatesFrom(events: SpamEventLike[], fingerprint: (e: SpamEventLike) => string | null): Set<string> {
	const groups = new Map<string, SpamEventLike[]>();
	for (const e of events) {
		const fp = fingerprint(e);
		if (!fp) continue;
		const g = groups.get(fp);
		if (g) g.push(e);
		else groups.set(fp, [e]);
	}
	const out = new Set<string>();
	for (const g of groups.values()) {
		if (new Set(g.map((e) => e.pubkey)).size < 2) continue;
		for (const e of g) out.add(e.id);
	}
	return out;
}

/**
 * Ids of articles whose body is also published by a different author in the
 * same batch. Every copy is marked (a ring of copies has no "original" we
 * can trust); one author republishing their own text isn't a duplicate.
 */
export function duplicateIds(events: SpamEventLike[]): Set<string> {
	return duplicatesFrom(events, (e) => contentFingerprint(e.content));
}

type SingleReason = Exclude<SpamReason, 'duplicate'>;

/** Single-article rules, in the order a reason is reported. */
export const SPAM_RULES: ReadonlyArray<readonly [SingleReason, (e: SpamEventLike) => boolean]> = [
	['adult', isAdultSpam],
	['hashtags', isHashtagStuffed],
	['links', isLinkDominated],
	['short', isVeryShort]
];

function firstRule(e: SpamEventLike): SingleReason | null {
	return SPAM_RULES.find(([, rule]) => rule(e))?.[0] ?? null;
}

/**
 * classifySpam that remembers each article's single-rule result and
 * fingerprint by event id (an id is its content), for a feed that
 * re-classifies its whole list every time an article arrives.
 */
export function createSpamClassifier(): (events: SpamEventLike[]) => Map<string, SpamReason> {
	const single = new Map<string, SingleReason | null>();
	const prints = new Map<string, string | null>();
	const fingerprint = (e: SpamEventLike) => {
		if (!prints.has(e.id)) prints.set(e.id, contentFingerprint(e.content));
		return prints.get(e.id)!;
	};
	return (events) => {
		const out = new Map<string, SpamReason>();
		const dups = duplicatesFrom(events, fingerprint);
		for (const e of events) {
			if (!single.has(e.id)) single.set(e.id, firstRule(e));
			const reason = single.get(e.id) ?? (dups.has(e.id) ? 'duplicate' : null);
			if (reason) out.set(e.id, reason);
		}
		return out;
	};
}

/**
 * The first rule each article trips (id → reason). Articles that trip none
 * aren't in the map. The duplicate rule needs the whole batch, so pass
 * everything that could render together.
 */
export function classifySpam(events: SpamEventLike[]): Map<string, SpamReason> {
	return createSpamClassifier()(events);
}

/** How the reveal marks each reason. */
export const SPAM_REASON_LABELS: Record<SpamReason, string> = {
	adult: 'adult content',
	hashtags: 'hashtag stuffing',
	links: 'mostly links',
	duplicate: 'copied by another author',
	short: 'very short'
};
