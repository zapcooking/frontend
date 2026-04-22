import { readable } from 'svelte/store';
import { browser } from '$app/environment';

// Minimum hide duration before we treat a tab-return as worth refreshing.
// Filters out quick app-switches / accidental toggles where data can't have
// gone meaningfully stale.
const MIN_HIDDEN_MS = 1000;

/**
 * Increments each time the tab becomes visible after being hidden for at
 * least MIN_HIDDEN_MS. Value 0 is the initial state and never represents a
 * real transition — consumers should trigger only when the value is > 0.
 */
export const tabVisibleAfterHide = readable(0, (set) => {
	if (!browser) return () => {};

	let hiddenSince = 0;
	let count = 0;

	const handler = () => {
		if (document.hidden) {
			hiddenSince = Date.now();
			return;
		}
		if (hiddenSince && Date.now() - hiddenSince >= MIN_HIDDEN_MS) {
			hiddenSince = 0;
			count += 1;
			set(count);
			return;
		}
		hiddenSince = 0;
	};

	document.addEventListener('visibilitychange', handler);
	return () => document.removeEventListener('visibilitychange', handler);
});
