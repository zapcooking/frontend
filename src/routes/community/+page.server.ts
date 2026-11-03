/**
 * Permanent redirect from the legacy `/community` URL to `/feed`.
 *
 * The short-post Nostr feed lived at `/community` from the start, but every
 * surface users actually see has called it "Feed" for a long time — the
 * bottom nav, the side nav, and (since the start-section feature) the
 * announcement, Settings, and root-redirect copy. Renamed to match.
 *
 * Existing bookmarks, shared links, search-engine indices, and the native
 * mobile apps' hard-coded paths still point at `/community`, so this
 * server-side 301 stays indefinitely — same policy as `/recent` → `/recipes`.
 *
 * Preserves the query string (`?tab=following` and friends). URL fragments
 * (after `#`) are not available in a server load, but browsers re-attach
 * the original fragment to the redirect target client-side.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	throw redirect(301, `/feed${url.search}`);
};
