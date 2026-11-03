import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { nip19 } from 'nostr-tools';
import {
  effectivePlated,
  isPlatedNotificationHidden,
  lookupPlatedRecipes,
  platedNotificationData,
  platedNotificationHref,
  platedRecipeLookups,
  platedRecipeTitle,
  resetPlatedRecipeLookups,
  PLATED_HASHTAGS_MAX,
  PLATED_NOTE_MAX,
  type LookedUpEvent,
  type PlatedRecipeLookup,
  type RecipeFetcher
} from './notification';
import { PLATED_MARKER_TAG, plateableRecipe, type PlatedEventLike } from './plated';
import { platedNotificationAction } from './copy';
import type { MuteList } from '$lib/muteFilter';
import { compileModerationLists, isBlockedReadsPointer } from '$lib/reads/moderation';

const ME = 'a'.repeat(64);
const COOK = '1'.repeat(64);
const OTHER_AUTHOR = 'b'.repeat(64);
const ADDRESS = `30023:${ME}:sourdough-waffles`;
const IMG = 'https://image.nostr.build/waffles.jpg';
const PLATE_ID = 'd'.repeat(64);

function plate(overrides: Partial<PlatedEventLike> = {}, address = ADDRESS): PlatedEventLike {
  const author = address.split(':')[1];
  return {
    id: PLATE_ID,
    pubkey: COOK,
    kind: 1111,
    created_at: 1_700_000_000,
    content: `Crispy and golden\n\n${IMG}`,
    tags: [
      ['A', address, ''],
      ['K', address.split(':')[0]],
      ['P', author, ''],
      ['a', address, ''],
      ['k', address.split(':')[0]],
      ['p', author, ''],
      ['e', 'f'.repeat(64), '', author],
      [...PLATED_MARKER_TAG]
    ],
    ...overrides
  };
}

const NO_MUTES: MuteList = { pubkeys: [], words: [], tags: [], threads: [] };
const NEVER_BLOCKED = () => false;
const NO_LOOKUPS: ReadonlyMap<string, PlatedRecipeLookup> = new Map();

function stored(p: PlatedEventLike = plate()) {
  return { id: p.id!, fromPubkey: p.pubkey!, plated: platedNotificationData(p, ME)! };
}

function recipeEvent(tags: string[][], overrides: Partial<LookedUpEvent> = {}): LookedUpEvent {
  return {
    kind: 30023,
    pubkey: ME,
    created_at: 100,
    tags: [['d', 'sourdough-waffles'], ...tags],
    relays: ['wss://relay.example'],
    ...overrides
  };
}

beforeEach(() => resetPlatedRecipeLookups());

describe('platedNotificationData (which comment notifications are plates)', () => {
  it('recognises a valid top-level plate on your recipe', () => {
    expect(platedNotificationData(plate(), ME)).toEqual({
      recipeAddress: ADDRESS,
      image: IMG,
      note: 'Crispy and golden',
      hashtags: ['cooked']
    });
  });

  it('keeps a marker-tagged post that fails the Plated rule a normal comment', () => {
    expect(platedNotificationData(plate({ content: 'no photo here' }), ME)).toBeNull();
    const cw = plate();
    cw.tags!.push(['content-warning', '']);
    expect(platedNotificationData(cw, ME)).toBeNull();
    const mismatched = plate();
    mismatched.tags = mismatched.tags!.map((t) => (t[0] === 'a' ? ['a', `30023:${ME}:other`] : t));
    expect(platedNotificationData(mismatched, ME)).toBeNull();
  });

  it('keeps an unmarked photo comment a normal comment', () => {
    const p = plate();
    p.tags = p.tags!.filter((t) => t[0] !== 't');
    expect(platedNotificationData(p, ME)).toBeNull();
  });

  it('keeps a reply (k=1111) that mentions you a normal comment', () => {
    const reply = plate();
    reply.tags = reply.tags!.map((t) => (t[0] === 'k' ? ['k', '1111'] : t));
    expect(platedNotificationData(reply, ME)).toBeNull();
  });

  it("ignores self-plating (you plated your own recipe)", () => {
    expect(platedNotificationData(plate({ pubkey: ME }), ME)).toBeNull();
  });

  it("ignores a plate on another author's recipe", () => {
    expect(platedNotificationData(plate({}, `30023:${OTHER_AUTHOR}:waffles`), ME)).toBeNull();
  });

  it('keeps a plate on a kind-35000 address a normal comment', () => {
    expect(platedNotificationData(plate({}, `35000:${ME}:sourdough-waffles`), ME)).toBeNull();
  });

  it('caps the stored note and hashtags', () => {
    const long = plate({ content: `${'x'.repeat(5000)}\n${IMG}` });
    for (let i = 0; i < 50; i++) long.tags!.push(['t', `tag${i}`]);
    long.tags!.push(['t', 'y'.repeat(500)]);
    const data = platedNotificationData(long, ME)!;
    expect(data.note.length).toBe(PLATED_NOTE_MAX);
    expect(data.hashtags.length).toBe(PLATED_HASHTAGS_MAX);
  });

  it('stores no raw event: only the four fields', () => {
    expect(Object.keys(platedNotificationData(plate(), ME)!).sort()).toEqual([
      'hashtags',
      'image',
      'note',
      'recipeAddress'
    ]);
  });
});

