/**
 * Permanent redirect from the legacy `/recent` URL to `/recipes`.
 *
 * The page used to live at `/recent`; renamed to `/recipes` once Recipe
 * Packs landed at `/packs` and we wanted clearer naming for the recipe
 * stream. Existing bookmarks, shared links (PR #354 OG cards, blog
 * posts, etc.) and search-engine indices still point at `/recent`, so
 * we keep this server-side 301 indefinitely. SvelteKit will preserve
 * the query string and any hash on the redirect.
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	throw redirect(301, `/recipes${url.search}${url.hash}`);
};
