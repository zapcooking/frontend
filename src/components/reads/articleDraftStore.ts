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

// Store for all drafts
export const drafts = writable<ArticleDraft[]>([]);

// Store for the currently active draft ID
export const currentDraftId = writable<string | null>(null);

// Store for draft save status
export const draftStatus = writable<DraftStatus>('saved');

// Store to control editor modal visibility
export const longformEditorOpen = writable<boolean>(false);

// Derived store for the current draft
export const currentDraft = derived(
	[drafts, currentDraftId],
	([$drafts, $currentDraftId]) => {
		if (!$currentDraftId) return null;
		return $drafts.find((d) => d.id === $currentDraftId) || null;
	}
);

/**
 * Load all drafts from localStorage
 */
export function loadDrafts(): ArticleDraft[] {
	if (!browser) return [];
	
	try {
		const stored = localStorage.getItem(ARTICLE_DRAFT_STORAGE_KEY);
		if (!stored) return [];
		
		const parsed = JSON.parse(stored) as ArticleDraft[];
		drafts.set(parsed);
		return parsed;
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
	
	// Sync to relays if available and requested
	let syncPromise: Promise<boolean> | undefined;
	if (syncToRelays && isDraftSyncAvailable()) {
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
	saveDraft(newDraft);
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
		
		if (articleDrafts.length === 0) return;
		
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
		
		// Update store
		const merged = Array.from(mergedMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
		drafts.set(merged);
		persistDrafts(merged);
		
		// Sync any local-only or newer drafts back to remote
		for (const draft of merged) {
			const remote = articleDrafts.find(rd => rd.id === draft.id);
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
