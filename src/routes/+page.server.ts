import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
  START_SECTION_COOKIE,
  parseStartSection,
  startSectionPath
} from '$lib/startSectionConstants';

/**
 * The homepage is just a doorway to the user's start section. Redirect on the
 * server so the Worker responds before any page-component SSR render runs —
 * the previous approach SSR-rendered the whole app shell only to
 * client-redirect in onMount, and a render-time throw on this node surfaced
 * as a masked 500. A 307 keeps the method and is non-permanent.
 *
 * The destination comes from the `zapcooking_start_section` cookie, written by
 * `$lib/startSectionSettings` whenever the preference is saved or synced from
 * relays — localStorage is invisible here, the cookie is not. The default and
 * path map are imported from `startSectionConstants.ts` (dependency-free, so
 * nothing heavy lands on this hot path) — flipping
 * `DEFAULT_START_SECTION` there changes this redirect with it. This must stay
 * dynamic: prerendering would bake one visitor's choice in for everyone.
 */
export const prerender = false;

export const load: PageServerLoad = ({ cookies }) => {
  throw redirect(307, startSectionPath(parseStartSection(cookies.get(START_SECTION_COOKIE))));
};
