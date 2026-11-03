import { describe, it, expect } from 'vitest';
import {
  hasPlatedMarker,
  platedCard,
  platedGallery,
  platedNote,
  platedRecipeOf,
  platedAnchorId,
  isPlatedPost,
  platedImage,
  recipeAddress,
  summarizePlated,
  PLATED_MARKER_TAG,
  type PlatedEventLike,
  type PlatedRecipe
} from './plated';
import { platedByLabel, platedThumbAlt, platedGalleryPosition, platedThumbLabel } from './copy';
import type { MuteList } from '$lib/muteFilter';
import { compileModerationLists, isBlockedReadsPointer } from '$lib/reads/moderation';
import { withoutBlockedComments } from '$lib/comments/moderation';

/** The row's real input: site moderation first (shared with the thread), then the summary. */
function moderatedSummary(events: PlatedEventLike[], lists: ReturnType<typeof compileModerationLists>) {
  return summarizePlated(
    withoutBlockedComments(events, (p) => isBlockedReadsPointer(p, lists)),
    RECIPE
  );
}

const AUTHOR = 'a'.repeat(64);
const COOK_1 = '1'.repeat(64);
const COOK_2 = '2'.repeat(64);
const COOK_3 = '3'.repeat(64);
const ADDRESS = `30023:${AUTHOR}:pancakes`;
const RECIPE: PlatedRecipe = { address: ADDRESS, authorPubkey: AUTHOR };
const IMG = 'https://image.nostr.build/abc.jpg';

let seq = 0;
function id(): string {
  seq += 1;
  return seq.toString(16).padStart(64, '0');
}

/** A top-level plated comment as the web composer publishes it. */
function plated(overrides: Partial<PlatedEventLike> = {}): PlatedEventLike {
  return {
    id: id(),
    pubkey: COOK_1,
    kind: 1111,
    created_at: 1_700_000_000,
    content: `Turned out great\n\n${IMG}`,
    tags: [
      ['A', ADDRESS, ''],
      ['K', '30023'],
      ['P', AUTHOR, ''],
      ['a', ADDRESS, ''],
      ['k', '30023'],
      ['p', AUTHOR, ''],
      ['e', 'f'.repeat(64), '', AUTHOR],
      [...PLATED_MARKER_TAG],
      ['client', 'Zap Cooking']
    ],
    ...overrides
  };
}

const EMPTY_MUTES: MuteList = { pubkeys: [], words: [], tags: [], threads: [] };

describe('marker tag detection', () => {
  it('detects ["t","cooked"], case-insensitively', () => {
    expect(hasPlatedMarker(plated())).toBe(true);
    expect(hasPlatedMarker({ tags: [['t', 'Cooked']] })).toBe(true);
    expect(hasPlatedMarker({ tags: [['t', ' COOKED ']] })).toBe(true);
  });

  it('ignores other tags, other values and malformed tags', () => {
    expect(hasPlatedMarker({ tags: [['t', 'cook']] })).toBe(false);
    expect(hasPlatedMarker({ tags: [['l', 'cooked']] })).toBe(false);
    expect(hasPlatedMarker({ tags: [['t']] })).toBe(false);
    expect(hasPlatedMarker({ tags: [null as unknown as string[], ['t', 5 as unknown as string]] })).toBe(false);
    expect(hasPlatedMarker({})).toBe(false);
  });

  it('a normal comment without the marker is not plated', () => {
    const ev = plated();
    ev.tags = ev.tags!.filter((t) => t[0] !== 't');
    expect(isPlatedPost(ev, RECIPE)).toBe(false);
  });
});

describe('image validation', () => {
  it('accepts the first https image URL', () => {
    expect(platedImage(plated())).toBe(IMG);
    expect(isPlatedPost(plated(), RECIPE)).toBe(true);
  });

  it('rejects a post with no image', () => {
    expect(isPlatedPost(plated({ content: 'Made it, no photo' }), RECIPE)).toBe(false);
  });

  it('rejects video-only, non-image links and plain http images', () => {
    expect(isPlatedPost(plated({ content: 'https://v.nostr.build/clip.mp4' }), RECIPE)).toBe(false);
    expect(isPlatedPost(plated({ content: 'https://example.com/page' }), RECIPE)).toBe(false);
    expect(isPlatedPost(plated({ content: 'http://example.com/a.jpg' }), RECIPE)).toBe(false);
  });

  it('rejects garbage and missing content', () => {
    expect(isPlatedPost(plated({ content: 'https://' }), RECIPE)).toBe(false);
    expect(isPlatedPost(plated({ content: undefined }), RECIPE)).toBe(false);
  });
});

