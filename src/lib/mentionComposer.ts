/**
 * Stateful controller for the mention/autocomplete system.
 * Each component creates one instance, passing callbacks for state and text changes.
 * Uses the singleton followListCache for profile data.
 */
import { nip19 } from 'nostr-tools';
import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { searchProfiles } from '$lib/profileSearchService';
import {
	loadFollowListProfiles,
	getProfileCache,
	addToCache,
	type CachedProfile
} from '$lib/followListCache';
import {
	htmlToPlainText,
	getTextBeforeCursor,
	deleteCharsBeforeCursor,
	createMentionPill,
	getDisplayNameForMention,
	renderTextWithMentions,
	replacePlainMentions as replacePlainMentionsUtil,
	parseMentions as parseMentionsUtil,
	escapeRegex
} from '$lib/mentionUtils';

export type { CachedProfile } from '$lib/followListCache';

export interface MentionSuggestion {
	name: string;
	npub: string;
	picture?: string;
	pubkey: string;
	nip05?: string;
}

export interface MentionState {
	mentionQuery: string;
	showMentionSuggestions: boolean;
	mentionSuggestions: MentionSuggestion[];
	selectedMentionIndex: number;
	mentionSearching: boolean;
}

type StateChangeCallback = (state: MentionState) => void;
type TextChangeCallback = (text: string) => void;

// Regex to detect @mention trigger before cursor.
// Uses [^@] instead of [^\s@] to allow spaces in names (PR #143 fix #1).
const MENTION_TRIGGER_REGEX = /@([^@]*)$/;

export class MentionComposerController {
	private composerEl: HTMLDivElement | null = null;
	private searchTimeout: ReturnType<typeof setTimeout> | null = null;
	private onStateChange: StateChangeCallback;
	private onTextChange: TextChangeCallback;

	// Internal state
	mentionQuery = '';
	showMentionSuggestions = false;
	mentionSuggestions: MentionSuggestion[] = [];
	selectedMentionIndex = 0;
	mentionSearching = false;

	constructor(onStateChange: StateChangeCallback, onTextChange: TextChangeCallback) {
		this.onStateChange = onStateChange;
		this.onTextChange = onTextChange;
	}

	/** Call when bind:this resolves or changes */
	setComposerEl(el: HTMLDivElement | null): void {
		this.composerEl = el;
	}

	/** Preload follow list (call from onMount) */
	preloadFollowList(): void {
		loadFollowListProfiles();
	}

	/** Sync HTML into the composer from a text value */
	syncContent(value: string): void {
		if (!this.composerEl) return;
		const html = renderTextWithMentions(value, getProfileCache());
		if (this.composerEl.innerHTML !== html) {
			this.composerEl.innerHTML = html;
		}
	}

	/** Extract plain text from composer DOM */
	extractText(): string {
		if (!this.composerEl) return '';
		return htmlToPlainText(this.composerEl);
	}

	/** Replace @name and @npub with nostr:npub format using the shared cache */
	replacePlainMentions(text: string): string {
		return replacePlainMentionsUtil(text, getProfileCache());
	}

	/** Parse mentions from text */
	parseMentions(text: string): Map<string, string> {
		return parseMentionsUtil(text);
	}

	/** Handle the input event on the composer — called from on:input */
	handleInput(): string {
		const text = this.updateContentFromComposer();
		if (!this.composerEl) return text;

		const converted = this.convertRawMentionsToPills();
		let finalText = text;
		if (converted) {
			finalText = this.updateContentFromComposer();
		}

		const textBeforeCursor = getTextBeforeCursor(this.composerEl);
		const mentionMatch = textBeforeCursor.match(MENTION_TRIGGER_REGEX);

		if (mentionMatch) {
			this.mentionQuery = mentionMatch[1] || '';
			this.showMentionSuggestions = true;

			if (this.searchTimeout) clearTimeout(this.searchTimeout);
			this.searchTimeout = setTimeout(() => {
				if (this.mentionQuery.length > 0) {
					this.searchMentionUsers(this.mentionQuery);
				} else {
					this.mentionSuggestions = Array.from(getProfileCache().values()).slice(0, 8);
					this.selectedMentionIndex = 0;
					this.notifyStateChange();
				}
			}, 150);
		} else {
			this.showMentionSuggestions = false;
			this.mentionSuggestions = [];
		}

		this.notifyStateChange();
		return finalText;
	}

