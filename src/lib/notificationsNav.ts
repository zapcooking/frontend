import { writable } from 'svelte/store';

/**
 * Increment this when the Notifications bell is clicked.
 * The /notifications page can listen to it to force refresh + scroll-to-top,
 * even if already on the route.
 */
export const notificationsNavTick = writable(0);

export function triggerNotificationsNav(): void {
  notificationsNavTick.update((n) => n + 1);
}

