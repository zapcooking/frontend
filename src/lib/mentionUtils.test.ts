import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import type { CachedProfile } from '$lib/followListCache';
import { htmlToPlainText, replacePlainMentions } from './mentionUtils';

/**
 * htmlToPlainText serializes the composer's contenteditable DOM back to the
 * plain text that gets published. Browsers and embedded WebViews disagree on
 * the markup they produce when the user presses Enter (<div> vs <p> vs bare
 * text + <br>), so these tests pin the line-break handling across those
 * structures using a minimal fake DOM — no jsdom required, matching this
 * repo's pure-TS test style.
 */

const ZWSP = '​';

// htmlToPlainText references the global `Node` constants; provide them for
// the node test environment.
if (typeof Node === 'undefined') {
	(globalThis as any).Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
}

function txt(value: string): any {
	return { nodeType: 3, textContent: value, childNodes: [] };
}

function el(tagName: string, children: any[] = [], dataset: Record<string, string> = {}): any {
	const node: any = {
		nodeType: 1,
		tagName,
		nodeName: tagName,
		dataset,
		childNodes: children
	};
	Object.defineProperty(node, 'firstChild', {
		get() {
			return children[0] ?? null;
		}
	});
	return node;
}

function br(): any {
	return el('BR');
}

function root(children: any[]): any {
	return { childNodes: children };
}

describe('htmlToPlainText', () => {
	it('serializes a single bare text node unchanged', () => {
		expect(htmlToPlainText(root([txt('hello world')]))).toBe('hello world');
	});

	it('treats <br> as a newline', () => {
		expect(htmlToPlainText(root([txt('line 1'), br(), txt('line 2')]))).toBe('line 1\nline 2');
	});

	it('treats <div>-wrapped lines as separate lines (Chrome/Safari)', () => {
		// Bare first line + <div> follow-ups
		expect(
			htmlToPlainText(root([txt('line 1'), el('DIV', [txt('line 2')]), el('DIV', [txt('line 3')])]))
		).toBe('line 1\nline 2\nline 3');
	});

	it('preserves a blank line from an empty <div><br></div>', () => {
		expect(
			htmlToPlainText(
				root([el('DIV', [txt('line 1')]), el('DIV', [br()]), el('DIV', [txt('line 3')])])
			)
		).toBe('line 1\n\nline 3');
	});

	// Regression: iOS/Capacitor WebViews and pasted rich text use <p> as the
	// paragraph separator. These were previously concatenated with no break,
	// producing strings like "🥩🍳#brunchstr".
	it('treats <p> paragraphs as separate lines', () => {
		expect(
			htmlToPlainText(
				root([
					el('P', [txt('Champion of breakfasts. 🥩🍳')]),
					el('P', [txt('#brunchstr #foodstr')]),
					el('P', [txt('https://i.nostr.build/x.jpg')])
				])
			)
		).toBe('Champion of breakfasts. 🥩🍳\n#brunchstr #foodstr\nhttps://i.nostr.build/x.jpg');
	});

	// Regression: a block element followed by a bare text/inline node must not
	// merge onto the block's line (a <div> only emits a newline before itself).
	it('breaks between a block and a following inline/text node', () => {
		expect(htmlToPlainText(root([el('DIV', [txt('line 1')]), txt('line 2')]))).toBe(
			'line 1\nline 2'
		);
		expect(
			htmlToPlainText(root([el('DIV', [txt('line 1')]), el('SPAN', [txt('line 2')])]))
		).toBe('line 1\nline 2');
	});

	it('does not prepend a leading newline before the first block', () => {
		expect(htmlToPlainText(root([el('P', [txt('first')])]))).toBe('first');
	});

	it('strips zero-width spaces (mention pill caret spacers)', () => {
		expect(htmlToPlainText(root([txt(`${ZWSP}hello${ZWSP}`)]))).toBe('hello');
	});

	it('serializes mention pills to their nostr: reference', () => {
		const pill = el('SPAN', [txt('@alice')], { mention: 'nostr:npub1alice' });
		expect(htmlToPlainText(root([txt('hi '), txt(ZWSP), pill, txt(ZWSP), txt(' there')]))).toBe(
			'hi nostr:npub1alice there'
		);
	});

	it('keeps a mention on its own line after a block', () => {
		const pill = el('SPAN', [txt('@alice')], { mention: 'nostr:npub1alice' });
		expect(htmlToPlainText(root([el('DIV', [txt('intro')]), pill]))).toBe('intro\nnostr:npub1alice');
	});
});

