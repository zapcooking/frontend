/**
 * Where the persistent player currently belongs on the page.
 *
 * The single `<video>` lives in the root layout (`StreamDock`), so it
 * survives SvelteKit navigation — that is what keeps playback (and an open
 * picture-in-picture window) alive across route changes. The stream page
 * declares a slot element here on mount and clears it on destroy; the dock
 * moves its container into the slot while it exists and back into its
 * floating corner afterwards. Moving a node within the document does not
 * interrupt playback or leave picture-in-picture.
 */

import { writable } from 'svelte/store';

export const streamSlot = writable<HTMLElement | null>(null);