describe('structure', () => {
  it('only counts kind-1111 top-level comments on THIS recipe', () => {
    expect(isPlatedPost(plated({ kind: 1 }), RECIPE)).toBe(false);
    expect(
      isPlatedPost(plated(), { address: `30023:${AUTHOR}:waffles`, authorPubkey: AUTHOR })
    ).toBe(false);
  });

  it('excludes replies to comments', () => {
    const reply = plated({
      tags: [
        ['A', ADDRESS, ''],
        ['K', '30023'],
        ['P', AUTHOR, ''],
        ['e', 'c'.repeat(64), '', COOK_2],
        ['k', '1111'],
        ['p', COOK_2, ''],
        ['t', 'cooked']
      ]
    });
    expect(isPlatedPost(reply, RECIPE)).toBe(false);
  });

  it('excludes NIP-36 content warnings', () => {
    const ev = plated();
    ev.tags!.push(['content-warning', 'gore']);
    expect(isPlatedPost(ev, RECIPE)).toBe(false);
    const bare = plated();
    bare.tags!.push(['content-warning']);
    expect(isPlatedPost(bare, RECIPE)).toBe(false);
  });

  it('requires an id and a valid hex pubkey', () => {
    expect(isPlatedPost(plated({ id: undefined }), RECIPE)).toBe(false);
    expect(isPlatedPost(plated({ pubkey: 'npub1xyz' }), RECIPE)).toBe(false);
  });
});

