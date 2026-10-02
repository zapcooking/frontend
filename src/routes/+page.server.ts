import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The homepage is just a doorway to the user's start section. Redirect on the
 * server so the Worker responds before any page-component SSR render runs —
 * the previous approach SSR-rendered the whole app shell only to
 * client-redirect in onMount, and a render-time throw on this node surfaced
 * as a masked 500. A 307 keeps the method and is non-permanent.
 *
 * The destination comes from the `zapcooking_start_section` cookie, written by
 * `$lib/startSectionSettings` whenever the preference is saved or synced from
 * relays — localStorage is invisible here, the cookie is not. The mapping and
 * default below are mirrored by hand from that module (importing it would
 * pull NDK onto this hot path); its tests pin the two in sync. An absent or
 * unrecognized cookie lands on the default, which is the feed — the same
 * place the mobile apps land signed-in users. This must stay dynamic:
 * prerendering would bake one visitor's choice in for everyone.
 */
export const prerender = false;

const START_SECTION_TARGETS: Record<string, string> = {
  feed: '/feed',
  explore: '/explore',
  recipes: '/recipes'
};
const DEFAULT_TARGET = START_SECTION_TARGETS.feed;

export const load: PageServerLoad = ({ cookies }) => {
  const cookie = cookies.get('zapcooking_start_section');
  throw redirect(307, START_SECTION_TARGETS[cookie ?? ''] ?? DEFAULT_TARGET);
};
