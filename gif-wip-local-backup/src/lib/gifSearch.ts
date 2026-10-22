/**
 * GIF search against gifs.nostr.build, nostr.build's GIF index.
 *
 * Ported from Sidecar's composer (the reference implementation of this
 * feature). Requests go through this app's server proxy (`/api/gif-search`,
 * `/api/gif-suggest`), which holds the API key — the gifs.nostr.build guide
 * reserves Authorization headers for server/native clients, never browsers.
 *
 * Every result is already hosted on a Nostr media host (image.nostr.build),
 * so picking a GIF attaches its URL and nothing is uploaded. The URL goes
 * into a published note, so results that cannot be published as-is (http
 * links, mp4 renditions, unknown shapes) are dropped rather than shown.
 */

export const GIF_SEARCH_PATH = '/api/gif-search';
export const GIF_SUGGEST_PATH = '/api/gif-suggest';

export const GIF_PAGE_SIZE = 24;
// A query's list is at most 200 long, and the API rejects an offset past 199.
export const GIF_LAST_OFFSET = 199;
export const GIF_QUERY_MAX = 500;
export const GIF_SUGGEST_LIMIT = 6;
// The grid packs columns about this wide, two to five, shortest column first.
export const GIF_COL_WIDTH = 170;

// There is no trending list to open on, so the picker opens on topic chips —
// search terms, not interface text: they are what the index is tagged with.
export const GIF_TOPICS = ['gm', 'gn', 'pv', 'zap', 'bitcoin', 'coffee', 'lfg', 'wow'];

// The chips in the order the picker offers them: gm first through the day,
// gn first in the evening and overnight, by the device's own clock. Nothing
// is searched until one is tapped, so the clock only decides which comes first.
export function gifTopicsFor(now: Date = new Date()): string[] {
  const hour = now.getHours();
  const first = hour >= 4 && hour < 18 ? 'gm' : 'gn';
  return [first, ...GIF_TOPICS.filter((t) => t !== first)];
}

export interface Gif {
  url: string;
  preview: string;
  width: number;
  height: number;
  title: string;
}

export interface GifPage {
  gifs: Gif[];
  next: number | null;
}

function clipQuery(query: unknown): string {
  return String(query || '')
    .trim()
    .slice(0, GIF_QUERY_MAX);
}

// safe=1 is the API's default, spelled out: adult GIFs stay out of a picker
// anyone can open.
export function gifSearchUrl(query: string, offset = 0): string {
  const params = new URLSearchParams({
    q: clipQuery(query),
    limit: String(GIF_PAGE_SIZE),
    offset: String(offset || 0),
    safe: '1'
  });
  return `${GIF_SEARCH_PATH}?${params}`;
}

export function gifSuggestUrl(query: string): string {
  const params = new URLSearchParams({
    q: clipQuery(query),
    limit: String(GIF_SUGGEST_LIMIT),
    safe: '1'
  });
  return `${GIF_SUGGEST_PATH}?${params}`;
}

const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/\S+$/.test(u);

const GIF_FORMATS = new Set(['gif', 'webp']);

interface GifItemPreviews {
  animated?: unknown;
  still?: unknown;
}

// One result, or null when it cannot be shown and posted as it is. The URL
// goes into a published note, so it has to be an https link in one of the two
// formats the index serves. The grid shows the w240 preview, the size the API
// documents for column grids, animated when it can be and its first frame
// when the GIF is too big to animate.
export function gifFromItem(item: unknown): Gif | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as Record<string, unknown>;
  if (!isHttps(it.url) || typeof it.format !== 'string' || !GIF_FORMATS.has(it.format)) {
    return null;
  }
  const previews = it.previews as Record<string, GifItemPreviews> | null | undefined;
  const pv = previews ? previews.w240 || previews.medium : undefined;
  const preview = pv ? [pv.animated, pv.still].find(isHttps) : undefined;
  const width = Number(it.width);
  const height = Number(it.height);
  if (!preview || !(width > 0) || !(height > 0)) return null;
  return {
    url: it.url,
    preview,
    width,
    height,
    title: typeof it.title === 'string' ? it.title.trim() : ''
  };
}

// A page of results, and the offset of the next page or null at the end.
// `count` is the length of the query's whole list — and the offset counts
// every item the API sent, shown or not, or the next page repeats one — so
// paging stops at count or at the API's last offset, whichever comes first.
export function parseGifPage(body: unknown): GifPage {
  const items =
    body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).items)
      ? ((body as Record<string, unknown>).items as unknown[])
      : [];
  const offset = Number(body && (body as Record<string, unknown>).offset) || 0;
  const count = Number(body && (body as Record<string, unknown>).count) || 0;
  const gifs = items.map(gifFromItem).filter((g): g is Gif => g !== null);
  const next = offset + items.length;
  return {
    gifs,
    next: items.length && next < count && next <= GIF_LAST_OFFSET ? next : null
  };
}

export function parseGifSuggestions(body: unknown): string[] {
  const terms =
    body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).terms)
      ? ((body as Record<string, unknown>).terms as unknown[])
      : [];
  const out: string[] = [];
  for (const entry of terms) {
    const term =
      entry &&
      typeof entry === 'object' &&
      typeof (entry as Record<string, unknown>).term === 'string'
        ? ((entry as Record<string, unknown>).term as string).trim()
        : '';
    if (term && !out.includes(term)) out.push(term);
  }
  return out.slice(0, GIF_SUGGEST_LIMIT);
}

// What the picker says when a request fails. 401 and 403 are the API refusing
// the key and 503 is search being down or unconfigured — nothing anyone at
// the keyboard can fix, so it says so rather than suggesting a retry.
export function gifErrorMessage(status: number): string {
  if (status === 401 || status === 403 || status === 503) {
    return 'GIF search isn’t available right now.';
  }
  if (status === 429) return 'Too many searches. Try again in a minute.';
  return 'Couldn’t load GIFs. Check your connection and try again.';
}

// No cookies and no referrer: the query is all the proxy needs to answer it.
export async function gifRequest(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response | undefined;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal
    });
    if (!res.ok) throw new Error(gifErrorMessage(res.status));
    return await res.json();
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    throw new Error(res && !res.ok ? gifErrorMessage(res.status) : gifErrorMessage(0));
  }
}