describe('summarizePlated', () => {
  it('counts unique authors, not posts', () => {
    const s = summarizePlated(
      [
        plated({ pubkey: COOK_1, created_at: 1 }),
        plated({ pubkey: COOK_1, created_at: 2 }),
        plated({ pubkey: COOK_2, created_at: 3 })
      ],
      RECIPE
    );
    expect(s.cookCount).toBe(2);
    expect(s.plates).toHaveLength(2);
  });

  it("keeps each cook's newest plate, newest cook first", () => {
    const older = plated({ pubkey: COOK_1, created_at: 10 });
    const newer = plated({ pubkey: COOK_1, created_at: 20 });
    const other = plated({ pubkey: COOK_2, created_at: 15 });
    const s = summarizePlated([older, other, newer], RECIPE);
    expect(s.plates.map((p) => p.id)).toEqual([newer.id, other.id]);
  });

  it('de-duplicates the same event arriving twice', () => {
    const ev = plated({ pubkey: COOK_1 });
    const s = summarizePlated([ev, { ...ev }, ev], RECIPE);
    expect(s.cookCount).toBe(1);
  });

  it("credits the event's own author", () => {
    const s = summarizePlated([plated({ pubkey: COOK_3 })], RECIPE);
    expect(s.plates[0].pubkey).toBe(COOK_3);
  });

  it('excludes the recipe author plating their own recipe', () => {
    const s = summarizePlated([plated({ pubkey: AUTHOR }), plated({ pubkey: COOK_1 })], RECIPE);
    expect(s.cookCount).toBe(1);
    expect(s.plates[0].pubkey).toBe(COOK_1);
  });

  it('hides muted authors, muted words and muted hashtags', () => {
    const events = [
      plated({ pubkey: COOK_1 }),
      plated({ pubkey: COOK_2, content: `spoiler alert\n${IMG}` }),
      plated({ pubkey: COOK_3 })
    ];
    expect(summarizePlated(events, RECIPE, { muteList: EMPTY_MUTES }).cookCount).toBe(3);
    const muted: MuteList = {
      ...EMPTY_MUTES,
      pubkeys: [{ type: 'pubkey', value: COOK_1 }],
      words: [{ type: 'word', value: 'spoiler' }]
    };
    const s = summarizePlated(events, RECIPE, { muteList: muted });
    expect(s.plates.map((p) => p.pubkey)).toEqual([COOK_3]);
    const tagMuted: MuteList = { ...EMPTY_MUTES, tags: [{ type: 'tag', value: 'cooked' }] };
    expect(summarizePlated(events, RECIPE, { muteList: tagMuted }).cookCount).toBe(0);
  });

  it('a muted newest plate does not resurrect that cook through an older one', () => {
    // Muting is by author here, so both of COOK_1's plates are hidden.
    const muted: MuteList = { ...EMPTY_MUTES, pubkeys: [{ type: 'pubkey', value: COOK_1 }] };
    const s = summarizePlated(
      [plated({ pubkey: COOK_1, created_at: 1 }), plated({ pubkey: COOK_1, created_at: 2 })],
      RECIPE,
      { muteList: muted }
    );
    expect(s.cookCount).toBe(0);
  });

  it('drops locally hidden (reported) ids', () => {
    const reported = plated({ pubkey: COOK_1 });
    const s = summarizePlated([reported, plated({ pubkey: COOK_2 })], RECIPE, {
      hiddenIds: new Set([reported.id!])
    });
    expect(s.plates.map((p) => p.pubkey)).toEqual([COOK_2]);
  });

  it('drops a moderation-blocked event id for everyone, and the count follows', () => {
    const bad = plated({ pubkey: COOK_1 });
    const good = plated({ pubkey: COOK_2 });
    const lists = compileModerationLists({
      blockedPubkeys: [],
      blockedEventIds: [bad.id!],
      blockedNaddrs: [],
      denylist: []
    });
    const s = moderatedSummary([bad, good], lists);
    expect(s.plates.map((p) => p.id)).toEqual([good.id]);
    expect(s.cookCount).toBe(1);
  });

  it("blocking one plate leaves the same cook's other, unblocked plate counted", () => {
    const older = plated({ pubkey: COOK_1, created_at: 1 });
    const newer = plated({ pubkey: COOK_1, created_at: 2 });
    const lists = compileModerationLists({
      blockedPubkeys: [],
      blockedEventIds: [newer.id!],
      blockedNaddrs: [],
      denylist: []
    });
    const s = moderatedSummary([older, newer], lists);
    // Only the blocked event goes; the cook's other plate still counts.
    expect(s.plates.map((p) => p.id)).toEqual([older.id]);
  });

  it('drops every plate by a moderation-blocked pubkey (case-insensitive)', () => {
    const lists = compileModerationLists({
      blockedPubkeys: [COOK_1.toUpperCase()],
      blockedEventIds: [],
      blockedNaddrs: [],
      denylist: []
    });
    const s = moderatedSummary(
      [plated({ pubkey: COOK_1, created_at: 1 }), plated({ pubkey: COOK_1, created_at: 2 }), plated({ pubkey: COOK_3 })],
      lists
    );
    expect(s.plates.map((p) => p.pubkey)).toEqual([COOK_3]);
    expect(s.cookCount).toBe(1);
  });

  it('pointer moderation ignores the keyword denylist for comment text', () => {
    const lists = compileModerationLists({
      blockedPubkeys: [],
      blockedEventIds: [],
      blockedNaddrs: [],
      denylist: ['breast']
    });
    const s = moderatedSummary([plated({ content: `Juicy chicken breast!\n${IMG}` })], lists);
    expect(s.cookCount).toBe(1);
  });

  it('is empty when nothing qualifies', () => {
    expect(summarizePlated([], RECIPE)).toEqual({ plates: [], cookCount: 0 });
    expect(summarizePlated([plated({ content: 'no photo' })], RECIPE).cookCount).toBe(0);
  });

  it("carries the cook's imeta alt text for the shown image", () => {
    const ev = plated();
    ev.tags!.push(['imeta', `url ${IMG}`, 'alt Golden pancakes with blueberries']);
    expect(summarizePlated([ev], RECIPE).plates[0].alt).toBe('Golden pancakes with blueberries');
    expect(summarizePlated([plated({ pubkey: COOK_2 })], RECIPE).plates[0].alt).toBeNull();
  });
});

