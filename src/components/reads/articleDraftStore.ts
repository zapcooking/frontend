/**
 * Article Draft Store
 * Manages article drafts in localStorage with NIP-37 sync support
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import {
	type ArticleDraft,
	type DraftStatus,
	ARTICLE_DRAFT_STORAGE_KEY,
	createEmptyDraft
} from '$lib/articleEditor';
import {
	publishArticleDraftDebounced,
	publishArticleDraft,
	deleteDraftRemote,
	isDraftSyncAvailable,
	fetchRemoteDrafts,
	type RemoteDraft
} from '$lib/nip37DraftService';
import { hasArticleDraftContent } from '$lib/draftContent';

// Store for all drafts
export const drafts = writable<ArticleDraft[]>([]);

// Store for the currently active draft ID
export const currentDraftId = writable<string | null>(null);

// A freshly opened draft the user hasn't typed into yet. It lives here,
// not in `drafts`, so nothing is persisted or synced until it has content.
export const pendingDraft = writable<ArticleDraft | null>(null);

// Store for draft save status
export const draftStatus = writable<DraftStatus>('saved');

// Store to control editor modal visibility
export const longformEditorOpen = writable<boolean>(false);

// Derived store for the current draft
export const currentDraft = derived(
	[drafts, currentDraftId, pendingDraft],
	([$drafts, $currentDraftId, $pendingDraft]) => {
		if (!$currentDraftId) return null;
		const stored = $drafts.find((d) => d.id === $currentDraftId);
		if (stored) return stored;
		return $pendingDraft?.id === $currentDraftId ? $pendingDraft : null;
	}
);

/**
 * Drop content-less drafts from a list. Returns the survivors and the
 * empties so callers can tombstone the ones that reached a relay.
 */
function partitionEmptyDrafts(list: ArticleDraft[]): { kept: ArticleDraft[]; empties: ArticleDraft[] } {
	const kept: ArticleDraft[] = [];
	const empties: ArticleDraft[] = [];
	for (const draft of list) {
		(hasArticleDraftContent(draft) ? kept : empties).push(draft);
	}
	return { kept, empties };
}

/**
 * Load all drafts from localStorage
 */
export function loadDrafts(): ArticleDraft[] {
	if (!browser) return [];
	
	try {
		const stored = localStorage.getItem(ARTICLE_DRAFT_STORAGE_KEY);
		if (!stored) return [];
		
		const parsed = JSON.parse(stored) as ArticleDraft[];
		// Sweep empties left behind by builds that persisted before content
		const { kept, empties } = partitionEmptyDrafts(parsed);
		if (empties.length > 0) {
			console.log(`[ArticleDrafts] Swept ${empties.length} empty draft(s)`);
			persistDrafts(kept);
		}
		drafts.set(kept);
		return kept;
	} catch (error) {
		console.error('[ArticleDrafts] Error loading drafts:', error);
		return [];
	}
}

/**
 * Save all drafts to localStorage
 */
function persistDrafts(allDrafts: ArticleDraft[]): void {
	if (!browser) return;
	
	try {
		localStorage.setItem(ARTICLE_DRAFT_STORAGE_KEY, JSON.stringify(allDrafts));
	} catch (error) {
		console.error('[ArticleDrafts] Error persisting drafts:', error);
		draftStatus.set('error');
	}
}

/**
 * Save or update a draft
 * Optionally sync to NIP-37 relays if available
 */
export function saveDraft(draft: ArticleDraft, syncToRelays: boolean = true): { draftId: string; syncPromise?: Promise<boolean> } {
	const hasContent = hasArticleDraftContent(draft);
	const isStored = get(drafts).some((d) => d.id === draft.id);

	// No title, no body, no attachment, and nothing on disk yet: keep it
	// pending. Don't persist, don't sync. The id stays stable so the editor
	// keeps working on the same draft once the user does type something.
	if (!hasContent && !isStored) {
		pendingDraft.update((p) => (p?.id === draft.id ? { ...draft } : p));
		draftStatus.set('saved');
		return { draftId: draft.id };
	}

	draftStatus.set('saving');
	
	const updatedDraft = {
		...draft,
		updatedAt: Date.now()
	};
	
	drafts.update((allDrafts) => {
		const existingIndex = allDrafts.findIndex((d) => d.id === draft.id);
		
		let newDrafts: ArticleDraft[];
		if (existingIndex >= 0) {
			// Update existing draft
			newDrafts = [...allDrafts];
			newDrafts[existingIndex] = updatedDraft;
		} else {
			// Add new draft
			newDrafts = [...allDrafts, updatedDraft];
		}
		
		persistDrafts(newDrafts);
		return newDrafts;
	});
	pendingDraft.update((p) => (p?.id === draft.id ? null : p));
	
	// Sync to relays if available, requested, and there is content to sync.
	// An existing draft the user has emptied stays on disk but is not pushed.
	let syncPromise: Promise<boolean> | undefined;
	if (syncToRelays && hasContent && isDraftSyncAvailable()) {
		// Use debounced publish for auto-saves, immediate for manual saves
		publishArticleDraftDebounced(updatedDraft);
		// For immediate sync (manual save), return a promise
		syncPromise = publishArticleDraft(updatedDraft);
	}
	
	draftStatus.set('saved');
	
	return { draftId: updatedDraft.id, syncPromise };
}

