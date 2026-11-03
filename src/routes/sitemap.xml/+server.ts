import type { RequestHandler } from './$types';
import { buildSitemapXml } from '$lib/sitemap';

// A static file at build time: served from the asset layer, never the Worker.
export const prerender = true;

export const GET: RequestHandler = () =>
	new Response(buildSitemapXml(), { headers: { 'content-type': 'application/xml; charset=utf-8' } });
