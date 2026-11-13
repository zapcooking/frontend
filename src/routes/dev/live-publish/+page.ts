/**
 * Phone-gate tool for the Go live publish relay (PR 1.2). TEMPORARY: the
 * host page in PR 2 replaces it, and that PR deletes this route.
 *
 * It exists so the publish relay can be exercised from a real phone
 * before there is a host page. It holds no secret and can do nothing
 * without a valid host token for a session that an allowlisted host
 * created with a signed request.
 *
 * It only works on preview deployments (*.pages.dev) and local dev. On
 * any other hostname, production included, it redirects to the home page.
 * The other pages under /dev gate on import.meta.env.PROD, which is also
 * true for preview builds, so this one gates on the hostname instead.
 */
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import type { PageLoad } from './$types';

export const ssr = false;
export const prerender = false;

export function isGateHost(hostname: string): boolean {
  return hostname.endsWith('.pages.dev') || hostname === 'localhost' || hostname === '127.0.0.1';
}

export const load: PageLoad = ({ url }) => {
  if (browser && !isGateHost(url.hostname)) {
    throw redirect(307, '/');
  }
  return {};
};
