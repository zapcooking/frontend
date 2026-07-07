import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Server-side proxy for YouTube's oEmbed endpoint.
 *
 * YouTube's own og:description is the full video description, not the
 * channel name, and the oEmbed endpoint sends no Access-Control-Allow-Origin
 * header — so the client can't call it directly. This fetches it server-side
 * (no CORS) and returns just the two fields the inline embed caption needs.
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const GET: RequestHandler = async ({ url, fetch }) => {
  const videoId = url.searchParams.get('v') || '';
  if (!VIDEO_ID_RE.test(videoId)) throw error(400, 'Invalid video id');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const target = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;

    const res = await fetch(target, { signal: controller.signal }).finally(() =>
      clearTimeout(timer)
    );

    if (!res.ok) return json({ error: true }, { headers: cacheHeaders(600) });

    const data = (await res.json()) as { title?: string; author_name?: string };
    if (!data.title) return json({ error: true }, { headers: cacheHeaders(600) });

    return json(
      { title: data.title, authorName: data.author_name || '' },
      { headers: cacheHeaders(60 * 60 * 24 * 7) }
    );
  } catch {
    return json({ error: true }, { headers: cacheHeaders(600) });
  }
};

function cacheHeaders(sMaxAge: number): Record<string, string> {
  return {
    'Cache-Control': `public, max-age=60, s-maxage=${sMaxAge}, stale-while-revalidate=86400`
  };
}
