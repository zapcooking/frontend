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

export interface ToastLink {
  label: string;
  href: string;
}

export interface ToastMessage {
  id: string;
  variant: ToastVariant;
  message: string;
  /** Auto-dismiss after this many ms. Pass 0 to disable auto-dismiss. */
  durationMs: number;
  /** Optional CTA link rendered next to the message. */
  link?: ToastLink;
}

export const toasts = writable<ToastMessage[]>([]);

/**
 * Fire a toast. Returns the id so callers can dismiss early if needed.
 *
 * Only one toast is shown at a time: a new toast replaces any currently
 * visible. This keeps a rapid burst (e.g. repeated blocked pastes) from
 * stacking a column of identical messages.
 */
export function showToast(
  variant: ToastVariant,
  message: string,
  durationMs = 4000,
  link?: ToastLink
): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  toasts.set([{ id, variant, message, durationMs, link }]);
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export function dismissToast(id: string): void {
  toasts.update((list) => list.filter((t) => t.id !== id));
}
