import type { Topic, TopicGroup } from './topicList';

const TOPIC_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Only catalog slugs are sent to the relay's topic search. */
export function parseTopicSlug(raw: string | null | undefined): string | null {
  return raw && raw.length <= 64 && TOPIC_SLUG.test(raw) ? raw : null;
}

export function findTopic(groups: TopicGroup[], slug: string): Topic | null {
  for (const group of groups) {
    if (group.slug === slug) return group;
    const topic = group.topics.find((candidate) => candidate.slug === slug);
    if (topic) return topic;
  }
  return null;
}

/** Landing links open the same preview/member view as Fresh's topic chips. */
export function freshTopicHref(slug: string): string {
  if (!parseTopicSlug(slug)) throw new Error('Invalid food topic');
  return `/feed?tab=fresh&topic=${encodeURIComponent(slug)}`;
}

/** Keep unrelated URL state intact when selecting a topic or returning to All. */
export function withFreshTopic(current: URL, slug: string | null): string {
  const next = new URL(current);
  if (slug !== null) {
    if (!parseTopicSlug(slug)) throw new Error('Invalid food topic');
    next.searchParams.set('tab', 'fresh');
    next.searchParams.set('topic', slug);
  } else {
    next.searchParams.delete('topic');
  }
  return `${next.pathname}${next.search}${next.hash}`;
}
