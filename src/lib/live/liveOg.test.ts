import { describe, it, expect, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import { createLiveDatabase } from '../../test/liveDatabase';
import {
  FALLBACK_LIVE_OG,
  LIVE_SHARE_IMAGE,
  liveOgMeta,
  matchLiveOgRoute,
  recipeAddressToNaddr,
  resolveLiveOgMeta
} from './liveOg.server';
import { buildOgTagBlock, injectOgTags } from '../recipeOgHtml.server';

const ID = 'c'.repeat(32);
const HOST = 'a'.repeat(64);
const AUTHOR = 'b'.repeat(64);
const RECIPE_A = `30023:${AUTHOR}:pancetta-pasta`;
const PHOTO = 'https://image.nostr.build/pasta.jpg';

const recipeEvent = {
  kind: 30023,
  pubkey: AUTHOR,
  content: 'Boil pasta.',
  tags: [
    ['d', 'pancetta-pasta'],
    ['title', 'Creamy pancetta and pea pasta'],
    ['image', PHOTO]
  ]
};

let db: ReturnType<typeof createLiveDatabase>;
function insert(over: Record<string, unknown> = {}) {
  const row = {
    id: ID,
    host_pubkey: HOST,
    title: 'Sunday sourdough',
    recipe_a: null,
    host_token_hash: 'h',
    status: 'live',
    created_at: 1,
    ...over
  };
  db.raw
    .prepare(
      'INSERT INTO live_sessions (id, host_pubkey, title, recipe_a, host_token_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      row.id,
      row.host_pubkey,
      row.title,
      row.recipe_a,
      row.host_token_hash,
      row.status,
      row.created_at
    );
}
const snapshot = () => JSON.stringify(db.raw.prepare('SELECT * FROM live_sessions').all());

beforeEach(() => {
  db = createLiveDatabase();
});

describe('matchLiveOgRoute', () => {
  it('matches a watch link, with or without a trailing slash', () => {
    expect(matchLiveOgRoute(`/live/s/${ID}`)).toEqual({ id: ID });
    expect(matchLiveOgRoute(`/live/s/${ID}/`)).toEqual({ id: ID });
  });
  it('ignores anything else', () => {
    for (const p of [
      '/live',
      '/live/s/abc',
      `/live/s/${ID.toUpperCase()}`,
      `/live/s/${ID}/x`,
      '/live/naddr1abc'
    ]) {
      expect(matchLiveOgRoute(p)).toBeNull();
    }
  });
});

describe('recipeAddressToNaddr', () => {
  it('encodes a recipe address', () => {
    const naddr = recipeAddressToNaddr(RECIPE_A)!;
    const decoded = nip19.decode(naddr);
    expect(decoded.type).toBe('naddr');
    expect(decoded.data).toMatchObject({
      kind: 30023,
      pubkey: AUTHOR,
      identifier: 'pancetta-pasta'
    });
  });
  it('rejects junk', () => {
    for (const a of [null, '', 'x', '30023:short:d', `30023:${AUTHOR}:`, `abc:${AUTHOR}:d`]) {
      expect(recipeAddressToNaddr(a)).toBeNull();
    }
  });
});

describe('liveOgMeta', () => {
  const recipe = { title: 'Refried Beans', image: PHOTO };
  it('live with a recipe: "<host> is cooking <recipe>", the brand line, the recipe photo', () => {
    const m = liveOgMeta(
      { title: 'Refried Beans', status: 'live', recipe_a: RECIPE_A },
      'Seth',
      recipe
    );
    expect(m.ogTitle).toBe('Seth is cooking Refried Beans');
    expect(m.description).toBe('Live from Zap Cooking with Seth.');
    expect(m.image).toBe(PHOTO);
    expect(m.pageTitle).toBe('Seth is cooking Refried Beans - Live on zap.cooking');
  });
  it('no recipe, default title: "Live from Zap Cooking" and the branded picture', () => {
    const m = liveOgMeta(
      { title: 'Live cook-along', status: 'live', recipe_a: null },
      'Seth',
      null
    );
    expect(m.ogTitle).toBe('Live from Zap Cooking');
    expect(m.description).toBe('Live from Zap Cooking with Seth.');
    expect(m.image).toBe(LIVE_SHARE_IMAGE);
  });
  it('no recipe, a typed title: that title', () => {
    const m = liveOgMeta({ title: 'Taco Tuesday', status: 'live', recipe_a: null }, 'Seth', null);
    expect(m.ogTitle).toBe('Taco Tuesday');
  });
  it('ended: "(ended)" and "This live stream has ended", recipe kept', () => {
    const m = liveOgMeta(
      { title: 'Refried Beans', status: 'ended', recipe_a: RECIPE_A },
      null,
      recipe
    );
    expect(m.ogTitle).toBe('Cooking Refried Beans (ended)');
    expect(m.description).toBe('This live stream has ended. Live from Zap Cooking.');
    expect(m.image).toBe(PHOTO);
  });
});

describe('resolveLiveOgMeta', () => {
  const deps = {
    hostName: async () => 'Seth',
    recipeEvent: async () => recipeEvent
  };

  it('builds the card from the row, the profile and the recipe, and writes nothing', async () => {
    insert({ recipe_a: RECIPE_A, title: 'Pasta night' });
    const before = snapshot();
    const m = await resolveLiveOgMeta(db, ID, deps);
    expect(m.ogTitle).toBe('Seth is cooking Creamy pancetta and pea pasta');
    expect(m.description).toBe('Live from Zap Cooking with Seth.');
    expect(m.image).toBe(PHOTO);
    expect(snapshot()).toBe(before);
  });

  it('a recipe without a photo gets the branded picture', async () => {
    insert({ recipe_a: RECIPE_A });
    const m = await resolveLiveOgMeta(db, ID, {
      ...deps,
      recipeEvent: async () => ({
        ...recipeEvent,
        tags: recipeEvent.tags.filter((t) => t[0] !== 'image')
      })
    });
    expect(m.image).toBe(LIVE_SHARE_IMAGE);
  });

  it('an ended session still gets a card that says it ended', async () => {
    insert({ recipe_a: RECIPE_A, status: 'ended' });
    const m = await resolveLiveOgMeta(db, ID, deps);
    expect(m.description.startsWith('This live stream has ended.')).toBe(true);
    expect(m.image).toBe(PHOTO);
  });

  it('an unknown id, a missing database or a failure gives the ended card, never a throw', async () => {
    expect(await resolveLiveOgMeta(db, ID, deps)).toEqual(FALLBACK_LIVE_OG);
    expect(await resolveLiveOgMeta(undefined, ID, deps)).toEqual(FALLBACK_LIVE_OG);
    const broken = {
      prepare() {
        throw new Error('d1 down');
      }
    };
    expect(await resolveLiveOgMeta(broken as never, ID, deps)).toEqual(FALLBACK_LIVE_OG);
    expect(FALLBACK_LIVE_OG.description).toContain('This live stream has ended');
  });

  it('a profile or recipe that cannot be fetched leaves a plainer card', async () => {
    insert({ recipe_a: RECIPE_A, title: 'Pasta night' });
    const m = await resolveLiveOgMeta(db, ID, {
      hostName: async () => null,
      recipeEvent: async () => {
        throw new Error('relays down');
      }
    });
    // Recipe not fetched: the stored title (the recipe's) names it.
    expect(m.ogTitle).toBe('Cooking Pasta night');
    expect(m.description).toBe('Live from Zap Cooking.');
    expect(m.image).toBe(LIVE_SHARE_IMAGE);
  });

  it("uses the serving site's copy of the branded picture", async () => {
    const shareImage = 'https://feat-live-watch.frontend-hvd.pages.dev/live-share.png';
    insert();
    expect((await resolveLiveOgMeta(db, ID, { ...deps, shareImage })).image).toBe(shareImage);
    expect((await resolveLiveOgMeta(db, 'f'.repeat(32), { ...deps, shareImage })).image).toBe(
      shareImage
    );
  });

  it('a hidden recipe is not fetched or shown', async () => {
    insert({ recipe_a: RECIPE_A });
    let fetched = false;
    const m = await resolveLiveOgMeta(db, ID, {
      ...deps,
      recipeEvent: async () => {
        fetched = true;
        return recipeEvent;
      },
      hideRecipe: () => true
    });
    expect(fetched).toBe(false);
    expect(m.image).toBe(LIVE_SHARE_IMAGE);
    expect(m.description).not.toContain('pancetta');
    expect(m.ogTitle).not.toMatch(/is cooking|^Cooking/);
  });
});

describe('server-rendered tags', () => {
  it('replaces the page placeholders with the live card, branded image with its size', async () => {
    const meta = liveOgMeta(
      { title: 'Morning <live> test', status: 'live', recipe_a: null },
      'Seth',
      null
    );
    const block = await buildOgTagBlock(meta, `https://zap.cooking/live/s/${ID}`);
    const page =
      '<html><head><title>Live - zap.cooking</title><meta property="og:title" content="Zap Cooking" /></head><body></body></html>';
    const html = injectOgTags(page, block);
    expect(html).toContain('<meta property="og:title" content="Morning &lt;live&gt; test" />');
    expect(html).toContain(`<meta property="og:url" content="https://zap.cooking/live/s/${ID}" />`);
    expect(html).toContain(`<meta property="og:image" content="${LIVE_SHARE_IMAGE}" />`);
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(html).not.toContain('content="Zap Cooking"');
  });
});
