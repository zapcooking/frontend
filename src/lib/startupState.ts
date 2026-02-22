import { writable } from 'svelte/store';

/** Set to true once the feed's initial load completes (cache hit, fresh fetch, or error). */
export const feedInitialLoadDone = writable(false);
