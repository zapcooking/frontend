import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { START_SECTION_COOKIE, rootRedirectPath } from '$lib/startSectionConstants';

/**
 * The homepage is just a doorway. Redirect on the server so the Worker
 * responds before any page-component SSR render runs — the previous approach
 * SSR-rendered the whole app shell only to client-redirect in onMount, and a
 * render-time throw on this node surfaced as a masked 500. A 307 keeps the
 * method and is non-permanent.
 *
 * Members go to their start section, from the `zapcooking_start_section`
 * cookie that `$lib/startSectionSettings` writes at sign-in and whenever the
 * preference is saved or synced from relays (localStorage is invisible here,
 * the cookie is not). Visitors have no cookie — it is cleared on explicit
 * logout — and go to the public landing page (VISITOR_START_SECTION). The
 * mapping lives in `startSectionConstants.ts` (dependency-free, so nothing
 * heavy lands on this hot path). This must stay dynamic: prerendering would
 * bake one visitor's choice in for everyone.
 */
export const prerender = false;

export const load: PageServerLoad = ({ cookies }) => {
  throw redirect(307, rootRedirectPath(cookies.get(START_SECTION_COOKIE)));
};
