/**
 * Shared constants + types for the anon URL-import handoff between the
 * landing hero (`LandingImportHero.svelte`) and the Sous Chef editor
 * (`/souschef`). The hero POSTs to `/api/extract-recipe/public`,
 * stashes the parsed recipe in sessionStorage under this key, and
 * navigates to `/souschef`. The editor reads and clears the handoff on
 * mount, entering view-only preview mode until sign-in.
 *
 * Handoff is short-lived (single session, single page transition) and
 * stored in sessionStorage rather than localStorage so it doesn't leak
 * across tabs or persist after the browser closes.
 */

/**
 * Mirror of the server-side `NormalizedRecipe` shape. We duplicate the
 * type here rather than importing from `parseRecipe.server.ts` so
 * SvelteKit's server-only module isolation isn't broken by type-only
 * imports at build time.
 */
export interface NormalizedRecipe {
  title: string;
  summary: string;
  chefsnotes: string;
  preptime: string;
  cooktime: string;
  servings: string;
  ingredients: string[];
  directions: string[];
  tags: string[];
  imageUrls: string[];
}

export const ANON_IMPORT_HANDOFF_KEY = 'zapcooking:anon-import-handoff';

export interface AnonImportHandoff {
  recipe: NormalizedRecipe;
  sourceUrl: string;
  at: number;
}

/** Older handoffs are treated as stale and ignored. */
export const ANON_IMPORT_MAX_AGE_MS = 10 * 60 * 1000;
