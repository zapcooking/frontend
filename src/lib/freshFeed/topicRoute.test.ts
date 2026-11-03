import { describe, expect, it } from 'vitest';
import { findTopic, freshTopicHref, parseTopicSlug, withFreshTopic } from './topicRoute';
import type { TopicGroup } from './topicList';

const groups: TopicGroup[] = [
  {
    slug: 'world-cuisines',
    name: 'World cuisines',
    count14d: 20,
    topics: [{ slug: 'japanese', name: 'Japanese food', count14d: 8 }]
  },
  {
    slug: 'sweets',
    name: 'Desserts',
    count14d: 15,
    topics: [{ slug: 'cakes', name: 'Cakes', count14d: 6 }]
  },
  {
    slug: 'cheese-dairy',
    name: 'Cheese and dairy',
    count14d: 4,
    topics: [{ slug: 'cheese', name: 'Cheese', count14d: 4 }]
  }
];

describe('Fresh topic deep links', () => {
  it('keeps Japanese, Desserts and Cheese as distinct filtered Fresh destinations', () => {
    const slugs = ['japanese', 'sweets', 'cheese-dairy'];
    const urls = slugs.map((slug) => new URL(freshTopicHref(slug), 'https://zap.cooking'));
    expect(new Set(urls.map((url) => url.href)).size).toBe(3);
    for (let i = 0; i < slugs.length; i++) {
      expect(urls[i].pathname).toBe('/feed');
      expect(urls[i].searchParams.get('tab')).toBe('fresh');
      expect(findTopic(groups, urls[i].searchParams.get('topic')!)?.slug).toBe(slugs[i]);
    }
  });

  it('resolves both group feeds and individual topics using the relay catalog names', () => {
    expect(findTopic(groups, 'japanese')).toMatchObject({ name: 'Japanese food', count14d: 8 });
    expect(findTopic(groups, 'sweets')).toMatchObject({ name: 'Desserts', count14d: 15 });
    expect(findTopic(groups, 'cheese-dairy')).toMatchObject({ name: 'Cheese and dairy' });
    expect(findTopic(groups, 'not-a-supported-topic')).toBeNull();
    expect(findTopic([], 'japanese')).toBeNull();
  });

  it('rejects malformed and injected filters before any relay query can be formed', () => {
    for (const value of [
      null,
      undefined,
      '',
      'Japanese',
      'cheese dairy',
      'cheese&tab=members',
      'topic:cheese',
      '../cheese',
      'a'.repeat(65)
    ]) {
      expect(parseTopicSlug(value)).toBeNull();
    }
    expect(parseTopicSlug('cheese-dairy')).toBe('cheese-dairy');
    expect(() => freshTopicHref('cheese&tab=members')).toThrow();
  });

  it('updates the topic while preserving unrelated query state and anchors', () => {
    const current = new URL(
      'https://zap.cooking/feed?tab=global&topic=japanese&view=compact#posts'
    );
    expect(withFreshTopic(current, 'sweets')).toBe(
      '/feed?tab=fresh&topic=sweets&view=compact#posts'
    );
    expect(current.searchParams.get('topic')).toBe('japanese');
  });

  it('returning to All removes the topic instead of leaving a stale filtered reload URL', () => {
    const current = new URL('https://zap.cooking/feed?tab=fresh&topic=japanese&view=compact');
    expect(withFreshTopic(current, null)).toBe('/feed?tab=fresh&view=compact');
    expect(() => withFreshTopic(current, 'topic:cheese')).toThrow();
  });
});