	/** Handle keydown — returns true if the event was consumed */
	handleKeydown(event: KeyboardEvent): boolean {
		const selection = window.getSelection();
		if (selection && selection.rangeCount) {
			const range = selection.getRangeAt(0);

			// Delete key — remove mention pill ahead of cursor
			if (event.key === 'Delete' && range.collapsed) {
				const { startContainer, startOffset } = range;
				if (startContainer.nodeType === Node.TEXT_NODE) {
					const textNode = startContainer as Text;
					if (startOffset === textNode.length) {
						const nextSibling = startContainer.nextSibling;
						if (
							nextSibling &&
							nextSibling.nodeType === Node.ELEMENT_NODE &&
							(nextSibling as HTMLElement).dataset.mention
						) {
							event.preventDefault();
							nextSibling.remove();
							this.updateContentFromComposer();
							return true;
						}
					}
				}
			}

			// Backspace — remove mention pill behind cursor
			if (event.key === 'Backspace') {
				if (!range.collapsed) {
					const container = range.commonAncestorContainer;
					let mentionElement: HTMLElement | null = null;

					if (container.nodeType === Node.ELEMENT_NODE) {
						const el = container as HTMLElement;
						if (el.dataset.mention) {
							mentionElement = el;
						}
					} else if (container.parentElement?.dataset.mention) {
						mentionElement = container.parentElement;
					}

					if (mentionElement) {
						event.preventDefault();
						mentionElement.remove();
						this.updateContentFromComposer();
						return true;
					}
				}

				if (range.collapsed) {
					const { startContainer, startOffset } = range;
					if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
						const prevSibling = startContainer.previousSibling;
						if (
							prevSibling &&
							prevSibling.nodeType === Node.ELEMENT_NODE &&
							(prevSibling as HTMLElement).dataset.mention
						) {
							event.preventDefault();
							prevSibling.remove();
							this.updateContentFromComposer();
							return true;
						}
					}
				}
			}
		}

