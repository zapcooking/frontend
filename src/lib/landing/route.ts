/**
 * Public magazine routes supply their own metadata and share the app shell.
 * Their server content is independent of visitor identity; hooks skip CORS so
 * the edge cache holds one response for everyone. Account and wallet state
 * are restored by the shared client runtime after hydration.
 */
export const LANDING_ROUTE_IDS: ReadonlySet<string> = new Set(['/explore']);

export function isLandingRoute(routeId: string | null | undefined): boolean {
	return !!routeId && LANDING_ROUTE_IDS.has(routeId);
}

/** Pathnames of the landing routes (they have no params). */
export function isLandingPath(pathname: string): boolean {
	return LANDING_ROUTE_IDS.has(pathname.replace(/\/$/, '') || '/');
}

/** Browser 1 min; edge 3 min (the adapter stores it in caches.default). */
export const LANDING_CACHE_CONTROL = 'public, max-age=60, s-maxage=180';
