import { describe, it, expect } from 'vitest';
import {
	ADULT_PLATFORM_DOMAINS,
	LINKS_MIN_PROSE_WORDS,
	MIN_ARTICLE_WORDS,
	SPAM_MAX_HASHTAGS,
	classifySpam,
	createSpamClassifier,
	duplicateIds,
	isAdultSpam,
	isHashtagStuffed,
	isLinkDominated,
	isVeryShort,
	type SpamEventLike
} from './spamRules';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** A normal food article: ~300 words of prose, a photo, a couple of links, five tags. */
const FOOD_BODY = [
	'# Sourdough on a weeknight',
	'',
	'![loaf](https://image.nostr.build/loaf.jpg)',
	'',
	'My starter lives on the counter and gets fed once a day with equal weights of flour and water. ',
	'On a weeknight I mix the dough at six, fold it three times before dinner, and shape it before bed. ',
	'The loaf proofs in the fridge overnight and bakes in a hot dutch oven the next morning. ',
	'Rye flour in the starter makes it livelier; a pinch of salt in the levain slows it down on hot days. ',
	'I wrote more about hydration on [my blog](https://example.com/hydration) and the flour I use comes from ',
	'[a local mill](https://mill.example.org). Score deep, bake with the lid on for twenty minutes, then off. '
]
	.join('')
	.repeat(3);

function article(over: Partial<SpamEventLike> & { t?: string[] } = {}): SpamEventLike {
	const tags = over.tags ?? [
		['d', 'sourdough'],
		['title', 'Sourdough on a weeknight'],
		['summary', 'A starter, a dutch oven and a fridge.'],
		...(over.t ?? ['food', 'baking', 'sourdough', 'bread', 'foodstr']).map((t) => ['t', t])
	];
	return { id: over.id ?? '1'.repeat(64), pubkey: over.pubkey ?? A, content: over.content ?? FOOD_BODY, tags };
}

describe('the normal food article', () => {
	it('trips no rule', () => {
		const e = article();
		expect(isAdultSpam(e)).toBe(false);
		expect(isHashtagStuffed(e)).toBe(false);
		expect(isLinkDominated(e)).toBe(false);
		expect(isVeryShort(e)).toBe(false);
		expect(classifySpam([e]).size).toBe(0);
	});

	it('keeps food words that look adult: foodporn, naked cake', () => {
		const e = article({ t: ['foodporn', 'baking'], content: FOOD_BODY + ' A naked cake with buttercream.' });
		expect(isAdultSpam(e)).toBe(false);
	});
});

describe('adult content', () => {
	it('catches a link to an adult platform anywhere in the body', () => {
		const e = article({ content: FOOD_BODY + '\n\n[my page](https://onlyfans.com/somebody)' });
		expect(isAdultSpam(e)).toBe(true);
	});

	it('catches a platform by its host alone (no adult word in the text)', () => {
		expect(isAdultSpam(article({ content: FOOD_BODY + ' [shop](https://manyvids.com/x)' }))).toBe(true);
	});

	it('catches subdomains and bare www links', () => {
		expect(isAdultSpam(article({ content: FOOD_BODY + ' see www.manyvids.com/x' }))).toBe(true);
		expect(isAdultSpam(article({ content: FOOD_BODY + ' https://m.manyvids.com/x' }))).toBe(true);
	});

	it('catches a platform link in the summary or image tag', () => {
		const tags = [
			['d', 'x'],
			['summary', 'subscribe https://onlyfans.com/me'],
			['t', 'food']
		];
		expect(isAdultSpam(article({ tags }))).toBe(true);
		expect(isAdultSpam(article({ tags: [['d', 'x'], ['image', 'https://cdn.fansly.com/a.jpg']] }))).toBe(true);
	});

	it('does not match a lookalike host', () => {
		expect(isAdultSpam(article({ content: FOOD_BODY + ' https://notmanyvids.com/x' }))).toBe(false);
		expect(isAdultSpam(article({ content: FOOD_BODY + ' https://manyvids.com.example/x' }))).toBe(false);
	});

	it('catches two different adult words past the first 500 characters', () => {
		const e = article({ content: FOOD_BODY + '\n- [Leaked nudes, NSFW gallery](https://spam.example/x)' });
		expect(e.content.indexOf('nudes')).toBeGreaterThan(500);
		expect(isAdultSpam(e)).toBe(true);
	});

	it('one adult word alone is not a hit (a newsletter on "NSFW filtering")', () => {
		expect(isAdultSpam(article({ content: FOOD_BODY + ' Clients now support NSFW filtering. NSFW!' }))).toBe(false);
	});

	it('keeps every platform in one list', () => {
		expect(ADULT_PLATFORM_DOMAINS).toContain('onlyfans.com');
		expect(ADULT_PLATFORM_DOMAINS).toContain('fansly.com');
	});
});