describe('plateableRecipe (the recipe page prompt and row)', () => {
  const root = (tags: string[][], kind = 30023) => ({ kind, pubkey: ME, tags: [['d', 'w'], ...tags] });

  it('offers plating on a recipe tagged zapcooking or nostrcooking, any case', () => {
    expect(plateableRecipe(root([['t', 'zapcooking']]))).not.toBeNull();
    expect(plateableRecipe(root([['t', 'nostrcooking']]))).not.toBeNull();
    expect(plateableRecipe(root([['t', 'NostrCooking']]))).not.toBeNull();
  });

  it('shows no prompt or row on an article or a kind-35000 event', () => {
    expect(plateableRecipe(root([['t', 'food']]))).toBeNull();
    expect(plateableRecipe(root([]))).toBeNull();
    expect(plateableRecipe(root([['t', 'zapcooking']], 35000))).toBeNull();
  });
});

describe('lookupPlatedRecipes (titles + recipe rule)', () => {
  it('starts pending (rows show "plated your recipe"), then shows the title when it arrives late', async () => {
    let resolveFetch!: (events: LookedUpEvent[]) => void;
    const fetcher: RecipeFetcher = () => new Promise((r) => (resolveFetch = r));
    const run = lookupPlatedRecipes([ADDRESS], fetcher);

    const data = platedNotificationData(plate(), ME)!;
    expect(get(platedRecipeLookups).get(ADDRESS)).toEqual({ status: 'pending' });
    expect(effectivePlated(stored(), get(platedRecipeLookups))).toEqual(data);
    expect(platedRecipeTitle(data, get(platedRecipeLookups))).toBeNull();
    expect(platedNotificationAction(null)).toBe('plated your recipe.');

    resolveFetch([recipeEvent([['t', 'zapcooking'], ['title', '  Sourdough   Waffles ']])]);
    await run;
    const title = platedRecipeTitle(data, get(platedRecipeLookups));
    expect(title).toBe('Sourdough Waffles');
    expect(platedNotificationAction(title)).toBe('plated your Sourdough Waffles.');
  });

  it('accepts the legacy nostrcooking tag, case-insensitively', async () => {
    await lookupPlatedRecipes([ADDRESS], async () => [recipeEvent([['t', 'NOSTRCOOKING'], ['title', 'W']])]);
    expect(get(platedRecipeLookups).get(ADDRESS)?.status).toBe('recipe');
  });

  it('keeps the text-only plate when the lookup fails or times out', async () => {
    await lookupPlatedRecipes([ADDRESS], async () => {
      throw new Error('relay down');
    });
    const lookups = get(platedRecipeLookups);
    expect(lookups.get(ADDRESS)).toEqual({ status: 'missing' });
    expect(effectivePlated(stored(), lookups)).not.toBeNull();
    expect(platedRecipeTitle(stored().plated, lookups)).toBeNull();
  });

  it('uses the generic text for a recipe with no title', async () => {
    await lookupPlatedRecipes([ADDRESS], async () => [recipeEvent([['t', 'zapcooking']])]);
    expect(platedRecipeTitle(stored().plated, get(platedRecipeLookups))).toBeNull();
  });

  it('turns a plate on an article (kind 30023, no recipe tag) back into a normal comment', async () => {
    await lookupPlatedRecipes([ADDRESS], async () => [recipeEvent([['t', 'food'], ['title', 'My essay']])]);
    expect(effectivePlated(stored(), get(platedRecipeLookups))).toBeNull();
  });

  it('uses the newest revision of the recipe', async () => {
    await lookupPlatedRecipes([ADDRESS], async () => [
      recipeEvent([['t', 'zapcooking'], ['title', 'Old']], { created_at: 1 }),
      recipeEvent([['t', 'zapcooking'], ['title', 'New']], { created_at: 2 })
    ]);
    expect(platedRecipeTitle(stored().plated, get(platedRecipeLookups))).toBe('New');
  });

  it('sends one request with de-duplicated coordinates, kind 30023 only, and never re-asks', async () => {
    const calls: Parameters<RecipeFetcher>[] = [];
    const fetcher: RecipeFetcher = async (...args) => {
      calls.push(args);
      return [];
    };
    const second = `30023:${ME}:pancakes`;
    await lookupPlatedRecipes([ADDRESS, ADDRESS, second, `35000:${ME}:x`, 'garbage'], fetcher, 1234);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual([
      { kinds: [30023], authors: [ME], '#d': ['sourdough-waffles', 'pancakes'] }
    ]);
    expect(calls[0][1]).toBe(1234);
    await lookupPlatedRecipes([ADDRESS, second], fetcher);
    expect(calls).toHaveLength(1);
  });
});

