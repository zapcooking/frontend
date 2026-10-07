import { describe, it, expect } from 'vitest';
import { recipeBoxData, sharedAgo, shortTime, topTopics } from './recipeBoxCard';
import { LABELER_PUBKEY, type RelayEvent } from './relay';
import { TOPIC_NAMESPACE } from './archive';

const PK = 'a'.repeat(64);
const FULL = `## Chef's notes

The levain is optional.

## Details

- ⏲️ Prep time: 21 hours 30 minutes
- 🍳 Cook time: 30 minutes
- 🍽️ Servings: ~ 12 slices

## Ingredients

- 5 grams **sourdough** starter
- 55 grams [all-purpose flour](https://example.com)
- 55 grams water
- 300 grams water
- 10 grams salt

## Directions

1. Mix everything together and rest overnight.
`;

const recipe = (content: string, tags: string[][] = []) => ({
  kind: 30023,
  pubkey: PK,
  created_at: 1_700_000_000,
  content,
  tags: [
    ['d', 'focaccia'],
    ['title', 'Sourdough Focaccia'],
    ['image', 'https://x/img.jpg'],
    ...tags
  ]
});

describe('recipeBoxData', () => {
  it('reads title, hero, chips, a three-ingredient peek and the rest as a count', () => {
    const r = recipeBoxData(recipe(FULL));
    expect(r.title).toBe('Sourdough Focaccia');
    expect(r.image).toBe('https://x/img.jpg');
    expect(r.href).toMatch(/^\/recipe\/naddr1/);
    expect(r.chips.map((c) => c.label)).toEqual([
      'Prep 21 h 30 min',
      'Cook 30 min',
      'Serves ~ 12 slices'
    ]);
    expect(r.ingredients).toEqual([
      '5 grams sourdough starter',
      '55 grams all-purpose flour',
      '55 grams water'
    ]);
    expect(r.moreIngredients).toBe(2);
  });

  it('missing fields: no image → no hero, no Details → no chips, no Ingredients → no peek', () => {
    const r = recipeBoxData({ ...recipe('Just a story about bread.'), tags: [['d', 'bread']] });
    expect(r.title).toBe('bread');
    expect(r.image).toBeNull();
    expect(r.chips).toEqual([]);
    expect(r.ingredients).toEqual([]);
    expect(r.moreIngredients).toBe(0);
  });

  it('only the details that are present become chips', () => {
    const r = recipeBoxData(recipe('## Details\n\n- 🍽️ Servings: 4\n\n## Ingredients\n\n- egg\n'));
    expect(r.chips.map((c) => c.key)).toEqual(['servings']);
    expect(r.ingredients).toEqual(['egg']);
  });

  it('dates the card by first publication (published_at), not the latest edit', () => {
    const r = recipeBoxData(recipe(FULL, [['published_at', '1600000000']]));
    expect(r.sharedAt).toBe(1_600_000_000);
  });

  it('clips a long time to keep chips short', () => {
    const r = recipeBoxData(
      recipe('## Details\n\n- ⏲️ Prep time: overnight plus a long second rise in the fridge\n')
    );
    expect(r.chips[0].label.length).toBeLessThanOrEqual('Prep '.length + 24);
    expect(r.chips[0].label.endsWith('…')).toBe(true);
  });
});

describe('sharedAgo', () => {
  const now = 1_800_000_000;
  const cases: [number, string][] = [
    [now - 3600, 'Shared today'],
    [now - 86400, 'Shared 1 day ago'],
    [now - 20 * 86400, 'Shared 20 days ago'],
    [now - 61 * 86400, 'Shared 2 months ago'],
    [now - 400 * 86400, 'Shared 1 year ago'],
    [now - 800 * 86400, 'Shared 2 years ago']
  ];
  it('counts days, then months, then years', () => {
    for (const [ts, text] of cases) expect(sharedAgo(ts, now)).toBe(text);
  });
});

describe('shortTime', () => {
  it('abbreviates units', () => {
    expect(shortTime('1 hour 5 mins')).toBe('1 h 5 min');
  });

  it('keeps only the leading duration of free text', () => {
    expect(shortTime('30 min active cook time, then rest')).toBe('30 min');
    expect(shortTime('10-12 hours for the meat, plus 1 hour')).toBe('10-12 h');
    expect(shortTime('15')).toBe('15');
    expect(shortTime('overnight')).toBe('overnight');
  });
});

describe('topTopics', () => {
  const groups = [
    {
      slug: 'baking',
      name: 'Baking',
      count14d: 0,
      topics: [{ slug: 'bread', name: 'Bread', count14d: 0 }]
    }
  ];
  const label = (pubkey: string, slugs: string[], ids: string[]): RelayEvent => ({
    id: 'l' + ids.join(),
    kind: 1985,
    pubkey,
    created_at: 1,
    content: '',
    sig: '',
    tags: [
      ['L', TOPIC_NAMESPACE],
      ...slugs.map((s) => ['l', s, TOPIC_NAMESPACE]),
      ...ids.map((i) => ['e', i])
    ]
  });

  it("names each event's first known topic; ignores other labelers", () => {
    const m = topTopics(
      [
        label(LABELER_PUBKEY, ['unknown', 'bread', 'baking'], ['e1']),
        label('b'.repeat(64), ['baking'], ['e2'])
      ],
      groups
    );
    expect(m.get('e1')).toBe('Bread');
    expect(m.has('e2')).toBe(false);
  });
});
