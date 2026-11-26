import { describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import type { LandingEdition } from '$lib/landing/editions';
import type { LongformCard } from '$lib/landing/content';

/**
 * The /explore loader with an author held out of discovery. The landing
 * aggregate is mocked to return that author's cards, as a cache written
 * before the entry existed would: the loader must still serve none of them.
 */

const HELD_OUT = 'e'.repeat(64);
const COOK = 'c'.repeat(64);
const config = vi.hoisted(() => ({
  entries: [] as { pubkey: string; reason: string; since: string }[]
}));
// The configured list, swappable per test: the loader and the aggregate both
// read the default set at call time.
vi.mock('$lib/discovery/exclusion', async (importOriginal: () => Promise<unknown>) => {
  const real = (await importOriginal()) as typeof import('$lib/discovery/exclusion');
  return {
    ...real,
    get DISCOVERY_EXCLUDED_PUBKEYS() {
      return real.exclusionSet(config.entries);
    },
    isDiscoveryExcluded: (pubkey: string, set?: ReadonlySet<string>) =>
      real.isDiscoveryExcluded(pubkey, set ?? real.exclusionSet(config.entries))
  };
});

const getLandingData = vi.fn();
const getLandingPaid = vi.fn();
vi.mock('$lib/landing/landingData.server', async (importOriginal: () => Promise<unknown>) => ({
  ...((await importOriginal()) as typeof import('$lib/landing/landingData.server')),
  getLandingData: (...a: unknown[]) => getLandingData(...a)
}));
vi.mock('$lib/landing/landingPaid.server', () => ({
  getLandingPaid: (...a: unknown[]) => getLandingPaid(...a)
}));
vi.mock('$lib/reads/moderation.server', () => ({ loadReadsModerationLists: async () => null }));

function card(d: string, pubkey: string): LongformCard {
  const naddr = nip19.naddrEncode({ kind: 30023, pubkey, identifier: d });
  return {
    type: 'recipe',
    eventId: d.padEnd(64, '0'),
    coordinate: `30023:${pubkey}:${d}`,
    href: `/recipe/${naddr}`,
    title: `Recipe ${d}`,
    image: `https://image.nostr.build/${d}.jpg`,
    author: { pubkey },
    publishedAt: 1_800_000_000,
    tags: []
  };
}

async function load(entries: typeof config.entries) {
  config.entries = entries;
  const mod = await import('./+page.server');
  const { emptyLandingData } = await import('$lib/landing/landingData.server');
  const theirs = [card('archived-1', HELD_OUT), card('archived-2', HELD_OUT)];
  const others = [card('pie', COOK), card('soup', 'd'.repeat(64))];
  getLandingData.mockResolvedValueOnce({
    ...emptyLandingData(1_800_000_000),
    cover: theirs[0],
    picks: [theirs[1]],
    // Curated cover pool and the automatic recipe pool both lead with theirs.
    coverPool: [theirs[0], others[0]],
    coverList: { version: 1, coordinates: [theirs[0].coordinate, others[0].coordinate] },
    recipePool: [...theirs, ...others],
    newRecipes: [...theirs, ...others],
    cooks: [
      { pubkey: HELD_OUT, href: '/user/x', name: 'Archiver' },
      { pubkey: COOK, href: '/user/y', name: 'Cook' }
    ]
  });
  getLandingPaid.mockResolvedValueOnce({
    boosts: [
      {
        id: 'b1',
        href: card('boosted', HELD_OUT).href,
        title: 'Boosted',
        image: '',
        authorPubkey: HELD_OUT,
        expiresAt: 1
      },
      {
        id: 'b2',
        href: '/recipe/naddr1other',
        title: 'Paid pie',
        image: '',
        authorPubkey: 'f'.repeat(64),
        expiresAt: 1
      }
    ],
    sponsors: []
  });
  const out = (await mod.load({
    platform: { env: {}, ctx: { waitUntil: () => {} } },
    url: new URL('https://zap.cooking/explore'),
    setHeaders: () => {}
  } as never)) as { landing: LandingEdition; paid: { boosts: { id: string }[] } };
  const featured = [out.landing.cover, ...out.landing.picks, ...out.landing.newRecipes].filter(
    (c): c is LongformCard => !!c
  );
  return { out, featured };
}

describe('/explore with a discovery exclusion', () => {
  it('serves none of the author from a stale aggregate: featured slots, cooks or boosts', async () => {
    const { out, featured } = await load([
      { pubkey: HELD_OUT, reason: 'test entry', since: '2026-11-25' }
    ]);
    expect(featured.map((c) => c.author.pubkey)).not.toContain(HELD_OUT);
    // The next approved recipe is the cover; other cooks fill the recipe row.
    expect(out.landing.cover?.title).toBe('Recipe pie');
    expect(out.landing.newRecipes.map((c) => c.title)).toEqual(['Recipe soup']);
    expect(out.landing.cooks.map((c) => c.name)).toEqual(['Cook']);
    expect(out.paid.boosts.map((b) => b.id)).toEqual(['b2']);
    expect(JSON.stringify(out)).not.toContain(HELD_OUT);
  });

  it('serves the author again once the entry is removed', async () => {
    const { out, featured } = await load([]);
    // (Which approved recipe leads rotates daily, so check the slots together.)
    expect(featured.map((c) => c.author.pubkey)).toContain(HELD_OUT);
    expect(out.landing.coverPool?.map((c) => c.title)).toContain('Recipe archived-1');
    expect(out.landing.cooks.map((c) => c.name)).toEqual(['Archiver', 'Cook']);
    expect(out.paid.boosts.map((b) => b.id)).toEqual(['b1', 'b2']);
  });
});
