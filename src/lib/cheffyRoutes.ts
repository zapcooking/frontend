/**
 * Route eligibility for the persistent Cheffy messenger.
 *
 * The floating messenger is hidden on the full Cheffy page (redundant),
 * the chrome-less messaging surfaces, and auth flows. The root layout uses
 * this both to gate rendering (`showCheffy`) and to decide whether opening
 * Cheffy should fetch the messenger chunk at all.
 */

import { derived, type Readable } from 'svelte/store';

export const CHEFFY_EXCLUDED_PREFIXES = [
  '/messages',
  '/groups',
  '/cheffy',
  '/zappy',
  '/login',
  '/onboarding'
] as const;

/** True when the floating messenger may render on this pathname. */
export function isCheffyRoute(pathname: string): boolean {
  return !CHEFFY_EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * The messenger is wanted only while Cheffy is open on an eligible route.
 * Drives the lazy loader's request/release, so opening Cheffy on an
 * excluded route never starts an import and navigating to one releases a
 * pending request.
 */
export function cheffyMessengerWanted(
  pathname: Readable<string>,
  open: Readable<boolean>
): Readable<boolean> {
  return derived([pathname, open], ([$pathname, $open]) => $open && isCheffyRoute($pathname));
}
