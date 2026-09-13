import { writable } from 'svelte/store';

/**
 * Global compact-profile preview modal state.
 *
 * Avatar clicks anywhere in the app open the preview instead of
 * navigating to /user/<npub>; the preview's "View full profile" button
 * (and modified clicks — cmd/ctrl/middle — on avatars) still reach the
 * full page. Kept as a bare pubkey store so any component or the
 * layout-level click interceptor can open it without prop drilling.
 */

export const profilePreviewPubkey = writable<string | null>(null);

export function openProfilePreview(npubOrPubkey: string): void {
  const value = npubOrPubkey.trim();
  if (!value) return;
  profilePreviewPubkey.set(value);
}

export function closeProfilePreview(): void {
  profilePreviewPubkey.set(null);
}
