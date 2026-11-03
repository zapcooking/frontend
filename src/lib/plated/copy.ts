/**
 * Every user-facing string for Plated, in one place so the feature's name
 * and wording can change without touching components. The data marker
 * (`PLATED_MARKER` in ./plated.ts) deliberately does not live here.
 */
export const PLATED_COPY = {
  promptQuestion: 'Made this?',
  promptButton: 'Plate it',
  promptButtonLabel: 'Plate it: share a photo of your dish',
  promptHelper: 'Share a photo of your dish.',
  signInReason: 'Sign in to plate your dish',

  composerTitle: 'Plate your dish',
  composerPrompt: 'Add a photo and tell us how it turned out.',
  composerSubmit: 'Share your plate',
  composerPhotoRequired: 'Add a photo to share your plate.',
  success: 'Plated!',

  explainLabel: 'What is plating?',
  explanation:
    'Plating means sharing a photo of a recipe you made, so the cook who wrote it and everyone else can see how it turned out.',

  rowLabel: 'Photos from cooks who made this recipe',
  reportLabel: 'Report this photo',

  cardBadge: 'Plated this recipe',
  cardOpenPhoto: 'Open photo',

  galleryLabel: 'Plated photos',
  galleryPrevious: 'Previous photo',
  galleryNext: 'Next photo',
  gallerySeeInComments: 'See in comments'
} as const;

/** Accessible name for a row thumbnail, which opens the gallery. */
export function platedThumbLabel(alt: string): string {
  return `View photo: ${alt}`;
}

/** "Photo 2 of 5" — the gallery's position, announced as it changes. */
export function platedGalleryPosition(index: number, count: number): string {
  return `Photo ${index + 1} of ${count}`;
}

/** "Plated by 1 cook" / "Plated by 48 cooks". */
export function platedByLabel(cookCount: number): string {
  return cookCount === 1 ? 'Plated by 1 cook' : `Plated by ${cookCount} cooks`;
}

/** Alt text for a thumbnail: the cook's own description, else a generic one. */
export function platedThumbAlt(recipeTitle: string, cookAlt: string | null): string {
  if (cookAlt) return cookAlt;
  return recipeTitle ? `A cook's plate of ${recipeTitle}` : "A cook's plate of this recipe";
}