describe('recipeAddress', () => {
  it('builds kind:pubkey:d, including premium kind 35000', () => {
    expect(recipeAddress({ kind: 30023, pubkey: AUTHOR, tags: [['d', 'pancakes']] })).toBe(ADDRESS);
    expect(recipeAddress({ kind: 35000, pubkey: AUTHOR, tags: [['d', 'x']] })).toBe(
      `35000:${AUTHOR}:x`
    );
    expect(recipeAddress({ kind: 30023, pubkey: AUTHOR, tags: [] })).toBeNull();
  });
});

describe('copy', () => {
  it('pluralizes the cook count', () => {
    expect(platedByLabel(1)).toBe('Plated by 1 cook');
    expect(platedByLabel(2)).toBe('Plated by 2 cooks');
    expect(platedByLabel(48)).toBe('Plated by 48 cooks');
  });

  it("prefers the cook's alt text", () => {
    expect(platedThumbAlt('Pancakes', 'Stack of pancakes')).toBe('Stack of pancakes');
    expect(platedThumbAlt('Pancakes', null)).toBe("A cook's plate of Pancakes");
    expect(platedThumbAlt('', null)).toBe("A cook's plate of this recipe");
  });
});

const ROOT = {
  kind: 30023,
  pubkey: AUTHOR,
  tags: [['d', 'pancakes'], ['title', 'Pancakes'], ['t', 'zapcooking']]
};

describe('platedCard (thread card decision)', () => {
  it('renders a valid top-level plated post as a card: photo, alt, note', () => {
    const ev = plated({ content: `Turned out great\n\n${IMG}` });
    ev.tags!.push(['imeta', `url ${IMG}`, 'alt Golden stack']);
    expect(platedCard(ev, ROOT)).toEqual({ image: IMG, alt: 'Golden stack', note: 'Turned out great' });
  });

  it('gives an empty note for a photo-only plate', () => {
    expect(platedCard(plated({ content: IMG }), ROOT)?.note).toBe('');
    expect(platedCard(plated({ content: `\n\n${IMG}\n` }), ROOT)?.note).toBe('');
  });

  it('keeps a marker-tagged post that fails the rule as a normal comment', () => {
    expect(platedCard(plated({ content: 'no photo' }), ROOT)).toBeNull();
    const cw = plated();
    cw.tags!.push(['content-warning', '']);
    expect(platedCard(cw, ROOT)).toBeNull();
    const replyTags = plated().tags!.map((t) => (t[0] === 'k' ? ['k', '1111'] : t));
    expect(platedCard(plated({ tags: replyTags }), ROOT)).toBeNull();
    expect(platedCard(plated(), { ...ROOT, tags: [['d', 'waffles'], ['t', 'zapcooking']] })).toBeNull();
  });

  it('never makes an unmarked photo comment a card', () => {
    const ev = plated();
    ev.tags = ev.tags!.filter((t) => t[0] !== 't');
    expect(platedCard(ev, ROOT)).toBeNull();
  });

  it("is null for a root that isn't an addressable recipe", () => {
    expect(platedCard(plated(), { kind: 1, pubkey: AUTHOR, tags: [] })).toBeNull();
  });

  it('accepts either recipe tag, matched case-insensitively', () => {
    const legacy = { ...ROOT, tags: [['d', 'pancakes'], ['t', 'nostrcooking']] };
    const upper = { ...ROOT, tags: [['d', 'pancakes'], ['t', 'ZapCooking']] };
    expect(platedCard(plated(), legacy)).not.toBeNull();
    expect(platedCard(plated(), upper)).not.toBeNull();
  });

  it('keeps a plate on an article (kind 30023 without a recipe tag) a normal comment', () => {
    const article = { ...ROOT, tags: [['d', 'pancakes'], ['title', 'Pancakes'], ['t', 'food']] };
    expect(platedCard(plated(), article)).toBeNull();
  });

  it('keeps a plate on a kind-35000 root a normal comment', () => {
    const gated = { ...ROOT, kind: 35000 };
    expect(platedCard(plated({ tags: plated().tags!.map((t) => (t[0] === 'A' || t[0] === 'a' ? [t[0], `35000:${AUTHOR}:pancakes`] : t)) }), gated)).toBeNull();
  });

  it("still renders the recipe author's own plate as a card (only the row excludes it)", () => {
    expect(platedCard(plated({ pubkey: AUTHOR }), ROOT)).not.toBeNull();
  });

  it('uses the author pubkey from author when present (NDKEvent shape)', () => {
    expect(platedRecipeOf({ kind: 30023, pubkey: '', author: { pubkey: AUTHOR }, tags: [['d', 'pancakes']] })).toEqual(RECIPE);
  });
});

