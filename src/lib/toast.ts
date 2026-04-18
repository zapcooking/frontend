/**
 * Transient user-facing notification messages.
 *
 * Introduced in Task 6 Stage 5 specifically for comment-post error
 * surfacing. Deliberately narrow: this is NOT a general-purpose
 * notification system (the in-app Nostr notification feed under
 * src/lib/notificationStore.ts handles that concern).
 *
 * Usage:
 *   import { showToast } from '$lib/toast';
 *   showToast('error', "Couldn't post comment — please try again.");
 */
import { writable } from 'svelte/store';

export type ToastVariant = 'error' | 'info' | 'success';

export interface ToastMessage {
  id: string;
  variant: ToastVariant;
  message: string;
  /** Auto-dismiss after this many ms. Pass 0 to disable auto-dismiss. */
  durationMs: number;
}

export const toasts = writable<ToastMessage[]>([]);

/**
 * Fire a toast. Returns the id so callers can dismiss early if needed.
 */
export function showToast(
  variant: ToastVariant,
  message: string,
  durationMs = 4000
): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  toasts.update((list) => [...list, { id, variant, message, durationMs }]);
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export function dismissToast(id: string): void {
  toasts.update((list) => list.filter((t) => t.id !== id));
}