describe('hashtag stuffing', () => {
	it('long-form allows the 6–10 topic tags articles usually carry', () => {
		expect(SPAM_MAX_HASHTAGS).toBe(20);
		expect(isHashtagStuffed(article({ t: Array.from({ length: 10 }, (_, i) => `tag${i}`) }))).toBe(false);
	});

	it(`catches more than ${SPAM_MAX_HASHTAGS} t tags`, () => {
		const t = Array.from({ length: SPAM_MAX_HASHTAGS + 1 }, (_, i) => `tag${i}`);
		expect(isHashtagStuffed(article({ t }))).toBe(true);
	});

	it(`allows exactly ${SPAM_MAX_HASHTAGS}`, () => {
		const t = Array.from({ length: SPAM_MAX_HASHTAGS }, (_, i) => `tag${i}`);
		expect(isHashtagStuffed(article({ t }))).toBe(false);
	});

	it('counts only t tags, not inline hashtags in the body', () => {
		const inline = Array.from({ length: SPAM_MAX_HASHTAGS + 1 }, (_, i) => `#tag${i}`).join(' ');
		expect(isHashtagStuffed(article({ t: [], content: FOOD_BODY + ' ' + inline }))).toBe(false);
	});

	it('counts distinct tags (Bitcoin and bitcoin are one)', () => {
		const t = Array.from({ length: SPAM_MAX_HASHTAGS }, (_, i) => `tag${i}`);
		expect(isHashtagStuffed(article({ t: [...t, ...t.map((x) => x.toUpperCase()), ' tag0 '] }))).toBe(false);
		expect(isHashtagStuffed(article({ t: [...t, 'one more'] }))).toBe(true);
	});

	it('does not count markdown headings', () => {
		const headings = Array.from({ length: 10 }, (_, i) => `## Step ${i}\n\nMix.`).join('\n\n');
		expect(isHashtagStuffed(article({ content: FOOD_BODY + headings }))).toBe(false);
	});
});

describe('link-dominated content', () => {
	it('catches a link list with almost no prose', () => {
		const links = Array.from({ length: 20 }, (_, i) => `- [deal ${i}](https://spam.example/${i})`).join('\n');
		expect(isLinkDominated(article({ content: 'Great deals below.\n' + links }))).toBe(true);
	});

	it(`catches a short blurb around a link (under the prose minimum, few URL characters)`, () => {
		const blurb = Array.from({ length: LINKS_MIN_PROSE_WORDS - 1 }, () => 'flour').join(' ');
		expect(isLinkDominated(article({ content: blurb + ' https://x.io' }))).toBe(true);
		const enough = Array.from({ length: LINKS_MIN_PROSE_WORDS }, () => 'flour').join(' ');
		expect(isLinkDominated(article({ content: enough + ' https://x.io' }))).toBe(false);
	});

	it('catches a body that is mostly URL characters', () => {
		const urls = Array.from({ length: 60 }, (_, i) => `https://spam.example/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${i}`).join(' ');
		expect(isLinkDominated(article({ content: FOOD_BODY + ' ' + urls }))).toBe(true);
	});

	it('image URLs do not count toward the URL share (a photo-heavy article)', () => {
		const photos = Array.from({ length: 60 }, (_, i) => `![p](https://substackcdn.example/image/fetch/w_1456/aaaaaaaa/${i}.jpeg?x=1)`).join('\n');
		expect(isLinkDominated(article({ content: FOOD_BODY + '\n' + photos }))).toBe(false);
		const links = photos.replace(/\.jpeg\?x=1/g, '/page');
		expect(isLinkDominated(article({ content: FOOD_BODY + '\n' + links }))).toBe(true);
	});

	it('leaves a link-free short note to the short rule', () => {
		expect(isLinkDominated(article({ content: 'Bread.' }))).toBe(false);
	});
});

describe('very short articles', () => {
	it(`catches fewer than ${MIN_ARTICLE_WORDS} words`, () => {
		const words = Array.from({ length: MIN_ARTICLE_WORDS - 1 }, () => 'flour').join(' ');
		expect(isVeryShort(article({ content: words }))).toBe(true);
	});

	it(`allows ${MIN_ARTICLE_WORDS} words`, () => {
		const words = Array.from({ length: MIN_ARTICLE_WORDS }, () => 'flour').join(' ');
		expect(isVeryShort(article({ content: words }))).toBe(false);
	});

	it('does not count URLs or image embeds as words', () => {
		const padded = 'Bread. ' + Array.from({ length: 200 }, (_, i) => `https://x.example/${i}`).join(' ');
		expect(isVeryShort(article({ content: padded }))).toBe(true);
	});
});

describe('duplicate content across authors', () => {
	it('marks every copy published by different authors', () => {
		const one = article({ id: '1'.repeat(64), pubkey: A });
		const two = article({ id: '2'.repeat(64), pubkey: B, content: FOOD_BODY.replace(/\*/g, '') + '  ' });
		expect([...duplicateIds([one, two])].sort()).toEqual([one.id, two.id].sort());
		expect(classifySpam([one, two]).get(two.id)).toBe('duplicate');
	});

	it('leaves one author republishing their own text alone', () => {
		const one = article({ id: '1'.repeat(64), pubkey: A });
		const two = article({ id: '2'.repeat(64), pubkey: A });
		expect(duplicateIds([one, two]).size).toBe(0);
	});

	it('leaves different articles by different authors alone', () => {
		const one = article({ id: '1'.repeat(64), pubkey: A });
		const two = article({ id: '2'.repeat(64), pubkey: B, content: FOOD_BODY.replace('Sourdough', 'Focaccia') });
		expect(duplicateIds([one, two]).size).toBe(0);
	});
});

describe('classifySpam', () => {
	it('reports the first rule an article trips', () => {
		const t = Array.from({ length: 9 }, (_, i) => `tag${i}`);
		const e = article({ t, content: FOOD_BODY + ' https://onlyfans.com/x' });
		expect(classifySpam([e]).get(e.id)).toBe('adult');
	});

	it('the memoised classifier agrees with the plain one as the batch grows', () => {
		const classify = createSpamClassifier();
		const one = article({ id: '1'.repeat(64), pubkey: A });
		const short = article({ id: '3'.repeat(64), pubkey: A, content: 'Too short.' });
		expect(classify([one, short])).toEqual(classifySpam([one, short]));
		// A copy by another author arrives later: the first article becomes a duplicate.
		const two = article({ id: '2'.repeat(64), pubkey: B });
		const batch = [one, short, two];
		expect(classify(batch)).toEqual(classifySpam(batch));
		expect(classify(batch).get(one.id)).toBe('duplicate');
	});
});
