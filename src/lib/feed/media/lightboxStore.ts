/**
 * Shared store driving the global Lightbox.
 *
 * Any component can call `openLightbox(items, index)` to surface the
 * full-screen media viewer without prop-drilling — the single
 * `<Lightbox />` instance mounted at the layout level subscribes to
 * this store and renders whatever's in it.
 */

import { writable } from 'svelte/store';
import type { MediaItem } from '../types';

export interface LightboxState {
  open: boolean;
  items: MediaItem[];
  index: number;
}

const initial: LightboxState = { open: false, items: [], index: 0 };

export const lightbox = writable<LightboxState>(initial);

/** Open the lightbox at `index` showing the given media items. */
export function openLightbox(items: MediaItem[], index = 0): void {
  if (!items || items.length === 0) return;
  const clamped = Math.max(0, Math.min(index, items.length - 1));
  lightbox.set({ open: true, items, index: clamped });
}

/** Close the lightbox. Items are kept so the closing transition can
 * still render the current frame; cleared on the next open. */
export function closeLightbox(): void {
  lightbox.update((s) => ({ ...s, open: false }));
}

/** Advance to the next item, clamped at the end. */
export function lightboxNext(): void {
  lightbox.update((s) => {
    if (s.items.length === 0) return s;
    return { ...s, index: Math.min(s.index + 1, s.items.length - 1) };
  });
}

/** Go to the previous item, clamped at zero. */
export function lightboxPrev(): void {
  lightbox.update((s) => {
    if (s.items.length === 0) return s;
    return { ...s, index: Math.max(s.index - 1, 0) };
  });
}

/** Jump directly to a specific index. */
export function lightboxGoto(index: number): void {
  lightbox.update((s) => {
    if (s.items.length === 0) return s;
    const clamped = Math.max(0, Math.min(index, s.items.length - 1));
    return { ...s, index: clamped };
  });
}
