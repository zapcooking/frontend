/**
 * Public magazine routes supply their own metadata and share the app shell.
 * Their server content is independent of visitor identity. Account and wallet
 * state are restored by the shared client runtime after hydration. HTML and
 * route data must not outlive the deploy's hashed client assets in a cache.
 */
export const LANDING_ROUTE_IDS: ReadonlySet<string> = new Set(['/explore']);

export function isLandingRoute(routeId: string | null | undefined): boolean {
	return !!routeId && LANDING_ROUTE_IDS.has(routeId);
}

/** Pathnames of the landing routes (they have no params). */
export function isLandingPath(pathname: string): boolean {
	return LANDING_ROUTE_IDS.has(pathname.replace(/\/$/, '') || '/');
}

/** Do not cache hydrated HTML/data; the public content aggregate has its own cache. */
export const LANDING_CACHE_CONTROL = 'no-store';
