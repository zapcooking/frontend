/**
 * Routes rendered as the chrome-less, no-JS landing page (`csr = false`):
 * the root layout renders only the page for these, hooks skip CORS so the
 * edge cache holds one response for everyone. /explore joins at cutover.
 */
export const LANDING_ROUTE_IDS: ReadonlySet<string> = new Set(['/explore/next']);

export function isLandingRoute(routeId: string | null | undefined): boolean {
	return !!routeId && LANDING_ROUTE_IDS.has(routeId);
}

/** Pathnames of the landing routes (they have no params). */
export function isLandingPath(pathname: string): boolean {
	return LANDING_ROUTE_IDS.has(pathname.replace(/\/$/, '') || '/');
}

/** Browser 1 min; edge 3 min (the adapter stores it in caches.default). */
export const LANDING_CACHE_CONTROL = 'public, max-age=60, s-maxage=180';

const FONT_PRELOAD = /<link[^>]*rel="preload"[^>]*\.woff2"[^>]*>\s*/g;

/**
 * Landing pages set their text in the system font stack, so app.html's
 * web-font preload would only compete with the hero image for bandwidth.
 */
export function stripFontPreload(html: string): string {
	return html.replace(FONT_PRELOAD, '');
}
