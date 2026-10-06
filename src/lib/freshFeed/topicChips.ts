import type { FeaturedTopic, Topic, TopicGroup } from './topicList';

/**
 * The chip row under the /feed tabs on Fresh:
 *   All · the featured topics (NIP-11 `featured_topics`, in that order,
 *   always shown) · up to 3 of the most active groups (by posts in the
 *   last 14 days) not already featured · More (the full Topics sheet).
 * A featured entry may be a group slug (opens the group feed) or a topic
 * slug.
 */

/** Used when the relay doesn't publish featured_topics. */
export const FALLBACK_FEATURED: FeaturedTopic[] = [
  { slug: 'meat-seafood', label: 'Meat' },
  { slug: 'soups-stews', label: 'Soups' },
  { slug: 'japanese', label: 'Japanese' },
  { slug: 'gardening', label: 'Garden' },
  { slug: 'cakes', label: 'Cakes' },
  { slug: 'cheese-dairy', label: 'Cheese' },
  { slug: 'homesteading', label: 'Homestead' }
];

/** Short chip labels for groups (activity chips); the full name otherwise. */
export const GROUP_SHORT_LABELS: Record<string, string> = {
  baking: 'Baking',
  'fermentation-preserving': 'Ferments',
  'bbq-grilling': 'BBQ',
  'meat-seafood': 'Meat',
  'plant-based': 'Plants',
  drinks: 'Drinks',
  'world-cuisines': 'World',
  meals: 'Meals',
  'growing-sourcing': 'Growing',
  sweets: 'Sweets'
};

export const ACTIVITY_CHIPS = 3;

export interface TopicChip {
  /** The feed slug ('' for All and More). */
  slug: string;
  label: string;
  /** The full name, for the topic feed's heading. */
  name: string;
  kind: 'all' | 'featured' | 'activity' | 'more';
}

export function buildTopicChips(
  groups: TopicGroup[],
  featured: FeaturedTopic[] | null
): TopicChip[] {
  const groupBySlug = new Map(groups.map((g) => [g.slug, g]));
  const topicBySlug = new Map<string, Topic>();
  for (const g of groups) for (const t of g.topics) topicBySlug.set(t.slug, t);

  const chips: TopicChip[] = [{ slug: '', label: 'All', name: 'All', kind: 'all' }];
  const used = new Set<string>();
  for (const f of featured ?? FALLBACK_FEATURED) {
    const known = groupBySlug.get(f.slug) ?? topicBySlug.get(f.slug);
    // Only slugs the relay knows can be queried; a typo would just error.
    if (!known || used.has(f.slug)) continue;
    used.add(f.slug);
    chips.push({ slug: f.slug, label: f.label, name: known.name, kind: 'featured' });
  }
  const active = groups
    .filter((g) => !used.has(g.slug) && g.count14d > 0)
    .sort((a, b) => b.count14d - a.count14d)
    .slice(0, ACTIVITY_CHIPS);
  for (const g of active) {
    chips.push({
      slug: g.slug,
      label: GROUP_SHORT_LABELS[g.slug] ?? g.name,
      name: g.name,
      kind: 'activity'
    });
  }
  chips.push({ slug: '', label: 'More', name: 'More', kind: 'more' });
  return chips;
}

/** The Topics sheet: groups as published, topics within each by recent activity. */
export function sheetGroups(groups: TopicGroup[]): TopicGroup[] {
  return groups.map((g) => ({
    ...g,
    topics: [...g.topics].sort((a, b) => b.count14d - a.count14d)
  }));
}
