/**
 * Tiptap Mention Suggestion configuration
 * Connects the @mention extension to Nostr profile search
 */

import { searchProfiles, type SearchProfile } from '$lib/profileSearchService';
import type { SuggestionOptions } from '@tiptap/suggestion';

let component: any = null;
let popup: HTMLElement | null = null;
let pendingDestroy = false;

// Pre-cache the dynamic import so onStart can be synchronous
let MentionListCached: any = null;
function preloadMentionList() {
	if (!MentionListCached) {
		import('./MentionList.svelte').then((mod) => {
			MentionListCached = mod.default;
		});
	}
}

// Preload on module init (only runs in browser)
if (typeof window !== 'undefined') {
	preloadMentionList();
}

function destroyPopup() {
	if (component) {
		component.$destroy();
		component = null;
	}
	if (popup) {
		popup.remove();
		popup = null;
	}
	pendingDestroy = false;
}

function updatePosition(props: any) {
	if (!popup || !props.clientRect) return;

	const rect = props.clientRect();
	if (!rect) return;

	popup.style.left = `${rect.left}px`;
	popup.style.top = `${rect.bottom + 4}px`;
}

export const mentionSuggestion: Omit<SuggestionOptions, 'editor'> = {
	char: '@',
	allowSpaces: false,
	allowedPrefixes: null,

	items: async ({ query }: { query: string }) => {
		if (!query || query.length < 2) return [];
		const results = await searchProfiles(query, 8);
		return results;
	},

	render: () => {
		return {
			onStart: async (props: any) => {
				pendingDestroy = false;

				// Use cached import if available, otherwise load dynamically
				let MentionList = MentionListCached;
				if (!MentionList) {
					const mod = await import('./MentionList.svelte');
					MentionList = mod.default;
					MentionListCached = MentionList;
				}

				// If onExit was called while we were loading, abort
				if (pendingDestroy) {
					pendingDestroy = false;
					return;
				}

				// Don't show dropdown for empty results
				if (!props.items || props.items.length === 0) return;

				popup = document.createElement('div');
				popup.style.position = 'absolute';
				popup.style.zIndex = '9999';
				document.body.appendChild(popup);

				component = new MentionList({
					target: popup,
					props: {
						items: props.items || [],
						command: props.command,
						loading: false
					}
				});

				updatePosition(props);
			},

			onUpdate: (props: any) => {
				// Hide dropdown when no results
				if (!props.items || props.items.length === 0) {
					destroyPopup();
					return;
				}

				if (component) {
					component.$set({
						items: props.items || [],
						command: props.command
					});
				} else {
					// Component wasn't created yet (e.g. initial items were empty)
					// Create it now that we have results
					const MentionList = MentionListCached;
					if (MentionList) {
						popup = document.createElement('div');
						popup.style.position = 'absolute';
						popup.style.zIndex = '9999';
						document.body.appendChild(popup);

						component = new MentionList({
							target: popup,
							props: {
								items: props.items || [],
								command: props.command,
								loading: false
							}
						});
					}
				}
				updatePosition(props);
			},

			onKeyDown: (props: any) => {
				if (props.event.key === 'Escape') {
					destroyPopup();
					return true;
				}
				if (component) {
					return component.onKeyDown(props.event);
				}
				return false;
			},

			onExit: () => {
				// Mark pending destroy in case onStart is still loading
				pendingDestroy = true;
				destroyPopup();
			}
		};
	}
};
