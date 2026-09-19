import { writable } from 'svelte/store';

/**
 * The last /community URL the user was on, tab query included
 * (e.g. "/community?tab=following"). Captured by the root layout on
 * every navigation away from the feed so "back to feed" affordances —
 * like the note page's breadcrumb — can return to the exact tab the
 * user came from instead of the default one.
 */
export const lastFeedUrl = writable<string | null>(null);
