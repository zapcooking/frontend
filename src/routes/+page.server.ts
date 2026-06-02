import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The homepage is just a doorway to /explore. Redirect on the server so the
 * Worker responds before any page-component SSR render runs — the previous
 * approach SSR-rendered the whole app shell only to client-redirect in
 * onMount, and a render-time throw on this node surfaced as a masked 500.
 * A 307 keeps the method and is non-permanent (so the root can change later).
 */
export const load: PageServerLoad = () => {
  throw redirect(307, '/explore');
};
