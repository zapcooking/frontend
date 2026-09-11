import { writable } from 'svelte/store';

/**
 * True while the Cook+ discovery modal is on screen. The discovery modal
 * owns its `open` flag locally; this mirror lets other Cook+ surfaces
 * (the promotional bottom bar) yield to it without a DOM query.
 */
export const cookPlusDiscoveryModalOpen = writable(false);
