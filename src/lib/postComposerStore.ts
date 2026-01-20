import { writable } from 'svelte/store';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

export const postComposerOpen = writable(false);

// Store for quoted note when opening the composer with a quote
export const quotedNoteStore = writable<{ nevent: string; event: NDKEvent } | null>(null);

// Helper function to open composer with a quoted note
export function openComposerWithQuote(nevent: string, event: NDKEvent) {
  quotedNoteStore.set({ nevent, event });
  postComposerOpen.set(true);
}

// Helper function to clear the quoted note (called when composer closes)
export function clearQuotedNote() {
  quotedNoteStore.set(null);
}
