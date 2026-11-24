import { writable } from 'svelte/store';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import type { ComposerRestore } from './scheduledList';

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

/**
 * Text the composer starts with the next time it opens (e.g. "Share on
 * Nostr" for a live stream). The composer takes it once on open and
 * clears it; an unsent draft keeps its text and gets this after it.
 */
export const composerPrefillText = writable<string | null>(null);

export function openComposerWithText(text: string) {
  composerPrefillText.set(text);
  postComposerOpen.set(true);
}

/**
 * A scheduled post on its way back into the composer (Reschedule, in My
 * Kitchen › Scheduled). The text and attachments travel as the
 * composer's stored draft; this carries the rest: the poll, the relay
 * mode and the time. The composer takes it once on open and clears it.
 */
export const composerRestore = writable<ComposerRestore | null>(null);

export function openComposerRestored(restore: ComposerRestore) {
  composerRestore.set(restore);
  postComposerOpen.set(true);
}

// A parked note draft: the composer closed with unsent content and the draft
// is waiting. The DraftDock shows it as a tab; opening the composer from
// anywhere clears it (the composer itself restores the draft from
// localStorage on open).
export const noteDraftDocked = writable<{ preview: string } | null>(null);
