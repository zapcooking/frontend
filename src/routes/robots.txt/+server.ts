import type { RequestHandler } from './$types';
import { buildRobotsTxt } from '$lib/sitemap';

// A static file at build time: served from the asset layer, never the Worker.
export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(buildRobotsTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
