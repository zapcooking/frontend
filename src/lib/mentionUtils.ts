/**
 * Pure utility functions for the mention/autocomplete system.
 * No state, no DOM element references stored — all dependencies passed as arguments.
 */
import { nip19 } from 'nostr-tools';
import type { CachedProfile } from '$lib/followListCache';

// --- String utilities ---

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatNpubShort(npub: string): string {
	if (npub.length <= 16) return npub;
	return `${npub.slice(0, 10)}...${npub.slice(-6)}`;
}

// --- Mention display & parsing ---

export function getDisplayNameForMention(
	mention: string,
	profileCache: Map<string, CachedProfile>
): string {
	const identifier = mention.replace('nostr:', '');
	try {
		const decoded = nip19.decode(identifier);
		if (decoded.type === 'npub') {
			const profile = profileCache.get(decoded.data);
			if (profile?.name) return profile.name;
			return formatNpubShort(identifier);
		}
		if (decoded.type === 'nprofile') {
			const profile = profileCache.get(decoded.data.pubkey);
			if (profile?.name) return profile.name;
			return formatNpubShort(nip19.npubEncode(decoded.data.pubkey));
		}
	} catch {}
	return formatNpubShort(identifier);
}

const MENTION_REGEX =
	/nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nprofile1[023456789acdefghjklmnpqrstuvwxyz]+)|@npub1[023456789acdefghjklmnpqrstuvwxyz]{58}/g;

export function renderTextWithMentions(
	text: string,
	profileCache: Map<string, CachedProfile>
): string {
	if (!text) return '';
	const regex = new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags);
	let html = '';
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		const beforeText = text.substring(lastIndex, match.index);
		if (beforeText) {
			html += escapeHtml(beforeText).replace(/\n/g, '<br>');
		}

		const rawMention = match[0];
		const mention = rawMention.startsWith('@') ? `nostr:${rawMention.slice(1)}` : rawMention;
		const displayName = getDisplayNameForMention(mention, profileCache);
		// Wrap each pill in zero-width space text nodes so the caret has a
		// landing spot before and after the contenteditable=false element.
		// Fixes iOS Safari caret jumping to end-of-line and makes it
		// possible to tap/place the cursor before a pill.
		html += `&#8203;<span class="mention-pill" contenteditable="false" data-mention="${mention}">@${escapeHtml(displayName)}</span>&#8203;`;

		lastIndex = match.index + rawMention.length;
	}

	if (lastIndex < text.length) {
		html += escapeHtml(text.substring(lastIndex)).replace(/\n/g, '<br>');
	}

	return html;
}

export function parseMentions(text: string): Map<string, string> {
	const mentions = new Map<string, string>();
	const regex = new RegExp(MENTION_REGEX.source, MENTION_REGEX.flags);
	let match;

	while ((match = regex.exec(text)) !== null) {
		const mention = match[1] || match[0].slice(1);
		try {
			const decoded = nip19.decode(mention);
			if (decoded.type === 'npub') {
				mentions.set(mention, decoded.data);
			} else if (decoded.type === 'nprofile') {
				mentions.set(mention, decoded.data.pubkey);
			}
		} catch {}
	}

	return mentions;
}

export function replacePlainMentions(
	text: string,
	profileCache: Map<string, CachedProfile>
): string {
	let output = text;
	output = output.replace(
		/@npub1[023456789acdefghjklmnpqrstuvwxyz]{58}/g,
		(match) => `nostr:${match.slice(1)}`
	);
	for (const profile of profileCache.values()) {
		if (!profile.name) continue;
		const mentionText = `@${profile.name}`;
		const mentionRegex = new RegExp(`${escapeRegex(mentionText)}(?=\\s|$|[.,!?;:])`, 'gi');
		if (mentionRegex.test(output)) {
			output = output.replace(mentionRegex, `nostr:${profile.npub}`);
		}
	}
	return output;
}

// --- DOM utilities ---

// Block-level tags that introduce a line break when a contenteditable surface
// (or pasted HTML) is serialized back to plain text. Browsers and embedded
// WebViews disagree on the paragraph separator they emit on Enter \u2014 Chrome/
// Safari typically wrap lines in <div>, but iOS/Capacitor WebViews and pasted
// rich text often use <p> (and lists/headings/etc.). Treating only <div> as a
// line boundary dropped those breaks, concatenating lines with no separator
// (e.g. "\uD83E\uDD69\uD83C\uDF73#brunchstr"). Keep this list focused on tags that realistically
// appear inside the composer or in pasted content.
const BLOCK_TAGS = new Set([
	'DIV',
	'P',
	'LI',
	'UL',
	'OL',
	'BLOCKQUOTE',
	'PRE',
	'SECTION',
	'ARTICLE',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6'
]);

