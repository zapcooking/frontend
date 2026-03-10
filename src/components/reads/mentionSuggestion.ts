/**
 * Tiptap Mention Suggestion configuration
 * Connects the @mention extension to Nostr profile search
 */

import { searchProfiles, type SearchProfile } from '$lib/profileSearchService';
import type { SuggestionOptions } from '@tiptap/suggestion';

let component: any = null;
let popup: HTMLElement | null = null;

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
		if (!query || query.length < 1) return [];
		const results = await searchProfiles(query, 8);
		return results;
	},

	render: () => {
		return {
			onStart: async (props: any) => {
				// Dynamic import to avoid SSR issues
				const { default: MentionList } = await import('./MentionList.svelte');

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
