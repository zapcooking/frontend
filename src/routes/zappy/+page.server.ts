import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * `/zappy` is the legacy route for the assistant now known as Cheffy.
 * We keep it working as a permanent-feeling but method-preserving 307
 * redirect to the canonical `/cheffy` route so old bookmarks, shared
 * links, and in-app navigations don't break. The query string is
 * preserved (e.g. a `?redirect=` round-trip from /login).
 *
 * The API endpoints stay at `/api/zappy` and are NOT redirected.
 */
export const load: PageServerLoad = ({ url }) => {
  throw redirect(307, `/cheffy${url.search}`);
};
