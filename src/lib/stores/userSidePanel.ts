import { writable } from 'svelte/store';

export const userSidePanelOpen = writable(false);

/** Which edge the panel docks to — set by whoever opens it (the sidebar
    avatar is on the left, the header-strip avatar on the right). */
export const userSidePanelSide = writable<'left' | 'right'>('right');

export function openUserSidePanel(side: 'left' | 'right' = 'right') {
  userSidePanelSide.set(side);
  userSidePanelOpen.set(true);
}
