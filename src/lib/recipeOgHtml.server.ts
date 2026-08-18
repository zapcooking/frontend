/**
 * Server-only: detect social crawlers and render a minimal standalone OG
 * document for recipe routes.
 *
 * WHY this exists (read before touching): recipe OG/Twitter tags are derived
 * reactively from a Nostr event fetched ONLY client-side, so crawlers — which
 * don't run JS — see placeholder defaults. The fix #454 deliberately removed
 * `+page.server.ts` from these routes because a server `data` dependency made
 * the client request `__data.json`, which 500'd against an OOM'd worker. So we
 * must NOT reintroduce any server load. Instead the `handle` hook returns this
 * tiny document for crawler User-Agents only — crawlers issue a single document
 * GET, never request `__data.json`, and never touch the service worker, so this
 * path cannot reintroduce the #454 mechanism. Human requests fall through to the
 * unchanged client SPA.
 *
 * Option (a) from the brief: build a minimal standalone HTML head rather than
 * transforming the full SSR page — lightest, lowest memory, given the OOM
 * history.
 */

import { getRecipeOgMeta, FALLBACK_RECIPE_OG, type RecipeOgMeta } from './recipeOgMeta';
import { fetchRecipeEventForOg } from './recipeOg.server';
import { fetchNoteForOg, getNoteOgMeta, FALLBACK_NOTE_OG } from './noteOg.server';
import { fetchProfileOgMeta, FALLBACK_PROFILE_OG } from './profileOg.server';
import { probeImageDimensions } from './imageDimensions.server';

/**
 * Crawler / link-unfurl User-Agents. Matched case-insensitively.
 *
 * A false positive is NOT harmless: a real human matched here would get the
 * empty-body crawler document instead of the SPA, breaking the page for them.
 * So tokens that also appear in human in-app browser UAs are matched only in
 * their dedicated-crawler form, never as a bare word:
 *   - `WhatsApp/<n>`  — the link-preview fetcher; the WhatsApp in-app webview
 *     carries a normal `Mozilla/…` UA and must fall through to the SPA.
 *   - `Pinterest/<n>` / `Pinterestbot` — likewise (bare "Pinterest" appears in
 *     the Pinterest in-app browser).
 *   - `Bluesky Cardyb` — Bluesky's link-card fetcher (`Bluesky Cardyb/1.1`).
 *     Matched as the two-word form, never bare "Bluesky": the Bluesky mobile
 *     app's in-app browser carries a normal `Mozilla/…` UA, but the app name
 *     is exactly the kind of token that shows up in one. The version suffix is
 *     deliberately NOT required, so a future `Cardyb/2.x` still matches.
 * Snapchat and bare "Yahoo" are intentionally omitted: their in-app browsers
 * carry those words and neither is a recipe link-unfurler worth the risk.
 */
const CRAWLER_UA =
  /(facebookexternalhit|facebookcatalog|Facebot|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|Discordbot|TelegramBot|WhatsApp\/\d|Pinterest\/\d|Pinterestbot|Bluesky Cardyb|redditbot|Googlebot|Google-InspectionTool|bingbot|Applebot|Embedly|Quora Link Preview|vkShare|W3C_Validator|outbrain|SkypeUriPreview|nuzzel|Bitlybot|Baiduspider|ia_archiver|MetaInspector|Iframely|SummalyBot|Mastodon|Pleroma|Yeti)/i;

/** Only these route prefixes get bot OG injection. */
const ROUTE_RE = /^\/(recipe|r)\/([^/]+)\/?$/;

export function isCrawler(userAgent: string | null): boolean {
  return !!userAgent && CRAWLER_UA.test(userAgent);
}

export function matchRecipeOgRoute(pathname: string): { prefix: string; slug: string } | null {
  const m = pathname.match(ROUTE_RE);
  if (!m) return null;
  // Use the raw, still-encoded path segment. naddr1…/hex slugs are URL-safe so
  // there is nothing to decode, and decoding could fold in a space or a '%2F'
  // → '/' that corrupts the canonical/og:url or makes it mismatch the request.
  // nip19.decode() and the hex test in recipeOg.server.ts both accept it as-is.
  return { prefix: m[1], slug: m[2] };
}

