/**
 * Single source of truth for recipe Open Graph / Twitter-card metadata.
 *
 * The same title/description/image derivation must run in TWO places that
 * cannot be allowed to drift:
 *   1. the client `<svelte:head>` in `recipe/[slug]` and `r/[naddr]`, fed an
 *      NDKEvent fetched in-browser;
 *   2. the server `handle` hook (`src/hooks.server.ts`), fed a raw relay event
 *      JSON for crawler User-Agents only.
 *
 * Both call `getRecipeOgMeta()` with a plain `{ tags, content, ... }` shape, so
 * an NDKEvent and a raw relay event are both accepted structurally. Keep this
 * file free of NDK / SvelteKit imports so it is safe to pull into the worker
 * bundle (bundle OOM was the original disease behind the #454 500s).
 */

export interface OgEventLike {
  tags: string[][];
  content: string;
  pubkey?: string;
  created_at?: number;
  kind?: number;
}

export interface RecipeOgMeta {
  /** For the document `<title>` — e.g. "Pancakes - zap.cooking". */
  pageTitle: string;
  /** og:title / twitter:title — raw title, no site suffix. */
  ogTitle: string;
  /** description / og:description / twitter:description, capped at ~155 chars. */
  description: string;
  /** og:image / twitter:image — always an absolute raster URL. */
  image: string;
  /** Unix seconds for article:published_time, or null. */
  publishedAt: number | null;
  /** Author hex pubkey for article:author, or null. */
  authorPubkey: string | null;
}

const FALLBACK_IMAGE = 'https://zap.cooking/social-share.png';

/**
 * Emitted when no event is available (loading, not found, relay timeout, or a
 * crawler request that couldn't resolve in time). Mirrors the static defaults
 * the client `<svelte:head>` renders before its NDK fetch settles, so a bot
 * always receives a valid card.
 */
export const FALLBACK_RECIPE_OG: RecipeOgMeta = {
  pageTitle: 'Recipe - zap.cooking',
  ogTitle: 'Recipe',
  description: 'A recipe shared on zap.cooking - Food. Friends. Freedom.',
  image: FALLBACK_IMAGE,
  publishedAt: null,
  authorPubkey: null
};

function findTag(event: OgEventLike, name: string): string | undefined {
  return event.tags?.find((tag) => tag[0] === name)?.[1];
}

/**
 * Cap a description at ~155 chars for Facebook/social previews, preferring a
 * sentence boundary, then a word boundary, before hard-truncating with an
 * ellipsis. Ported verbatim from the original reactive `og_desc` block.
 */
export function capRecipeDescription(d: string): string {
  if (!d || d.length <= 155) return d;
  const t = d.slice(0, 155);
  const ls = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'));
  if (ls > 80) return d.slice(0, ls + 1);
  const sp = t.lastIndexOf(' ');
  return (sp > 80 ? t.slice(0, sp) : t) + '...';
}

/**
 * Build the long-form description: summary tag → structured recipe metadata
 * (servings / timing / ingredients) → cleaned content → static fallback.
 * Ported verbatim from the original reactive `og_description` block.
 */
function deriveLongDescription(event: OgEventLike): string {
  const summary = findTag(event, 'summary');
  if (summary) return summary;

  if (event.content) {
    const title = findTag(event, 'title') || '';
    const parts: string[] = [];

    const servingsMatch = event.content.match(/##\s*Servings\s*\n+([^\n#]+)/i);
    if (servingsMatch) {
      const servings = servingsMatch[1].trim();
      if (servings) parts.push(servings);
    }

    const totalMatch = event.content.match(/Total:\s*([^\n,]+)/i);
    const prepMatch = event.content.match(/Prep:\s*([^\n,]+)/i);
    const cookMatch = event.content.match(/Cook:\s*([^\n,]+)/i);
    if (totalMatch) {
      parts.push(`Ready in ${totalMatch[1].trim()}`);
    } else if (prepMatch && cookMatch) {
      parts.push(`Prep: ${prepMatch[1].trim()}, Cook: ${cookMatch[1].trim()}`);
    }

    const ingredientsSection = event.content.match(/##\s*Ingredients\s*\n([\s\S]*?)(?=##|$)/i);
    if (ingredientsSection) {
      const ingredients = ingredientsSection[1]
        .split('\n')
        .filter((line: string) => line.trim().startsWith('-') || line.trim().startsWith('*'))
        .map((line: string) =>
          line
            .replace(/^[\s*-]+/, '')
            .replace(/\s*\(.*?\)\s*/g, '')
            .trim()
        )
        .filter((i: string) => i.length > 0 && i.length < 80);

      if (ingredients.length > 0) {
        const preview = ingredients.slice(0, 3).join(', ');
        if (ingredients.length > 3) {
          parts.push(`${ingredients.length} ingredients including ${preview}`);
        } else {
          parts.push(`Made with ${preview}`);
        }
      }
    }

    if (parts.length > 0) {
      return title ? `${title}. ${parts.join('. ')}.` : parts.join('. ') + '.';
    }

    // Fall back to cleaned content extraction
    const text = event.content
      .replace(/^#+\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n+/g, ' ')
      .trim();

    if (text.length > 155) {
      const truncated = text.slice(0, 155);
      const lastSpace = truncated.lastIndexOf(' ');
      const lastSentence = Math.max(
        truncated.lastIndexOf('.'),
        truncated.lastIndexOf('!'),
        truncated.lastIndexOf('?')
      );
      if (lastSentence > 80) return text.slice(0, lastSentence + 1);
      return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + '...';
    }
    return text || 'A delicious recipe shared on zap.cooking';
  }
  return 'A delicious recipe shared on zap.cooking';
}

/**
 * Derive the full set of recipe OG metadata from an event (or the static
 * fallback when `event` is null). The single function both the client head and
 * the server crawler hook call.
 */
export function getRecipeOgMeta(event: OgEventLike | null): RecipeOgMeta {
  if (!event) return FALLBACK_RECIPE_OG;

  const titleTag = findTag(event, 'title');
  const dTag = findTag(event, 'd');
  const content = event.content ?? '';

  // <title> heading: title → d → '...'
  const pageHeading = titleTag || dTag || '...';
  // og:title: title → first 60 chars of content
  const ogTitle = titleTag || content.slice(0, 60) + '...';

  const image = findTag(event, 'image') || FALLBACK_IMAGE;

  return {
    pageTitle: `${pageHeading} - zap.cooking`,
    ogTitle,
    description: capRecipeDescription(deriveLongDescription(event)),
    image,
    publishedAt: typeof event.created_at === 'number' ? event.created_at : null,
    authorPubkey: typeof event.pubkey === 'string' ? event.pubkey : null
  };
}
