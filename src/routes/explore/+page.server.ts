import type { PageServerLoad } from './$types';
import { getLandingData, moderateLandingData } from '$lib/landing/landingData.server';
import { getLandingPaid } from '$lib/landing/landingPaid.server';
import { formatCoordinate } from '$lib/coordinate';
import { decodeNaddr } from '$lib/reads/moderation';
import { loadReadsModerationLists } from '$lib/reads/moderation.server';
import { nextEditionHref, selectLandingEdition } from '$lib/landing/editions';
import { LANDING_CACHE_CONTROL } from '$lib/landing/route';
import { imageIdentity } from '$lib/landing/imageIdentity';
import type { LongformCard } from '$lib/landing/content';

// Public content stays server-rendered with its own aggregate cache. The HTML
// and route-data responses are not cached across deploys: hydration references
// hashed assets for the current build, including the shared account/nav/wallet UI.
export const csr = true;
export const prerender = false;

export const load: PageServerLoad = async ({ platform, setHeaders, url }) => {
  const kv = (platform?.env?.GATED_CONTENT ?? null) as Parameters<typeof getLandingPaid>[0];
  const cache =
    typeof caches !== 'undefined'
      ? ((caches as unknown as { default?: Cache }).default ?? null)
      : null;
  const ctx = platform?.ctx;
  const waitUntil = ctx ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;

  const [moderation, paid] = await Promise.all([
    loadReadsModerationLists(kv as Parameters<typeof loadReadsModerationLists>[0]).catch(
      () => null
    ),
    getLandingPaid(kv)
  ]);
  const pool = await getLandingData({ cache, waitUntil, moderation });
  const variant = url?.searchParams.get('edition');
  // Keep paid placements in their disclosed section, never repeat them in editorial content.
  // Decode addresses too: relay hints can spell the same recipe with another naddr.
  const paidCoordinates = new Set(
    paid.boosts.flatMap((boost) => {
      const address = decodeNaddr(boost.href.replace(/^\/recipe\//, '').replace(/[?#/].*$/, ''));
      return address ? [formatCoordinate(address)] : [];
    })
  );
  const paidHrefs = new Set(
    paid.boosts.map((boost) => boost.href.replace(/[?#].*$/, '').replace(/\/$/, ''))
  );
  const moderated = moderateLandingData(pool, moderation);
  const isEditorial = (card: LongformCard) =>
    !paidCoordinates.has(card.coordinate) &&
    !paidHrefs.has(card.href.replace(/[?#].*$/, '').replace(/\/$/, ''));
  const paidImages = new Set(
    [...paid.boosts.map((card) => card.image), ...paid.sponsors.map((card) => card.imageUrl)]
      .filter(Boolean)
      .map(imageIdentity)
  );
  const editorial = {
    ...moderated,
    coverPool: moderated.coverPool?.filter(isEditorial),
    recipePool: moderated.recipePool?.filter(isEditorial),
    newRecipes: moderated.newRecipes.filter(isEditorial),
    readPool: moderated.readPool?.filter(isEditorial),
    reads: moderated.reads.filter(isEditorial)
  };
  const landing = selectLandingEdition(
    editorial,
    Math.floor(Date.now() / 1000),
    variant,
    paidImages
  );

  setHeaders({ 'cache-control': LANDING_CACHE_CONTROL });
  return { landing, paid, nextEditionHref: nextEditionHref(variant) };
};