/** Top-level note routes (`/note1…`, `/nevent1…`) get bot OG injection too. */
const NOTE_ROUTE_RE = /^\/((?:note1|nevent1)[0-9a-z]+)\/?$/i;

export function matchNoteOgRoute(pathname: string): { slug: string } | null {
  const m = pathname.match(NOTE_ROUTE_RE);
  if (!m) return null;
  return { slug: m[1] };
}

/** Long-form article routes (`/reads/naddr1…`). */
const READS_ROUTE_RE = /^\/reads\/([^/]+)\/?$/;

export function matchReadsOgRoute(pathname: string): { slug: string } | null {
  const m = pathname.match(READS_ROUTE_RE);
  if (!m) return null;
  return { slug: m[1] };
}

/** Profile routes: `/npub1…`, `/nprofile1…`, and `/user/npub1…`. */
const PROFILE_ROUTE_RE = /^\/(?:user\/)?((?:npub1|nprofile1)[0-9a-z]+)\/?$/i;

export function matchProfileOgRoute(pathname: string): { slug: string } | null {
  const m = pathname.match(PROFILE_ROUTE_RE);
  if (!m) return null;
  return { slug: m[1] };
}

/** Generic article card when a `/reads/` event can't be resolved. */
const FALLBACK_ARTICLE_OG: RecipeOgMeta = {
  pageTitle: 'Article - zap.cooking',
  ogTitle: 'An article on Zap Cooking',
  description: 'A long-form article shared on zap.cooking - Food is Open Source',
  image: 'https://zap.cooking/social-share.png',
  publishedAt: null,
  authorPubkey: null
};

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

// The static fallback graphic never changes — hardcode its known dimensions
// (verified via `sips`) rather than fetching it on every fallback render.
const STATIC_FALLBACK_DIMENSIONS: Record<string, { width: number; height: number; mime: string }> =
  {
    'https://zap.cooking/social-share.png': { width: 1200, height: 675, mime: 'image/png' }
  };

/**
 * Build the head tags for a card: `<title>`, description, canonical, and the
 * og:/twitter: set.
 *
 * Separated from the document wrapper so the SAME tags can be injected into
 * the real SSR page for every visitor, rather than only into a standalone
 * crawler document. Serving one document to everyone is the whole point —
 * see the head-injection comment in hooks.server.ts.
 */
export async function buildOgTagBlock(meta: RecipeOgMeta, canonicalUrl: string): Promise<string> {
  const url = escapeAttr(canonicalUrl);
  const title = escapeAttr(meta.ogTitle);
  const desc = escapeAttr(meta.description);
  const image = escapeAttr(meta.image);
  const pageTitle = escapeAttr(meta.pageTitle);

  const lines = [
    `<title>${pageTitle}</title>`,
    `<meta name="description" content="${desc}" />`,
    `<link rel="canonical" href="${url}" />`,
    '<meta property="og:type" content="article" />',
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`
  ];

  // Facebook/LinkedIn are known to silently drop the image from the preview
  // card when width/height aren't supplied, even though the URL itself is
  // valid and reachable — see docs/plans/og-missing-images-fix.md. Best
  // effort: a fetch/parse failure just omits these tags (today's behavior),
  // never blocks the rest of the card.
  const dims = STATIC_FALLBACK_DIMENSIONS[meta.image] ?? (await probeImageDimensions(meta.image));
  if (dims) {
    lines.push(
      `<meta property="og:image:width" content="${dims.width}" />`,
      `<meta property="og:image:height" content="${dims.height}" />`,
      `<meta property="og:image:type" content="${dims.mime}" />`
    );
  }

  lines.push('<meta property="og:site_name" content="zap.cooking" />');

  if (meta.publishedAt !== null) {
    // `created_at` comes off a relay event, so it can be anything — and
    // Date#toISOString THROWS a RangeError outside ±8.64e15 ms rather than
    // returning something useless. One nonsense timestamp would otherwise
    // take down the whole page render. Skip the tag instead.
    const ms = meta.publishedAt * 1000;
    if (Number.isFinite(ms) && Math.abs(ms) <= 8.64e15) {
      lines.push(
        `<meta property="article:published_time" content="${escapeAttr(new Date(ms).toISOString())}" />`
      );
    }
  }
  if (meta.authorPubkey) {
    lines.push(
      `<meta property="article:author" content="${escapeAttr(`https://zap.cooking/p/${meta.authorPubkey}`)}" />`
    );
  }

  lines.push(
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:site" content="@zapcooking" />',
    `<meta name="twitter:url" content="${url}" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${desc}" />`,
    `<meta name="twitter:image" content="${image}" />`
  );

  return lines.join('\n');
}

