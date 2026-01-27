/**
 * Article Draft Store
 * Manages article drafts in localStorage, separate from recipe drafts
 */

import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import {
	type ArticleDraft,
	type DraftStatus,
	ARTICLE_DRAFT_STORAGE_KEY,
	createEmptyDraft
} from '$lib/articleEditor';

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
 */
export function saveDraft(draft: ArticleDraft): void {
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
	
	draftStatus.set('saved');
}

/**
 * Delete a draft by ID
 */
export function deleteDraft(draftId: string): void {
	drafts.update((allDrafts) => {
		const newDrafts = allDrafts.filter((d) => d.id !== draftId);
		persistDrafts(newDrafts);
		return newDrafts;
	});
	
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

// Initialize drafts on module load (browser only)
if (browser) {
	loadDrafts();
}
