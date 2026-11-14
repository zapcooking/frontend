/**
 * What a Go live stream is called, everywhere it is named: the Live card,
 * the watch page, the dock, the host page and the link preview.
 *
 *  - With a recipe: "<host name> is cooking <recipe name>"
 *    ("Cooking <recipe name>" while the host's name is not known).
 *  - Without a recipe: the title the host typed, or "Live from Zap Cooking"
 *    when they kept the default. The old default, "Live cook-along", counts
 *    as the default too, so sessions created before the change read right.
 *
 * Pure, so the server-rendered link preview and the pages cannot drift.
 */

export const LIVE_DEFAULT_TITLE = 'Live from Zap Cooking';

/** Titles that mean "the host did not name it". Compared case-insensitively. */
const DEFAULT_TITLES = new Set(['live from zap cooking', 'live cook-along']);

export function isDefaultLiveTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').trim().toLowerCase();
  return t === '' || DEFAULT_TITLES.has(t);
}

export interface LiveNameInput {
  /** The session's stored title. For a recipe stream the host page stores the recipe's title. */
  title: string;
  /** Whether a recipe is attached (the session has a recipe address). */
  hasRecipe: boolean;
  /** The recipe's own title, once it has been fetched. */
  recipeTitle?: string | null;
  /** The host's real display name; never a pseudonym. */
  hostName?: string | null;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** The recipe name to use, or null when there is none to show. */
export function liveRecipeName(input: LiveNameInput): string | null {
  if (!input.hasRecipe) return null;
  const fetched = clean(input.recipeTitle);
  if (fetched) return fetched;
  // Not fetched yet (or could not be): the stored title is the recipe's,
  // unless the host page fell back to the default.
  const stored = clean(input.title);
  return isDefaultLiveTitle(stored) ? null : stored;
}

export function liveStreamName(input: LiveNameInput): string {
  const recipe = liveRecipeName(input);
  if (recipe) {
    const host = clean(input.hostName);
    return host ? `${host} is cooking ${recipe}` : `Cooking ${recipe}`;
  }
  const title = clean(input.title);
  return isDefaultLiveTitle(title) ? LIVE_DEFAULT_TITLE : title;
}