/**
 * Delete a draft by ID
 * Also deletes from remote relays if NIP-37 sync is available
 */
export async function deleteDraft(draftId: string): Promise<void> {
	pendingDraft.update((p) => (p?.id === draftId ? null : p));
	drafts.update((allDrafts) => {
		const newDrafts = allDrafts.filter((d) => d.id !== draftId);
		persistDrafts(newDrafts);
		return newDrafts;
	});
	
	// Delete from remote relays if available
	if (isDraftSyncAvailable()) {
		await deleteDraftRemote(draftId, 'article');
	}
	
	// Clear current draft if it was deleted
	const $currentDraftId = get(currentDraftId);
	if ($currentDraftId === draftId) {
		currentDraftId.set(null);
	}
}

/**
 * Create a new draft and set it as current
 */
export function createNewDraft(): ArticleDraft {
	const newDraft = createEmptyDraft();
	// Not saved: an empty draft is held in memory until it has content
	pendingDraft.set(newDraft);
	currentDraftId.set(newDraft.id);
	return newDraft;
}

/**
 * Open the editor with a specific draft
 */
export function openDraft(draftId: string): void {
	currentDraftId.set(draftId);
	longformEditorOpen.set(true);
}

/**
 * Open the editor with a new draft
 */
export function openNewDraft(): void {
	createNewDraft();
	longformEditorOpen.set(true);
}

/**
 * Close the editor
 */
export function closeEditor(): void {
	longformEditorOpen.set(false);
	// Don't clear currentDraftId - keep it for potential re-opening
}

/**
 * Get draft count
 */
export function getDraftCount(): number {
	return get(drafts).length;
}

/**
 * Sync drafts from remote relays
 * Merges remote drafts with local ones, keeping the newest version
 */
export async function syncDraftsFromRemote(): Promise<void> {
	if (!browser || !isDraftSyncAvailable()) return;
	
	try {
		const remoteDrafts = await fetchRemoteDrafts();
		
		// Filter for article drafts only
		const articleDrafts = remoteDrafts
			.filter(rd => rd.draftType === 'article')
			.map(rd => rd.draft as ArticleDraft);
		const remoteIds = new Set(articleDrafts.map((d) => d.id));
		
		// Merge with local drafts
		const localDrafts = get(drafts);
		const mergedMap = new Map<string, ArticleDraft>();
		
		// Add remote drafts first
		for (const remote of articleDrafts) {
			mergedMap.set(remote.id, remote);
		}
		
		// Merge local drafts (keep if newer)
		for (const local of localDrafts) {
			const existing = mergedMap.get(local.id);
			if (!existing || local.updatedAt > existing.updatedAt) {
				mergedMap.set(local.id, local);
			}
		}
		
		// Sweep content-less drafts on either side; tombstone the remote ones
		const { kept, empties } = partitionEmptyDrafts(Array.from(mergedMap.values()));
		for (const empty of empties) {
			if (remoteIds.has(empty.id)) {
				deleteDraftRemote(empty.id, 'article').catch((e) => {
					console.error(`[ArticleDrafts] Failed to remove empty draft ${empty.id} from remote:`, e);
				});
			}
		}
		if (empties.length > 0) {
			console.log(`[ArticleDrafts] Swept ${empties.length} empty draft(s)`);
		}
		
		// Update store
		const merged = kept.sort((a, b) => b.updatedAt - a.updatedAt);
		drafts.set(merged);
		persistDrafts(merged);
		
		// Nothing came back (no drafts, or the fetch failed and returned []):
		// don't treat every local draft as new and republish the lot.
		if (articleDrafts.length === 0) return;
		
		// Sync any local-only or newer drafts back to remote
		for (const draft of merged) {
			const remote = remoteDrafts.find(rd => rd.draftType === 'article' && rd.id === draft.id);
			if (!remote || draft.updatedAt > remote.createdAt) {
				publishArticleDraftDebounced(draft);
			}
		}
	} catch (error) {
		console.error('[ArticleDrafts] Error syncing from remote:', error);
	}
}

// Initialize drafts on module load (browser only)
if (browser) {
	loadDrafts();
	// Sync from remote in background if available
	if (isDraftSyncAvailable()) {
		syncDraftsFromRemote().catch(console.error);
	}
}
