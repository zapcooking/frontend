import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Server-side proxy for X/Twitter's syndication endpoint.
 *
 * cdn.syndication.twimg.com/tweet-result is the same undocumented endpoint
 * X's own widgets.js and tools like react-tweet use to render tweet embeds
 * without an API key. It only sends Access-Control-Allow-Origin for
 * platform.twitter.com, so the client can't call it directly — this fetches
 * it server-side (no CORS) and returns just the fields the embed needs.
 */

const STATUS_ID_RE =
  /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/i;

interface TwitterMeta {
  text: string;
  name: string;
  screenName: string;
  verified: boolean;
  avatarUrl: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
  media: { type: 'photo' | 'video'; url: string; posterUrl?: string; width: number; height: number } | null;
}

function extractStatusId(rawUrl: string): string | null {
  const m = rawUrl.match(STATUS_ID_RE);
  return m ? m[1] : null;
}

// The token X's own embed widget derives from the tweet id — reverse
// engineered and used by every open-source tweet-embed tool (e.g. react-tweet).
function tokenFor(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

// Strip the trailing t.co media link the API always appends to `text`, and
// swap any other t.co links for their expanded/display form.
function cleanText(text: string, entities: any): string {
  let out = text;
  for (const m of entities?.media ?? []) {
    if (m.url) out = out.split(m.url).join('').trim();
  }
  for (const u of entities?.urls ?? []) {
    if (u.url && u.expanded_url) out = out.split(u.url).join(u.expanded_url);
  }
  return out.trim();
}

export const GET: RequestHandler = async ({ url, fetch }) => {
  const target = url.searchParams.get('url') || '';
  const statusId = extractStatusId(target);
  if (!statusId) throw error(400, 'Invalid or missing tweet url');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const endpoint = `https://cdn.syndication.twimg.com/tweet-result?id=${statusId}&token=${tokenFor(statusId)}`;
    const res = await fetch(endpoint, { signal: controller.signal }).finally(() => clearTimeout(timer));

    if (!res.ok) return json({ error: true }, { headers: cacheHeaders(600) });

    const data = (await res.json()) as Record<string, any>;
    if (!data || data.__typename !== 'Tweet' || !data.user) {
      return json({ error: true }, { headers: cacheHeaders(600) });
    }

    let media: TwitterMeta['media'] = null;
    const detail = data.mediaDetails?.[0];
    if (detail?.type === 'video' && data.video) {
      // Prefer the highest-bitrate mp4 variant — HLS (.m3u8) needs a player
      // library we don't ship, plain <video> can't play it.
      const mp4s = (data.video.variants ?? []).filter((v: any) => v.type === 'video/mp4');
      const best = mp4s.sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (best) {
        media = {
          type: 'video',
          url: best.src,
          posterUrl: data.video.poster,
          width: detail.original_info?.width ?? 16,
          height: detail.original_info?.height ?? 9
        };
      }
    } else if (detail?.type === 'photo') {
      media = {
        type: 'photo',
        url: detail.media_url_https,
        width: detail.original_info?.width ?? 1,
        height: detail.original_info?.height ?? 1
      };
    }

    const meta: TwitterMeta = {
      text: cleanText(data.note_tweet?.text || data.text || '', data.entities),
      name: data.user.name || '',
      screenName: data.user.screen_name || '',
      verified: !!(data.user.is_blue_verified || data.user.verified),
      avatarUrl: data.user.profile_image_url_https || '',
      createdAt: data.created_at || '',
      likeCount: data.favorite_count ?? 0,
      replyCount: data.conversation_count ?? 0,
      media
    };

    return json(meta, { headers: cacheHeaders(60 * 60 * 24) });
  } catch {
    return json({ error: true }, { headers: cacheHeaders(600) });
  }
};

function cacheHeaders(sMaxAge: number): Record<string, string> {
  return {
    'Cache-Control': `public, max-age=60, s-maxage=${sMaxAge}, stale-while-revalidate=86400`
  };
}
