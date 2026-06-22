import { describe, it, expect } from 'vitest';
import { htmlToPlainText } from './mentionUtils';

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