// --- replacePlainMentions ---

const BREEZ_PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const BREEZ_NPUB = nip19.npubEncode(BREEZ_PUBKEY);

function cacheWithName(name: string): Map<string, CachedProfile> {
	return new Map([['key', { name, npub: BREEZ_NPUB, pubkey: BREEZ_PUBKEY }]]);
}

describe('replacePlainMentions', () => {
	it('rewrites a real @Name mention to nostr:npub', () => {
		expect(replacePlainMentions('Shoutout @Breez!', cacheWithName('Breez'))).toBe(
			`Shoutout nostr:${BREEZ_NPUB}!`
		);
	});

	// Regression: a Lightning address like daniel@breez.tips published as
	// "daniel" + a @Breez mention + ".tips" — the @Name scan only checked
	// what FOLLOWS the match, so a domain naming a cached profile matched
	// mid-word and the npub was spliced into the address.
	it('leaves a Lightning address alone even when the domain names a profile', () => {
		const text = 'Don’t forget about us, Breez ⚡️\n\ndaniel@breez.tips';
		expect(replacePlainMentions(text, cacheWithName('Breez'))).toBe(text);
	});

	// The exact shape of the published note that broke: a legit mention on
	// the first line, a Lightning address on the second.
	it('rewrites the real mention and spares the address in the same note', () => {
		const input = 'Don’t forget about us, @Breez!\n\n⚡️ daniel@breez.tips';
		expect(replacePlainMentions(input, cacheWithName('Breez'))).toBe(
			`Don’t forget about us, nostr:${BREEZ_NPUB}!\n\n⚡️ daniel@breez.tips`
		);
	});

	it('is case-insensitive in both directions of the boundary', () => {
		expect(replacePlainMentions('hey @breez,', cacheWithName('Breez'))).toBe(
			`hey nostr:${BREEZ_NPUB},`
		);
		expect(replacePlainMentions('daniel@BREEZ.tips', cacheWithName('Breez'))).toBe(
			'daniel@BREEZ.tips'
		);
	});

	it('still mentions at the start of text and after punctuation', () => {
		expect(replacePlainMentions('@Breez hi', cacheWithName('Breez'))).toBe(
			`nostr:${BREEZ_NPUB} hi`
		);
		expect(replacePlainMentions('(@Breez!', cacheWithName('Breez'))).toBe(
			`(nostr:${BREEZ_NPUB}!`
		);
		expect(replacePlainMentions('thanks.@Breez', cacheWithName('Breez'))).toBe(
			`thanks.nostr:${BREEZ_NPUB}`
		);
	});

	it('mentions after a newline', () => {
		expect(replacePlainMentions('line one\n@Breez', cacheWithName('Breez'))).toBe(
			`line one\nnostr:${BREEZ_NPUB}`
		);
	});

	it('rewrites adjacent mentions separated by one punctuation char', () => {
		expect(replacePlainMentions('@Breez,@Breez', cacheWithName('Breez'))).toBe(
			`nostr:${BREEZ_NPUB},nostr:${BREEZ_NPUB}`
		);
	});

	it('leaves an @npub embedded in an address alone and rewrites a bare one', () => {
		const embedded = `x@${BREEZ_NPUB}.tips`;
		expect(replacePlainMentions(embedded, cacheWithName('Breez'))).toBe(embedded);
		expect(replacePlainMentions(`ping @${BREEZ_NPUB}`, cacheWithName('Breez'))).toBe(
			`ping nostr:${BREEZ_NPUB}`
		);
	});

	it('treats accented letters as word characters before the @', () => {
		const text = 'jürgen@breez.tips';
		expect(replacePlainMentions(text, cacheWithName('Breez'))).toBe(text);
	});
});
