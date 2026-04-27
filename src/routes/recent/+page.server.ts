/**
 * Permanent redirect from the legacy `/recent` URL to `/recipes`.
 *
 * The page used to live at `/recent`; renamed to `/recipes` once Recipe
 * Packs landed at `/packs` and we wanted clearer naming for the recipe
 * stream. Existing bookmarks, shared links (PR #354 OG cards, blog
 * posts, etc.) and search-engine indices still point at `/recent`, so
 * we keep this server-side 301 indefinitely.
 *
 * Preserves the query string. URL fragments (the part after `#`) are
 * NOT available in a server load — browsers don't include them in
 * HTTP requests — but every major browser re-attaches the original
 * fragment to the redirect target client-side, so deep-link anchors
 * keep working without us doing anything.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	throw redirect(301, `/recipes${url.search}`);
};
