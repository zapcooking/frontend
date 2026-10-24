import { describe, it, expect } from 'vitest';
import { buildTopicChips, sheetGroups, FALLBACK_FEATURED, GROUP_SHORT_LABELS } from './topicChips';
import type { TopicGroup } from './topicList';

const g = (
  slug: string,
  name: string,
  count14d: number,
  topics: [string, string, number][]
): TopicGroup => ({
  slug,
  name,
  count14d,
  topics: topics.map(([s, n, c]) => ({ slug: s, name: n, count14d: c }))
});

// Shaped like the live relay (counts illustrative).
const GROUPS = [
  g('baking', 'Baking', 27, [
    ['sourdough', 'Sourdough', 6],
    ['bread', 'Bread', 11],
    ['cakes', 'Cakes', 3]
  ]),
  g('meat-seafood', 'Meat & seafood', 40, [['beef', 'Beef', 20]]),
  g('meals', 'Meals', 55, [['soups-stews', 'Soups & stews', 5]]),
  g('world-cuisines', 'World cuisines', 30, [['japanese', 'Japanese', 4]]),
  g('growing-sourcing', 'Growing & sourcing', 12, [
    ['gardening', 'Gardening', 0],
    ['homesteading', 'Homesteading', 2],
    ['cheese-dairy', 'Cheese & dairy', 1]
  ]),
  g('drinks', 'Drinks', 18, [['coffee', 'Coffee', 9]]),
  g('sweets', 'Sweets', 0, [['desserts', 'Desserts', 0]])
];

const FEATURED = FALLBACK_FEATURED; // the relay's current list is the same

describe('the chip row', () => {
  const chips = buildTopicChips(GROUPS, FEATURED);
  const labels = chips.map((c) => c.label);

  it('All, the featured topics in their exact order, activity groups, More', () => {
    expect(labels).toEqual([
      'All',
      'Meat',
      'Soups',
      'Japanese',
      'Garden',
      'Cakes',
      'Cheese',
      'Homestead',
      'Meals',
      'World',
      'Baking',
      'More'
    ]);
  });

  it('featured chips show even with no recent posts (Garden: 0)', () => {
    expect(chips.find((c) => c.slug === 'gardening')).toMatchObject({
      kind: 'featured',
      label: 'Garden'
    });
  });

  it('a featured group is never repeated as an activity chip (no second Meat)', () => {
    expect(chips.filter((c) => c.slug === 'meat-seafood')).toHaveLength(1);
    expect(labels.filter((l) => l === 'Meat')).toHaveLength(1);
  });

  it('activity chips: the 3 busiest groups, short labels, quiet groups left out', () => {
    expect(chips.filter((c) => c.kind === 'activity').map((c) => [c.slug, c.label])).toEqual([
      ['meals', 'Meals'],
      ['world-cuisines', 'World'],
      ['baking', 'Baking']
    ]);
    expect(chips.some((c) => c.slug === 'sweets')).toBe(false);
  });

  it('featured entries can be group or topic slugs; full names kept for headings', () => {
    expect(chips.find((c) => c.slug === 'meat-seafood')?.name).toBe('Meat & seafood');
    expect(chips.find((c) => c.slug === 'cheese-dairy')?.name).toBe('Cheese & dairy');
  });

  it('falls back to the default list when NIP-11 has no featured_topics', () => {
    expect(
      buildTopicChips(GROUPS, null)
        .map((c) => c.label)
        .slice(1, 8)
    ).toEqual(['Meat', 'Soups', 'Japanese', 'Garden', 'Cakes', 'Cheese', 'Homestead']);
  });

  it('skips featured slugs the relay does not know, and duplicates', () => {
    const c = buildTopicChips(GROUPS, [
      { slug: 'nope', label: 'Nope' },
      { slug: 'beef', label: 'Beef' },
      { slug: 'beef', label: 'Beef again' }
    ]);
    expect(c.filter((x) => x.kind === 'featured').map((x) => x.label)).toEqual(['Beef']);
  });

  it('every group has a short label', () => {
    for (const grp of [
      'baking',
      'fermentation-preserving',
      'bbq-grilling',
      'meat-seafood',
      'plant-based',
      'drinks',
      'world-cuisines',
      'meals',
      'growing-sourcing',
      'sweets'
    ])
      expect(GROUP_SHORT_LABELS[grp]).toBeTruthy();
  });
});

describe('the Topics sheet', () => {
  it('keeps group order and sorts topics by recent activity (stable on ties)', () => {
    const s = sheetGroups(GROUPS);
    expect(s.map((x) => x.slug)).toEqual(GROUPS.map((x) => x.slug));
    expect(s[0].topics.map((t) => t.slug)).toEqual(['bread', 'sourdough', 'cakes']);
    expect(s[4].topics.map((t) => t.slug)).toEqual(['homesteading', 'cheese-dairy', 'gardening']);
  });
});
