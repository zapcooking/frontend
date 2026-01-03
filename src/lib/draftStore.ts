/**
 * Recipe Draft Store
 * Manages saving and loading recipe drafts in localStorage
 */

import { browser } from '$app/environment';
import { writable, get } from 'svelte/store';

export interface RecipeDraft {
  id: string;
  title: string;
  images: string[];
  tags: { title: string; emoji?: string }[];
  summary: string;
  chefsnotes: string;
  preptime: string;
  cooktime: string;
  servings: string;
  ingredients: string[];
  directions: string[];
  additionalMarkdown: string;
  createdAt: number;
  updatedAt: number;
}

const DRAFTS_STORAGE_KEY = 'zapcooking_recipe_drafts';

// Store for reactive updates
export const draftsStore = writable<RecipeDraft[]>([]);

/**
 * Load all drafts from localStorage
 */
export function loadDrafts(): RecipeDraft[] {
  if (!browser) return [];
  
  try {
    const stored = localStorage.getItem(DRAFTS_STORAGE_KEY);
    if (stored) {
      const drafts = JSON.parse(stored) as RecipeDraft[];
      // Sort by most recently updated
      drafts.sort((a, b) => b.updatedAt - a.updatedAt);
      draftsStore.set(drafts);
      return drafts;
    }
  } catch (error) {
    console.error('Error loading drafts:', error);
  }
  
  draftsStore.set([]);
  return [];
}

/**
 * Save drafts to localStorage
 */
function saveDraftsToStorage(drafts: RecipeDraft[]): void {
  if (!browser) return;
  
  try {
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
    draftsStore.set(drafts);
  } catch (error) {
    console.error('Error saving drafts:', error);
  }
}

/**
 * Generate a unique ID for a draft
 */
function generateDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Save a new draft or update an existing one
 */
export function saveDraft(draft: Omit<RecipeDraft, 'id' | 'createdAt' | 'updatedAt'>, existingId?: string): string {
  const drafts = loadDrafts();
  const now = Date.now();
  
  if (existingId) {
    // Update existing draft
    const index = drafts.findIndex(d => d.id === existingId);
    if (index !== -1) {
      drafts[index] = {
        ...drafts[index],
        ...draft,
        updatedAt: now
      };
      saveDraftsToStorage(drafts);
      return existingId;
    }
  }
  
  // Create new draft
  const newDraft: RecipeDraft = {
    ...draft,
    id: generateDraftId(),
    createdAt: now,
    updatedAt: now
  };
  
  drafts.unshift(newDraft); // Add to beginning
  saveDraftsToStorage(drafts);
  return newDraft.id;
}

/**
 * Get a draft by ID
 */
export function getDraft(id: string): RecipeDraft | undefined {
  const drafts = loadDrafts();
  return drafts.find(d => d.id === id);
}

/**
 * Delete a draft by ID
 */
export function deleteDraft(id: string): boolean {
  const drafts = loadDrafts();
  const index = drafts.findIndex(d => d.id === id);
  
  if (index !== -1) {
    drafts.splice(index, 1);
    saveDraftsToStorage(drafts);
    return true;
  }
  
  return false;
}

/**
 * Get the count of drafts
 */
export function getDraftCount(): number {
  return get(draftsStore).length;
}

/**
 * Clear all drafts (use with caution)
 */
export function clearAllDrafts(): void {
  if (!browser) return;
  
  localStorage.removeItem(DRAFTS_STORAGE_KEY);
  draftsStore.set([]);
}

/**
 * Format a timestamp for display
 */
export function formatDraftDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString();
}