/**
 * Resolve OG meta for a matched recipe route. NEVER
 * throws and never hangs: on any failure or relay timeout it emits safe
 * fallback meta so the bot still gets a valid 200 card.
 */
export async function resolveRecipeOgMeta(slug: string): Promise<RecipeOgMeta> {
  let meta: RecipeOgMeta = FALLBACK_RECIPE_OG;
  try {
    const event = await fetchRecipeEventForOg(slug);
    if (event) meta = getRecipeOgMeta(event);
  } catch {
    /* keep fallback meta */
  }
  return meta;
}

/**
 * Resolve OG meta for a matched note route. Never throws
 * and never hangs: on any failure or relay timeout it emits a safe generic
 * note card so the bot still gets a valid 200.
 */
export async function resolveNoteOgMeta(slug: string): Promise<RecipeOgMeta> {
  let meta: RecipeOgMeta = FALLBACK_NOTE_OG;
  try {
    const data = await fetchNoteForOg(slug);
    if (data) meta = getNoteOgMeta(data);
  } catch {
    /* keep fallback meta */
  }
  return meta;
}

/**
 * Resolve OG meta for a `/reads/naddr…` article. Reuses
 * the recipe resolver/derivation (both are kind:30023 with title/summary/image
 * tags), with a generic article fallback. Never throws or hangs.
 */
export async function resolveReadsOgMeta(slug: string): Promise<RecipeOgMeta> {
  let meta: RecipeOgMeta = FALLBACK_ARTICLE_OG;
  try {
    const event = await fetchRecipeEventForOg(slug);
    if (event) meta = getRecipeOgMeta(event);
  } catch {
    /* keep fallback meta */
  }
  return meta;
}

/**
 * Resolve OG meta for a profile route (`/npub1…`, `/nprofile1…`,
 * `/user/npub1…`). Never throws or hangs.
 */
export async function resolveProfileOgMeta(slug: string): Promise<RecipeOgMeta> {
  let meta: RecipeOgMeta = FALLBACK_PROFILE_OG;
  try {
    const resolved = await fetchProfileOgMeta(slug);
    if (resolved) meta = resolved;
  } catch {
    /* keep fallback meta */
  }
  return meta;
}

/**
 * Tags the SSR page emits from its own `<svelte:head>` that we replace.
 *
 * The page derives these from a CLIENT-fetched event, so during SSR they are
 * static placeholders ("Recipe", the logo graphic). They must be removed
 * rather than merely preceded: the layout already documents that when two
 * sets are present scrapers pick one arbitrarily, and shipping both is how
 * cards ended up generic in the first place.
 */
const PAGE_HEAD_TAGS_RE =
  /[\t ]*<(?:title>[\s\S]*?<\/title>|meta\s+(?:property="og:[^"]*"|name="(?:twitter:[^"]*|description)")[^>]*>|link\s+rel="canonical"[^>]*>)\n?/g;

/**
 * Replace the SSR page's placeholder head tags with resolved ones.
 *
 * Operates only on the `<head>` region so a stray `<title>` in body content
 * (e.g. inside an inlined SVG) can't be clobbered. Returns the html unchanged
 * if there's no head to work with, so a shape change upstream degrades to
 * today's behavior instead of mangling the document.
 */
export function injectOgTags(html: string, tagBlock: string): string {
  const headStart = html.indexOf('<head>');
  const headEnd = html.indexOf('</head>');
  if (headStart === -1 || headEnd === -1 || headEnd < headStart) return html;

  const openTagEnd = headStart + '<head>'.length;
  const head = html.slice(openTagEnd, headEnd);
  const cleaned = head.replace(PAGE_HEAD_TAGS_RE, '');

  return `${html.slice(0, openTagEnd)}\n${tagBlock}\n${cleaned}${html.slice(headEnd)}`;
}
