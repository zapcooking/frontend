/**
 * Vanity URLs for premium members: zap.cooking/<handle>/<slug>
 *
 * The handle must be the author's verified @zap.cooking NIP-05 name
 * (premium benefit). The slug is the post's `d` identifier — an article,
 * a recipe, or a premium (gated) recipe. Resolves handle → pubkey via
 * the handle directory, then the event via the same raw-WebSocket relay
 * race the OG path uses, and 302-redirects to the canonical /reads or
 * /recipe URL (which carry OG tags, the share short-link flow, and all
 * client behavior unchanged).
 *
 * A 302 rather than a 301 because the handle→pubkey mapping is mutable:
 * memberships lapse and handles get reassigned, so crawlers must keep
 * re-resolving. Unknown handles and unknown slugs return a real 404 —
 * this route is the last-resort match for two-segment paths, so junk
 * URLs must not soft-redirect somewhere.
 */

import { error, redirect } from '@sveltejs/kit';
import { nip19 } from 'nostr-tools';
import { resolveHandlePubkey } from '$lib/handleDirectory.server';
import { raceRelays } from '$lib/recipePackOg.server';
import { RECIPE_TAGS, GATED_RECIPE_KIND } from '$lib/consts';
import { validateMarkdownTemplate } from '$lib/parser';

/** NIP-05 name characters, lowercased. */
const HANDLE_RE = /^[a-z0-9-_.]{1,30}$/;
/** Nostr `d` identifier characters (case-sensitive match). */
const SLUG_RE = /^[a-zA-Z0-9-_.]{1,80}$/;
/** Namespaced short-code shape (base62, same as /s/ codes). */
const SHORTCODE_RE = /^[0-9a-z]{4,12}$/;

const RESOLVE_TIMEOUT_MS = 5000;
const ARTICLE_KIND = 30023;

/**
 * Mirror of the /reads page's recipe rejection: an event with a recipe
 * `t` tag or recipe-shaped markdown belongs on /recipe — /reads would
 * bounce it with "This is a recipe, not an article".
 */
function isRecipeEvent(evt: unknown): boolean {
  const tags: string[][] = Array.isArray((evt as any)?.tags) ? (evt as any).tags : [];
  const hasRecipeTag = tags.some(
    (t) => t[0] === 't' && RECIPE_TAGS.includes((t[1] || '').toLowerCase())
  );
  if (hasRecipeTag) return true;
  const content = typeof (evt as any)?.content === 'string' ? (evt as any).content : '';
  return typeof validateMarkdownTemplate(content) !== 'string';
}

interface NamespacedShortLink {
  target: string;
  createdAt: number;
}

function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS))
  ]);
}

export const load = async ({
  params,
  platform
}: {
  params: { handle: string; slug: string };
  platform?: App.Platform;
}) => {
  const handle = params.handle.toLowerCase();
  const slug = params.slug;

  if (!HANDLE_RE.test(handle) || !SLUG_RE.test(slug)) {
    throw error(404, 'Not found');
  }

  const pubkey = await withTimeout(resolveHandlePubkey(handle));
  if (!pubkey) {
    throw error(404, `No zap.cooking handle “${handle}”`);
  }

  let event = await withTimeout(
    raceRelays({ kinds: [ARTICLE_KIND], authors: [pubkey], '#d': [slug] })
  );
  let kind = ARTICLE_KIND;

  // Premium (gated) recipes live at kind 35000.
  if (!event) {
    event = await withTimeout(
      raceRelays({ kinds: [GATED_RECIPE_KIND], authors: [pubkey], '#d': [slug] })
    );
    kind = GATED_RECIPE_KIND;
  }

  if (event) {
    // Recipe-shaped content redirects to /recipe — /reads rejects it.
    const base = kind === GATED_RECIPE_KIND || isRecipeEvent(event) ? '/recipe' : '/reads';
    throw redirect(
      302,
      `${base}/${nip19.naddrEncode({ kind, pubkey, identifier: slug })}`
    );
  }

  // Not an article slug — maybe a namespaced short code
  // (zap.cooking/<handle>/<code> → the author's post).
  if (SHORTCODE_RE.test(slug)) {
    const kv = platform?.env?.SHORTLINKS;
    const record = kv
      ? ((await withTimeout(kv.get(`ns/${handle}/${slug}`, 'json'))) as NamespacedShortLink | null)
      : null;
    if (record?.target && record.target.startsWith('/')) {
      throw redirect(302, record.target);
    }
  }

  throw error(404, `No article “${slug}” by @${handle}`);
};
