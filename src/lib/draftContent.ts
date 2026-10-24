/**
 * Draft content predicates
 *
 * A draft only earns a storage slot (localStorage) and a relay write
 * (NIP-37) once the user has actually put something in it: a title, a
 * body, an attachment, or metadata. Both draft stores and the NIP-37
 * publisher consult these, so an empty draft can neither be created nor
 * synced, and any that already exist can be swept.
 *
 * Lives in its own module because nip37DraftService imports it and
 * draftStore imports nip37DraftService — a runtime import in the other
 * direction would be circular.
 */

import type { RecipeDraft } from '$lib/draftStore';
import { getWordCount, type ArticleDraft } from '$lib/articleEditor';

type RecipeDraftFields = Omit<RecipeDraft, 'id' | 'createdAt' | 'updatedAt'>;
type ArticleDraftFields = Omit<ArticleDraft, 'id' | 'createdAt' | 'updatedAt'>;

const nonBlank = (s: string | undefined | null): boolean => Boolean(s && s.trim());
const anyNonBlank = (list: readonly string[] | undefined | null): boolean =>
  Array.isArray(list) && list.some(nonBlank);

/** Embedded media counts as content even when the body has no words. */
const EMBEDDED_MEDIA = /<(img|video|audio|iframe)\b/i;

export function hasRecipeDraftContent(draft: Partial<RecipeDraftFields>): boolean {
  return (
    nonBlank(draft.title) ||
    anyNonBlank(draft.images) ||
    (Array.isArray(draft.tags) && draft.tags.some((t) => nonBlank(t?.title))) ||
    nonBlank(draft.summary) ||
    nonBlank(draft.chefsnotes) ||
    nonBlank(draft.preptime) ||
    nonBlank(draft.cooktime) ||
    nonBlank(draft.servings) ||
    anyNonBlank(draft.ingredients) ||
    anyNonBlank(draft.directions) ||
    nonBlank(draft.additionalMarkdown)
  );
}

export function hasArticleDraftContent(draft: Partial<ArticleDraftFields>): boolean {
  const content = draft.content ?? '';
  return (
    nonBlank(draft.title) ||
    nonBlank(draft.subtitle) ||
    nonBlank(draft.coverImage) ||
    anyNonBlank(draft.tags) ||
    getWordCount(content) > 0 ||
    EMBEDDED_MEDIA.test(content)
  );
}
