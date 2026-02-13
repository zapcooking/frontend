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
		html += `<span class="mention-pill" contenteditable="false" data-mention="${mention}">@${escapeHtml(displayName)}</span>`;

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

export function htmlToPlainText(element: Node): string {
	let text = '';
	let isFirstChild = true;

	element.childNodes.forEach((node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			const content = (node.textContent || '').replace(/\u200B/g, '');
			text += content;
			if (content) {
				isFirstChild = false;
			}
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as HTMLElement;

			if (el.dataset.mention) {
				text += el.dataset.mention;
				isFirstChild = false;
			} else if (el.tagName === 'BR') {
				text += '\n';
			} else if (el.tagName === 'DIV') {
				if (!isFirstChild) {
					text += '\n';
				}

				const hasOnlyBr = el.childNodes.length === 1 && el.firstChild?.nodeName === 'BR';
				if (!hasOnlyBr) {
					text += htmlToPlainText(node);
				}
				isFirstChild = false;
			} else if (el.tagName === 'SPAN') {
				const spanContent = htmlToPlainText(node);
				text += spanContent;
				if (spanContent) {
					isFirstChild = false;
				}
			} else {
				const childContent = htmlToPlainText(node);
				text += childContent;
				if (childContent) {
					isFirstChild = false;
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
