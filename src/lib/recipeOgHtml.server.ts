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

/**
 * Crawler / link-unfurl User-Agents. Matched case-insensitively. Kept broad on
 * purpose: a false positive only means a bot-style minimal document is served
 * to a non-bot, which still renders fine; a false negative means a missing card.
 */
const CRAWLER_UA =
  /(facebookexternalhit|facebookcatalog|Facebot|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|Discordbot|TelegramBot|WhatsApp|Pinterest|redditbot|Googlebot|Google-InspectionTool|bingbot|Applebot|Embedly|Quora Link Preview|vkShare|W3C_Validator|outbrain|SkypeUriPreview|nuzzel|Bitlybot|Yahoo|Baiduspider|ia_archiver|MetaInspector|Iframely|SummalyBot|TelegramBot|Mastodon|Pleroma|Snapchat|Yeti)/i;

/** Only these route prefixes get bot OG injection. */
const ROUTE_RE = /^\/(recipe|r)\/([^/]+)\/?$/;

export function isCrawler(userAgent: string | null): boolean {
  return !!userAgent && CRAWLER_UA.test(userAgent);
}

export function matchRecipeOgRoute(pathname: string): { prefix: string; slug: string } | null {
  const m = pathname.match(ROUTE_RE);
  if (!m) return null;
  let slug = m[2];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* keep raw on malformed escape */
  }
  return { prefix: m[1], slug };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

function renderDocument(meta: RecipeOgMeta, canonicalUrl: string): string {
  const url = escapeAttr(canonicalUrl);
  const title = escapeAttr(meta.ogTitle);
  const desc = escapeAttr(meta.description);
  const image = escapeAttr(meta.image);
  const pageTitle = escapeAttr(meta.pageTitle);

  const lines = [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8" />',
    `<title>${pageTitle}</title>`,
    `<meta name="description" content="${desc}" />`,
    `<link rel="canonical" href="${url}" />`,
    '<meta property="og:type" content="article" />',
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    '<meta property="og:site_name" content="zap.cooking" />'
  ];

  if (meta.publishedAt !== null) {
    const iso = escapeAttr(new Date(meta.publishedAt * 1000).toISOString());
    lines.push(`<meta property="article:published_time" content="${iso}" />`);
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
    `<meta name="twitter:image" content="${image}" />`,
    '</head><body></body></html>'
  );

  return lines.join('\n');
}

/**
 * Build the standalone crawler document for a matched recipe route. NEVER
 * throws and never hangs: on any failure or relay timeout it emits safe
 * fallback meta so the bot still gets a valid 200 card.
 */
export async function renderRecipeOgForCrawler(
  prefix: string,
  slug: string,
  origin: string
): Promise<string> {
  const canonicalUrl = `${origin}/${prefix}/${slug}`;
  let meta: RecipeOgMeta = FALLBACK_RECIPE_OG;
  try {
    const event = await fetchRecipeEventForOg(slug);
    if (event) meta = getRecipeOgMeta(event);
  } catch {
    /* keep fallback meta */
  }
  return renderDocument(meta, canonicalUrl);
}
