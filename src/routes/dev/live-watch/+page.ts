/**
 * Viewer gate tool for the Go live play relay (PR 1.3). TEMPORARY: the
 * watch page in PR 3 replaces it, and that PR deletes this route.
 *
 * It holds no secret, it only works on
 * preview deployments (*.pages.dev) and local dev, and on any other
 * hostname, production included, it redirects to the home page.
 */
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { isGateHost } from '$lib/live/gateHost';
import type { PageLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: PageLoad = ({ url }) => {
  if (browser && !isGateHost(url.hostname)) {
    throw redirect(307, '/');
  }
  return {};
};
