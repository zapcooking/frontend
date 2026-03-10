/**
 * Tiptap Mention Suggestion configuration
 * Connects the @mention extension to Nostr profile search
 */

import { searchProfiles, parseIdentifier, getDisplayName, type SearchProfile } from '$lib/profileSearchService';
import type { SuggestionOptions } from '@tiptap/suggestion';
import MentionList from './MentionList.svelte';

let component: MentionList | null = null;
let popup: HTMLElement | null = null;
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

function destroyPopup() {
	if (component) {
		component.$destroy();
		component = null;
	}
	if (popup) {
		popup.remove();
		popup = null;
	}
}

export const mentionSuggestion: Omit<SuggestionOptions, 'editor'> = {
	char: '@',
	allowSpaces: false,
	// Allow npub matching (alphanumeric chars after @)
	allowedPrefixes: null,

	items: async ({ query }: { query: string }) => {
		if (!query || query.length < 1) return [];

		// Search profiles by name or npub
		const results = await searchProfiles(query, 8);
		return results;
	},

	render: () => {
		return {
			onStart: (props: any) => {
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
				if (component) {
					component.$set({
						items: props.items || [],
						command: props.command
					});
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
				destroyPopup();
			}
		};
	}
};

function updatePosition(props: any) {
	if (!popup || !props.clientRect) return;

	const rect = props.clientRect();
	if (!rect) return;

	popup.style.left = `${rect.left}px`;
	popup.style.top = `${rect.bottom + 4}px`;
}
