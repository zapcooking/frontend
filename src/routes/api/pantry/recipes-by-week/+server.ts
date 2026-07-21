import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/**
 * Server-side proxy for the member relay's weekly new-recipe stats.
 *
 * The relay endpoint is auth-gated and expects an `Authorization: Bearer
 * <secret>` header. The secret (RELAY_API_SECRET) must never reach the
 * browser, so this route holds it server-side and passes the relay's JSON
 * straight through. Mirrors the pattern in src/routes/api/membership/+server.ts.
 */
export const GET: RequestHandler = async ({ platform }) => {
  const apiSecret = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;

  if (!apiSecret) {
    console.error(
      '[api/pantry/recipes-by-week] RELAY_API_SECRET not configured — refusing to fetch stats'
    );
    return json({ error: 'recipe stats unavailable' }, { status: 503 });
  }

  try {
    const res = await fetch('https://pantry.zap.cooking/api/stats/recipes-by-week', {
      headers: {
        Authorization: `Bearer ${apiSecret}`
      }
    });

    if (!res.ok) {
      console.error('[api/pantry/recipes-by-week] relay returned', res.status);
      return json({ error: 'recipe stats unavailable' }, { status: 502 });
    }

    const data = await res.json();
    return json(data);
  } catch (error) {
    console.error('[api/pantry/recipes-by-week] fetch failed', error);
    return json({ error: 'recipe stats unavailable' }, { status: 502 });
  }
};
