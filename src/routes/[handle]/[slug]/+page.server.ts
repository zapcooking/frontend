/**
 * Vanity article URLs for premium members: zap.cooking/<handle>/<slug>
 *
 * The handle must be the author's verified @zap.cooking NIP-05 name
 * (premium benefit). The slug is the article's `d` identifier. Resolves
 * handle → pubkey via the handle directory, then the article via the
 * same raw-WebSocket relay race the OG path uses, and 302-redirects to
 * the canonical /reads/<naddr> URL (which carries OG tags, the share
 * short-link flow, and all client behavior unchanged).
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

/** NIP-05 name characters, lowercased. */
const HANDLE_RE = /^[a-z0-9-_.]{1,30}$/;
/** Nostr `d` identifier characters (case-sensitive match). */
const SLUG_RE = /^[a-zA-Z0-9-_.]{1,80}$/;

const RESOLVE_TIMEOUT_MS = 5000;
const ARTICLE_KIND = 30023;

function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), RESOLVE_TIMEOUT_MS))
  ]);
}

export const load = async ({ params }: { params: { handle: string; slug: string } }) => {
  const handle = params.handle.toLowerCase();
  const slug = params.slug;

  if (!HANDLE_RE.test(handle) || !SLUG_RE.test(slug)) {
    throw error(404, 'Not found');
  }

  const pubkey = await withTimeout(resolveHandlePubkey(handle));
  if (!pubkey) {
    throw error(404, `No zap.cooking handle “${handle}”`);
  }

  const event = await withTimeout(
    raceRelays({ kinds: [ARTICLE_KIND], authors: [pubkey], '#d': [slug] })
  );
  if (!event) {
    throw error(404, `No article “${slug}” by @${handle}`);
  }

  throw redirect(
    302,
    `/reads/${nip19.naddrEncode({ kind: ARTICLE_KIND, pubkey, identifier: slug })}`
  );
};
