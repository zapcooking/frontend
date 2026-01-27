/**
 * Article Editor constants and types
 * Separate from recipe system - uses #zapreads hashtag instead of #zapcooking
 */

// Tag used for articles (NOT recipes)
export const ARTICLE_TAG = 'zapreads';

// LocalStorage key for article drafts (separate from recipe drafts)
export const ARTICLE_DRAFT_STORAGE_KEY = 'zapcooking_article_drafts';

// Auto-save interval in milliseconds
export const AUTOSAVE_INTERVAL_MS = 30000; // 30 seconds

// Reading speed for estimated reading time
export const WORDS_PER_MINUTE = 250;

/**
 * Article draft interface
 */
export interface ArticleDraft {
	id: string;
	title: string;
	subtitle: string;
	content: string; // HTML from Tiptap editor
	coverImage: string;
	tags: string[];
	createdAt: number; // Unix timestamp
	updatedAt: number; // Unix timestamp
}

/**
 * Draft save status
 */
export type DraftStatus = 'saved' | 'saving' | 'unsaved' | 'error';

/**
 * Generate a unique draft ID
 */
export function generateDraftId(): string {
	return `draft_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate word count from HTML content
 */
export function getWordCount(htmlContent: string): number {
	if (!htmlContent) return 0;
	// Strip HTML tags and count words
	const text = htmlContent.replace(/<[^>]*>/g, ' ').trim();
	if (!text) return 0;
	return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Calculate estimated reading time in minutes
 */
export function getReadingTime(wordCount: number): number {
	return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}

/**
 * Create an empty draft
 */
export function createEmptyDraft(): ArticleDraft {
	const now = Date.now();
	return {
		id: generateDraftId(),
		title: '',
		subtitle: '',
		content: '',
		coverImage: '',
		tags: [],
		createdAt: now,
		updatedAt: now
	};
}

/**
 * Validate that a draft has minimum required content
 */
export function isDraftPublishable(draft: ArticleDraft): boolean {
	return draft.title.trim().length > 0 && getWordCount(draft.content) > 50;
}
