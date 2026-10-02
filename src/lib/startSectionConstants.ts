/**
 * Start-section constants shared by the client settings service and the
 * `/` server redirect.
 *
 * Server-safe on purpose — no NDK, no `$app/environment`, no stores — so
 * `src/routes/+page.server.ts` can import the exact same default, path
 * map, and cookie name the client persists, instead of hand-copying them
 * (a copied default silently drifts the first time someone flips
 * `DEFAULT_START_SECTION`).
 *
 * `startSectionSettings.ts` re-exports everything here; import from there
 * in client code, and from here only where the import graph must stay
 * dependency-free (server hot paths, vitest).
 */

export type StartSection = 'feed' | 'explore' | 'recipes';

export const DEFAULT_START_SECTION: StartSection = 'feed';

export const START_SECTION_PATHS: Record<StartSection, string> = {
  feed: '/feed',
  explore: '/explore',
  recipes: '/recipes'
};

/** Written by the settings service; read by the `/` server load. */
export const START_SECTION_COOKIE = 'zapcooking_start_section';

/** The three known values, or null — for callers that must distinguish
 * "no usable value" from "fall back to the default" (relay payloads). */
export function knownStartSection(raw: unknown): StartSection | null {
  return raw === 'feed' || raw === 'explore' || raw === 'recipes' ? raw : null;
}

/**
 * Map an untrusted value (localStorage, cookie, relay event) to a section.
 * Anything we never wrote — missing key, corrupt value, a future value from
 * a newer client — falls back to the default rather than being coerced.
 */
export function parseStartSection(raw: string | null | undefined): StartSection {
  return knownStartSection(raw) ?? DEFAULT_START_SECTION;
}

export function startSectionPath(section: StartSection): string {
  return START_SECTION_PATHS[section];
}