describe('isPlatedNotificationHidden (mutes and site moderation, plates only)', () => {
  it('shows an ordinary plate', () => {
    expect(isPlatedNotificationHidden(stored(), NO_LOOKUPS, NO_MUTES, NEVER_BLOCKED)).toBe(false);
  });

  it('hides a plate from a muted author', () => {
    const mutes = { ...NO_MUTES, pubkeys: [{ type: 'pubkey' as const, value: COOK }] };
    expect(isPlatedNotificationHidden(stored(), NO_LOOKUPS, mutes, NEVER_BLOCKED)).toBe(true);
  });

  it('hides a plate with a muted tag', () => {
    const p = plate();
    p.tags!.push(['t', 'Brunch']);
    const mutes = { ...NO_MUTES, tags: [{ type: 'tag' as const, value: 'brunch' }] };
    expect(isPlatedNotificationHidden(stored(p), NO_LOOKUPS, mutes, NEVER_BLOCKED)).toBe(true);
  });

  it('hides a plate whose note contains a muted word', () => {
    const mutes = { ...NO_MUTES, words: [{ type: 'word' as const, value: 'GOLDEN' }] };
    expect(isPlatedNotificationHidden(stored(), NO_LOOKUPS, mutes, NEVER_BLOCKED)).toBe(true);
  });

  it('hides a plate blocked by event id or by author (seed + overlay lists)', () => {
    const byEvent = compileModerationLists({
      blockedPubkeys: [],
      blockedEventIds: [PLATE_ID],
      blockedNaddrs: [],
      denylist: []
    });
    const byAuthor = compileModerationLists({
      blockedPubkeys: [COOK],
      blockedEventIds: [],
      blockedNaddrs: [],
      denylist: []
    });
    expect(
      isPlatedNotificationHidden(stored(), NO_LOOKUPS, NO_MUTES, (p) => isBlockedReadsPointer(p, byEvent))
    ).toBe(true);
    expect(
      isPlatedNotificationHidden(stored(), NO_LOOKUPS, NO_MUTES, (p) => isBlockedReadsPointer(p, byAuthor))
    ).toBe(true);
  });

  it('never runs keyword rules on the note', () => {
    const lists = compileModerationLists({
      blockedPubkeys: [],
      blockedEventIds: [],
      blockedNaddrs: [],
      denylist: ['golden']
    });
    expect(
      isPlatedNotificationHidden(stored(), NO_LOOKUPS, NO_MUTES, (p) => isBlockedReadsPointer(p, lists))
    ).toBe(false);
  });

  it('leaves ordinary comment notifications alone (no plate data, or an article)', () => {
    const blockAll = () => true;
    expect(isPlatedNotificationHidden({ id: PLATE_ID, fromPubkey: COOK }, NO_LOOKUPS, NO_MUTES, blockAll)).toBe(false);
    const article = new Map<string, PlatedRecipeLookup>([[ADDRESS, { status: 'not-recipe' }]]);
    expect(isPlatedNotificationHidden(stored(), article, NO_MUTES, blockAll)).toBe(false);
  });
});

describe('platedNotificationHref', () => {
  it('opens the recipe at the plated card, with relay hints when known', async () => {
    await lookupPlatedRecipes([ADDRESS], async () => [recipeEvent([['t', 'zapcooking']])]);
    const href = platedNotificationHref(PLATE_ID, stored().plated, get(platedRecipeLookups))!;
    const [path, hash] = href.split('#');
    expect(hash).toBe(`plated-${PLATE_ID}`);
    const decoded = nip19.decode(path.replace('/recipe/', ''));
    expect(decoded.type).toBe('naddr');
    expect(decoded.data).toEqual({
      kind: 30023,
      pubkey: ME,
      identifier: 'sourdough-waffles',
      relays: ['wss://relay.example']
    });
  });

  it('still links without hints when the recipe could not be loaded', () => {
    const href = platedNotificationHref(PLATE_ID, stored().plated, NO_LOOKUPS)!;
    expect(href.startsWith('/recipe/naddr1')).toBe(true);
    expect(href.endsWith(`#plated-${PLATE_ID}`)).toBe(true);
  });

  it('never builds a link from a bad id or address', () => {
    expect(platedNotificationHref('not-hex', stored().plated, NO_LOOKUPS)).toBeNull();
    expect(
      platedNotificationHref(PLATE_ID, { ...stored().plated, recipeAddress: 'nope' }, NO_LOOKUPS)
    ).toBeNull();
  });
});
