import { writable } from 'svelte/store';

/**
 * Increment this when the logo is tapped while already on /explore.
 * The /explore page listens to scroll to top and refresh.
 */
export const exploreNavTick = writable(0);

export function triggerExploreNav(): void {
  exploreNavTick.update((n) => n + 1);
}