describe('platedNote', () => {
  it('removes only the featured photo URL and the blank lines it leaves', () => {
    const other = 'https://image.nostr.build/second.jpg';
    expect(platedNote(`So good.\n\n${IMG}\n${other}`, IMG)).toBe(`So good.\n\n${other}`);
    expect(platedNote(`Before ${IMG} after`, IMG)).toBe('Before  after');
    expect(platedNote(`A\n\n\n\n${IMG}\n\n\nB`, IMG)).toBe('A\n\nB');
    expect(platedNote('', IMG)).toBe('');
  });
});

describe('platedGallery', () => {
  it("is the summary's plates in summary order (newest cook first), one per cook", () => {
    const a1 = plated({ pubkey: COOK_1, created_at: 10 });
    const a2 = plated({ pubkey: COOK_1, created_at: 30 });
    const b = plated({ pubkey: COOK_2, created_at: 20 });
    const c = plated({ pubkey: COOK_3, created_at: 5 });
    const summary = summarizePlated([a1, b, a2, c], RECIPE);
    expect(platedGallery(summary.plates, new Set()).map((p) => p.id)).toEqual([a2.id, b.id, c.id]);
  });

  it('covers every plate, not just the five thumbnails', () => {
    const cooks = Array.from({ length: 8 }, (_, i) => String(i + 4).repeat(64).slice(0, 64));
    const summary = summarizePlated(cooks.map((pk, i) => plated({ pubkey: pk, created_at: i })), RECIPE);
    expect(platedGallery(summary.plates, new Set())).toHaveLength(8);
  });

  it('drops plates whose photo failed to load, keeping order', () => {
    const a = plated({ pubkey: COOK_1, created_at: 3 });
    const b = plated({ pubkey: COOK_2, created_at: 2 });
    const c = plated({ pubkey: COOK_3, created_at: 1 });
    const summary = summarizePlated([a, b, c], RECIPE);
    expect(platedGallery(summary.plates, new Set([b.id!])).map((p) => p.id)).toEqual([a.id, c.id]);
  });

  it('inherits the row rules: muted, reported, recipe author and moderated plates never reach it', () => {
    const muted = plated({ pubkey: COOK_1 });
    const reported = plated({ pubkey: COOK_2 });
    const own = plated({ pubkey: AUTHOR });
    const blocked = plated({ pubkey: COOK_3 });
    const ok = plated({ pubkey: '9'.repeat(64) });
    const lists = compileModerationLists({ blockedPubkeys: [], blockedEventIds: [blocked.id!], blockedNaddrs: [], denylist: [] });
    const summary = summarizePlated(
      withoutBlockedComments([muted, reported, own, blocked, ok], (p) => isBlockedReadsPointer(p, lists)),
      RECIPE,
      { muteList: { ...EMPTY_MUTES, pubkeys: [{ type: 'pubkey', value: COOK_1 }] }, hiddenIds: new Set([reported.id!]) }
    );
    expect(platedGallery(summary.plates, new Set()).map((p) => p.id)).toEqual([ok.id]);
  });

  it('carries the note for the caption', () => {
    const summary = summarizePlated([plated({ content: `Crispy!\n\n${IMG}` })], RECIPE);
    expect(summary.plates[0].note).toBe('Crispy!');
  });
});

describe('gallery copy and anchors', () => {
  it('announces position and names thumbnails', () => {
    expect(platedGalleryPosition(0, 5)).toBe('Photo 1 of 5');
    expect(platedThumbLabel("A cook's plate of Pancakes")).toBe("View photo: A cook's plate of Pancakes");
    expect(platedAnchorId('abc')).toBe('plated-abc');
  });
});
