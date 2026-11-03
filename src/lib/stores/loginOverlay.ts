import { writable } from 'svelte/store';
export const loginOverlayOpen = writable(false);

/**
 * Open the overlay on account creation instead of the sign-in card
 * ("Join free"). LoginOverlay reads and clears it when it mounts.
 */
export const loginOverlaySignup = writable(false);

export function openSignup(): void {
  loginOverlaySignup.set(true);
  loginOverlayOpen.set(true);
}