		// Mention suggestion navigation
		if (this.showMentionSuggestions && this.mentionSuggestions.length > 0) {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				this.selectedMentionIndex =
					(this.selectedMentionIndex + 1) % this.mentionSuggestions.length;
				this.notifyStateChange();
				return true;
			} else if (event.key === 'ArrowUp') {
				event.preventDefault();
				this.selectedMentionIndex =
					this.selectedMentionIndex === 0
						? this.mentionSuggestions.length - 1
						: this.selectedMentionIndex - 1;
				this.notifyStateChange();
				return true;
			} else if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				this.insertMention(this.mentionSuggestions[this.selectedMentionIndex]);
				return true;
			} else if (event.key === 'Escape') {
				this.showMentionSuggestions = false;
				this.mentionSuggestions = [];
				this.notifyStateChange();
				return true;
			}
		}

		return false;
	}

	/** Handle beforeinput event — prevents editing inside mention pills */
	handleBeforeInput(event: InputEvent): void {
		if (
			event.isComposing ||
			event.inputType === 'historyUndo' ||
			event.inputType === 'historyRedo'
		) {
			return;
		}

		const selection = window.getSelection();
		if (!selection || !this.composerEl) return;
		const range = selection.getRangeAt(0);
		let node: Node | null = range.startContainer;

		while (node && node !== this.composerEl) {
			if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.mention) {
				event.preventDefault();

				if (event.inputType === 'insertText' || event.inputType === 'insertCompositionText') {
					const newRange = document.createRange();
					newRange.setStartAfter(node);
					newRange.collapse(true);
					selection.removeAllRanges();
					selection.addRange(newRange);
				}
				return;
			}
			node = node.parentNode;
		}
	}

	/** Handle paste event — strips HTML, inserts plain text */
	handlePaste(event: ClipboardEvent): void {
		event.preventDefault();
		const plainText = event.clipboardData?.getData('text/plain');
		if (!plainText) return;

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);

		range.deleteContents();
		const textNode = document.createTextNode(plainText);
		range.insertNode(textNode);
		range.setStartAfter(textNode);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);

		this.handleInput();
	}

	/** Insert a selected mention user at the cursor position */
	insertMention(user: MentionSuggestion): void {
		if (!this.composerEl) return;

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;
		const textBeforeCursor = getTextBeforeCursor(this.composerEl);
		const mentionMatch = textBeforeCursor.match(MENTION_TRIGGER_REGEX);

		if (mentionMatch?.[0]) {
			deleteCharsBeforeCursor(mentionMatch[0].length);
		}

		// PR #143 fix #2: insert leading space if preceded by non-whitespace
		const textAfterDeletion = getTextBeforeCursor(this.composerEl);
		const needsLeadingSpace = textAfterDeletion.length > 0 && !/\s$/.test(textAfterDeletion);

		if (needsLeadingSpace) {
			const spaceNode = document.createTextNode(' ');
			const sel = window.getSelection();
			if (sel && sel.rangeCount > 0) {
				const range = sel.getRangeAt(0);
				range.insertNode(spaceNode);
				range.setStartAfter(spaceNode);
				range.collapse(true);
				sel.removeAllRanges();
				sel.addRange(range);
			}
		}

		const mention = `nostr:${user.npub}`;
		this.insertMentionNode(mention, user.name, true);

		addToCache(user);
		this.updateContentFromComposer();
		this.showMentionSuggestions = false;
		this.mentionSuggestions = [];
		this.notifyStateChange();
	}

	/** Reset mention state (call after posting / clearing composer) */
	resetMentionState(): void {
		this.showMentionSuggestions = false;
		this.mentionSuggestions = [];
		this.mentionQuery = '';
		this.selectedMentionIndex = 0;
		if (this.searchTimeout) clearTimeout(this.searchTimeout);
		this.notifyStateChange();
	}

	/** Cleanup (call from onDestroy) */
	destroy(): void {
		if (this.searchTimeout) clearTimeout(this.searchTimeout);
	}

	// --- Private methods ---

	private notifyStateChange(): void {
		this.onStateChange({
			mentionQuery: this.mentionQuery,
			showMentionSuggestions: this.showMentionSuggestions,
			mentionSuggestions: this.mentionSuggestions,
			selectedMentionIndex: this.selectedMentionIndex,
			mentionSearching: this.mentionSearching
		});
	}

	private updateContentFromComposer(): string {
		if (!this.composerEl) return '';
		const newText = htmlToPlainText(this.composerEl);
		this.onTextChange(newText);
		return newText;
	}

	private async searchMentionUsers(query: string): Promise<void> {
		// Trigger follow list load (non-blocking)
		loadFollowListProfiles();

		const queryLower = query.toLowerCase();
		const matches: MentionSuggestion[] = [];
		const seenPubkeys = new Set<string>();
		const cache = getProfileCache();

		// Search local cache — by name AND NIP-05
		for (const profile of cache.values()) {
			const nameMatch = profile.name.toLowerCase().includes(queryLower);
			const nip05Match = profile.nip05?.toLowerCase().includes(queryLower);

			if (nameMatch || nip05Match) {
				matches.push(profile);
				seenPubkeys.add(profile.pubkey);
			}
		}

		// Show local matches immediately
		if (matches.length > 0) {
			this.mentionSuggestions = matches.slice(0, 10);
			this.selectedMentionIndex = 0;
			this.notifyStateChange();
		}

		const shouldSearchPrimal = query.length >= 2;
		const ndkInstance = get(ndk);
		const shouldSearchNdk = query.length >= 1 && ndkInstance;

		if (shouldSearchPrimal || shouldSearchNdk) {
			this.mentionSearching = true;
			this.notifyStateChange();
			try {
				if (shouldSearchPrimal) {
					const primalResults = await searchProfiles(query, 25);
					for (const profile of primalResults) {
						if (seenPubkeys.has(profile.pubkey)) continue;

						const name =
							profile.displayName || profile.name || profile.nip05?.split('@')[0] || 'Unknown';
						const profileData: MentionSuggestion = {
							name,
							npub: profile.npub || nip19.npubEncode(profile.pubkey),
							picture: profile.picture,
							pubkey: profile.pubkey,
							nip05: profile.nip05
						};
						matches.push(profileData);
						seenPubkeys.add(profile.pubkey);
						addToCache(profileData);
					}
				}

				if (shouldSearchNdk && ndkInstance) {
					const searchResults = await ndkInstance.fetchEvents({
						kinds: [0],
						search: query,
						limit: 50
					});

					for (const event of searchResults) {
						if (seenPubkeys.has(event.pubkey)) continue;

						try {
							const profile = JSON.parse(event.content);
							const name = profile.display_name || profile.name || '';
							const nip05 = profile.nip05;

							const profileData: MentionSuggestion = {
								name: name || nip05?.split('@')[0] || profile.name || 'Unknown',
								npub: nip19.npubEncode(event.pubkey),
								picture: profile.picture,
								pubkey: event.pubkey,
								nip05
							};
							matches.push(profileData);
							seenPubkeys.add(event.pubkey);
							addToCache(profileData);
						} catch {}
					}
				}
			} catch (e) {
				console.debug('Network search failed:', e);
			} finally {
				this.mentionSearching = false;
			}
		}

		// Sort: prioritize exact matches
		matches.sort((a, b) => {
			const aExact =
				a.name.toLowerCase().startsWith(queryLower) ||
				a.nip05?.toLowerCase().startsWith(queryLower);
			const bExact =
				b.name.toLowerCase().startsWith(queryLower) ||
				b.nip05?.toLowerCase().startsWith(queryLower);
			if (aExact && !bExact) return -1;
			if (!aExact && bExact) return 1;
			return a.name.localeCompare(b.name);
		});

		this.mentionSuggestions = matches.slice(0, 10);
		this.selectedMentionIndex = 0;
		this.notifyStateChange();
	}

	private insertMentionNode(
		mention: string,
		displayName: string,
		addTrailingSpace = false
	): void {
		if (!this.composerEl) return;

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;
		const range = selection.getRangeAt(0);

		const pill = createMentionPill(mention, displayName);
		const newRange = document.createRange();
		newRange.setStart(range.startContainer, range.startOffset);
		newRange.collapse(true);
		newRange.insertNode(pill);

		if (addTrailingSpace) {
			const spacer = document.createTextNode(' ');
			pill.after(spacer);
			newRange.setStartAfter(spacer);
		} else {
			newRange.setStartAfter(pill);
		}

		newRange.collapse(true);
		selection.removeAllRanges();
		selection.addRange(newRange);
	}

	private convertRawMentionsToPills(): boolean {
		if (!this.composerEl) return false;

		const rawText = this.composerEl.textContent || '';
		if (!rawText.includes('npub1')) return false;

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

		const range = selection.getRangeAt(0);
		const marker = document.createElement('span');
		marker.dataset.mentionCaret = 'true';
		marker.textContent = '\u200B';
		range.insertNode(marker);

		const composerEl = this.composerEl;
		const textNodes: Text[] = [];
		const walker = document.createTreeWalker(composerEl, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const parent = node.parentElement;
				if (!parent) return NodeFilter.FILTER_REJECT;
				if (parent.dataset.mention || parent.dataset.mentionCaret)
					return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			}
		});

		while (walker.nextNode()) {
			textNodes.push(walker.currentNode as Text);
		}

		const cache = getProfileCache();
		let converted = false;
		for (const textNode of textNodes) {
			const text = textNode.nodeValue;
			if (!text || !text.includes('npub1')) continue;

			const mentionRegex =
				/@npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58}|nprofile1[023456789acdefghjklmnpqrstuvwxyz]+)/g;
			let lastIndex = 0;
			let match: RegExpExecArray | null;
			let hasMatch = false;
			const fragment = document.createDocumentFragment();

			while ((match = mentionRegex.exec(text)) !== null) {
				hasMatch = true;
				const before = text.slice(lastIndex, match.index);
				if (before) {
					fragment.appendChild(document.createTextNode(before));
				}

				const rawMention = match[0];
				const mention = rawMention.startsWith('@')
					? `nostr:${rawMention.slice(1)}`
					: rawMention;
				const displayName = getDisplayNameForMention(mention, cache);
				fragment.appendChild(createMentionPill(mention, displayName));

				lastIndex = match.index + rawMention.length;
			}

			if (!hasMatch) continue;
			converted = true;

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			textNode.parentNode?.replaceChild(fragment, textNode);
		}

		const caretMarker = composerEl.querySelector('[data-mention-caret]');
		if (caretMarker) {
			const newRange = document.createRange();
			newRange.setStartAfter(caretMarker);
			newRange.collapse(true);
			selection.removeAllRanges();
			selection.addRange(newRange);
			caretMarker.remove();
		}

		return converted;
	}
}
