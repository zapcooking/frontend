import { writable } from 'svelte/store';

/**
 * True while a page is drawing its own bar along the bottom of the mobile
 * viewport (currently: the membership page's sticky purchase CTA).
 *
 * The root layout hides the floating create button and scroll-to-top
 * button while this is set, so they never sit on top of the bar. Pages
 * that set it must clear it on destroy.
 */
export const bottomDockOccupied = writable(false);