export function htmlToPlainText(element: Node): string {
	let text = '';
	// `isFirstChild` suppresses a leading newline before the first block so the
	// output doesn't start with "\n". `prevWasBlock` records whether the last
	// emitted node was a block element: a block only emits a newline *before*
	// itself, so an inline/text node following a block (e.g. `<div>L1</div>L2`)
	// would otherwise merge onto the block's line. The flag lets us insert the
	// missing separator on that trailing edge too.
	let isFirstChild = true;
	let prevWasBlock = false;

	const breakAfterBlock = () => {
		if (prevWasBlock && text && !text.endsWith('\n')) {
			text += '\n';
		}
	};

	element.childNodes.forEach((node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			const content = (node.textContent || '').replace(/\u200B/g, '');
			if (content) {
				breakAfterBlock();
				text += content;
				isFirstChild = false;
				prevWasBlock = false;
			}
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as HTMLElement;

			if (el.dataset.mention) {
				breakAfterBlock();
				text += el.dataset.mention;
				isFirstChild = false;
				prevWasBlock = false;
			} else if (el.tagName === 'BR') {
				text += '\n';
				isFirstChild = false;
				prevWasBlock = false;
			} else if (BLOCK_TAGS.has(el.tagName)) {
				if (!isFirstChild) {
					text += '\n';
				}

				const hasOnlyBr = el.childNodes.length === 1 && el.firstChild?.nodeName === 'BR';
				if (!hasOnlyBr) {
					text += htmlToPlainText(node);
				}
				isFirstChild = false;
				prevWasBlock = true;
			} else if (el.tagName === 'SPAN') {
				const spanContent = htmlToPlainText(node);
				if (spanContent) {
					breakAfterBlock();
					text += spanContent;
					isFirstChild = false;
					prevWasBlock = false;
				}
			} else {
				const childContent = htmlToPlainText(node);
				if (childContent) {
					breakAfterBlock();
					text += childContent;
					isFirstChild = false;
					prevWasBlock = false;
				}
			}
		}
	});

	return text;
}

export function createMentionPill(mention: string, displayName: string): HTMLSpanElement {
	const pill = document.createElement('span');
	pill.contentEditable = 'false';
	pill.dataset.mention = mention;
	pill.className = 'mention-pill';
	pill.textContent = `@${displayName}`;
	return pill;
}

export function getTextBeforeCursor(element: HTMLDivElement): string {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return '';

	const range = selection.getRangeAt(0);
	const preCaretRange = range.cloneRange();
	preCaretRange.selectNodeContents(element);
	preCaretRange.setEnd(range.startContainer, range.startOffset);

	const tempDiv = document.createElement('div');
	tempDiv.appendChild(preCaretRange.cloneContents());

	return htmlToPlainText(tempDiv);
}

export function deleteCharsBeforeCursor(count: number): void {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return;

	const range = selection.getRangeAt(0);
	let remaining = count;
	let currentNode: Node | null = range.startContainer;
	let currentOffset = range.startOffset;

	if (currentNode.nodeType === Node.ELEMENT_NODE) {
		const walker = document.createTreeWalker(currentNode, NodeFilter.SHOW_TEXT, null);
		let lastText: Text | null = null;
		while (walker.nextNode()) {
			lastText = walker.currentNode as Text;
		}
		if (lastText) {
			currentNode = lastText;
			currentOffset = lastText.length;
		}
	}

	while (remaining > 0 && currentNode) {
		if (currentNode.nodeType === Node.TEXT_NODE) {
			const textNode = currentNode as Text;
			const deleteCount = Math.min(remaining, currentOffset);
			if (deleteCount > 0) {
				textNode.deleteData(currentOffset - deleteCount, deleteCount);
				remaining -= deleteCount;
				currentOffset -= deleteCount;
			}

			if (remaining > 0) {
				let prev: Node | null = textNode.previousSibling;
				while (prev && prev.nodeType !== Node.TEXT_NODE) {
					prev = prev.previousSibling;
				}
				if (prev) {
					currentNode = prev;
					currentOffset = (prev as Text).length;
				} else {
					break;
				}
			}
		} else {
			break;
		}
	}
}
