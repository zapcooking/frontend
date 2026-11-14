/**
 * Server-only: the link-preview card for a Go live watch link,
 * `/live/s/<id>`.
 *
 * Resolved in the `handle` hook and injected into the real page for every
 * visitor, exactly like recipe and note cards (see recipeOgHtml.server and
 * the comment in hooks.server.ts): clients that never run JavaScript —
 * Nostr apps' unfurlers, messaging apps, social crawlers — still get the
 * title, "Live from Zap Cooking", the host's name and a picture.
 *
 * The picture is the recipe's photo when the session has a recipe with
 * one, otherwise the branded image (static/live-share.png). An ended
 * session, or one no longer on record, still gets a card that says the
 * stream has ended: never an error.
 *
 * Reads one session row (public columns only) and, from relays, the
 * host's profile and the recipe. Nothing is written and nothing about the
 * visitor is read or stored. Never throws; every failure degrades to a
 * plainer card.
 */
import { nip19 } from 'nostr-tools';
import { raceRelays } from '../recipePackOg.server';
import { fetchRecipeEventForOg } from '../recipeOg.server';
import { capRecipeDescription, getRecipeOgMeta, type RecipeOgMeta } from '../recipeOgMeta';
import { getSession, type LiveDb, type LiveSessionRow } from './sessions.server';

/** The branded picture for a stream without a recipe photo (1200×630). */
export const LIVE_SHARE_IMAGE = 'https://zap.cooking/live-share.png';
const SITE_FALLBACK_IMAGE = 'https://zap.cooking/social-share.png';
const PROFILE_TIMEOUT_MS = 4000;

export const LIVE_ENDED_TEXT = 'This live stream has ended';
const BRAND_LINE = 'Live from Zap Cooking';

/** Card for a link whose session is not on record (or could not be read). */
export const FALLBACK_LIVE_OG: RecipeOgMeta = {
  pageTitle: 'Live - zap.cooking',
  ogTitle: BRAND_LINE,
  description: `${LIVE_ENDED_TEXT}. Watch live cooking on Zap Cooking.`,
  image: LIVE_SHARE_IMAGE,
  publishedAt: null,
  authorPubkey: null
};

const LIVE_ROUTE_RE = /^\/live\/s\/([0-9a-f]{32})\/?$/;

export function matchLiveOgRoute(pathname: string): { id: string } | null {
  const m = pathname.match(LIVE_ROUTE_RE);
  return m ? { id: m[1] } : null;
}

/** `<kind>:<pubkey>:<d>` → naddr, or null when it is not a usable address. */
export function recipeAddressToNaddr(a: string | null): string | null {
  if (!a) return null;
  const first = a.indexOf(':');
  const second = a.indexOf(':', first + 1);
  if (first < 1 || second < 0) return null;
  const kind = Number(a.slice(0, first));
  const pubkey = a.slice(first + 1, second);
  const identifier = a.slice(second + 1);
  if (!Number.isInteger(kind) || !/^[0-9a-f]{64}$/.test(pubkey) || !identifier) return null;
  try {
    return nip19.naddrEncode({ kind, pubkey, identifier });
  } catch {
    return null;
  }
}

/** The host's display name from their profile, or null. Never throws. */
async function fetchHostName(pubkey: string): Promise<string | null> {
  try {
    const timeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), PROFILE_TIMEOUT_MS)
    );
    const event = await Promise.race([raceRelays({ kinds: [0], authors: [pubkey] }), timeout]);
    const content = (event as { content?: unknown } | null)?.content;
    if (typeof content !== 'string') return null;
    const profile = JSON.parse(content) as Record<string, unknown>;
    for (const key of ['display_name', 'displayName', 'name']) {
      const v = profile[key];
      if (typeof v === 'string' && v.trim()) return v.replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    return null;
  } catch {
    return null;
  }
}

export interface LiveOgDeps {
  /** Whether a recipe (by naddr) must get no card (moderation, hidden). */
  hideRecipe?: (naddr: string, event: Parameters<typeof getRecipeOgMeta>[0] | null) => boolean;
  /**
   * Absolute URL of the branded picture on the site serving the page, so
   * a preview deployment's card points at its own copy. Default:
   * LIVE_SHARE_IMAGE (zap.cooking).
   */
  shareImage?: string;
  /** Test seams; the defaults read relays. */
  hostName?: (pubkey: string) => Promise<string | null>;
  recipeEvent?: (naddr: string) => Promise<Parameters<typeof getRecipeOgMeta>[0] | null>;
}

/** Pure: the card from what was found. Exported for tests. */
export function liveOgMeta(
  row: Pick<LiveSessionRow, 'title' | 'status'>,
  hostName: string | null,
  recipe: { title: string; image: string } | null,
  shareImage: string = LIVE_SHARE_IMAGE
): RecipeOgMeta {
  const ended = row.status === 'ended';
  const by = hostName ? ` with ${hostName}` : '';
  const recipeLine = recipe ? ` Cooking: ${recipe.title}.` : '';
  const description = ended
    ? `${LIVE_ENDED_TEXT}. ${BRAND_LINE}${by}.${recipeLine}`
    : `${BRAND_LINE}${by}.${recipeLine}`;
  return {
    pageTitle: `${row.title} - Live on zap.cooking`,
    ogTitle: ended ? `${row.title} (ended)` : row.title,
    description: capRecipeDescription(description),
    image: recipe?.image || shareImage,
    publishedAt: null,
    authorPubkey: null
  };
}

/**
 * The card for one session. `db` may be missing (not bound): the generic
 * card then. Never throws.
 */
export async function resolveLiveOgMeta(
  db: LiveDb | undefined,
  id: string,
  deps: LiveOgDeps = {}
): Promise<RecipeOgMeta> {
  const fallback = { ...FALLBACK_LIVE_OG, image: deps.shareImage ?? LIVE_SHARE_IMAGE };
  try {
    if (!db) return fallback;
    const row = await getSession(db, id);
    if (!row) return fallback;

    const naddr = recipeAddressToNaddr(row.recipe_a);
    const hidden = (event: Parameters<typeof getRecipeOgMeta>[0] | null) =>
      !!naddr && !!deps.hideRecipe?.(naddr, event);
    const [hostName, recipeEvent] = await Promise.all([
      (deps.hostName ?? fetchHostName)(row.host_pubkey),
      naddr && !hidden(null)
        ? (deps.recipeEvent ?? fetchRecipeEventForOg)(naddr).catch(() => null)
        : Promise.resolve(null)
    ]);

    let recipe: { title: string; image: string } | null = null;
    if (recipeEvent && !hidden(recipeEvent)) {
      const meta = getRecipeOgMeta(recipeEvent);
      const image = meta.image && meta.image !== SITE_FALLBACK_IMAGE ? meta.image : '';
      recipe = { title: meta.ogTitle, image };
    }
    return liveOgMeta(row, hostName, recipe, deps.shareImage);
  } catch {
    return fallback;
  }
}
