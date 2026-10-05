import { FRESH_RELAY_URL } from './relay';

/**
 * The feed relay's topic list, from its NIP-11 document (`topics`):
 * groups ("parents") of topics, each a slug, a name and how many posts it
 * had in the last 14 days (`count_14d`), plus the editors' featured list
 * (`featured_topics`: slug + short label, in display order). A group's slug
 * also works as a feed (the relay expands it to its topics). One HTTP GET
 * per session; nothing is sent but the request itself.
 */

export interface Topic {
  slug: string;
  name: string;
  /** Posts in the last 14 days (0 when the relay doesn't say). */
  count14d: number;
}

export interface TopicGroup extends Topic {
  topics: Topic[];
}

export interface FeaturedTopic {
  slug: string;
  label: string;
}

export interface TopicCatalog {
  groups: TopicGroup[];
  /** From NIP-11; null when the relay doesn't publish it. */
  featured: FeaturedTopic[] | null;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface RawTopic {
  slug?: unknown;
  name?: unknown;
  count_14d?: unknown;
  topics?: unknown;
}

function okTopic(x: unknown): x is RawTopic & { slug: string; name: string } {
  const t = x as RawTopic | null;
  return (
    !!t &&
    typeof t.slug === 'string' &&
    SLUG.test(t.slug) &&
    typeof t.name === 'string' &&
    t.name.length > 0
  );
}

function count(x: RawTopic): number {
  const n = Number(x.count_14d);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The `topics` field of a NIP-11 document, validated; [] when absent or malformed. */
export function parseTopics(doc: unknown): TopicGroup[] {
  const parents = (doc as { topics?: { parents?: unknown } } | null)?.topics?.parents;
  if (!Array.isArray(parents)) return [];
  const out: TopicGroup[] = [];
  for (const p of parents) {
    if (!okTopic(p)) continue;
    const topics = Array.isArray(p.topics) ? p.topics.filter(okTopic) : [];
    if (topics.length === 0) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      count14d: count(p),
      topics: topics.map((x) => ({ slug: x.slug, name: x.name, count14d: count(x) }))
    });
  }
  return out;
}

/** `topics.featured_topics`, validated; null when the relay doesn't publish it. */
export function parseFeatured(doc: unknown): FeaturedTopic[] | null {
  const f = (doc as { topics?: { featured_topics?: unknown } } | null)?.topics?.featured_topics;
  if (!Array.isArray(f)) return null;
  return f
    .filter(
      (x): x is { slug: string; label: string } =>
        !!x &&
        typeof x.slug === 'string' &&
        SLUG.test(x.slug) &&
        typeof x.label === 'string' &&
        x.label.trim().length > 0
    )
    .map((x) => ({ slug: x.slug, label: x.label.trim() }));
}

/** The relay's HTTP URL for NIP-11 (wss:// → https://). */
export function nip11Url(relayUrl = FRESH_RELAY_URL): string {
  return relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

let cached: Promise<TopicCatalog> | null = null;

/** The topic catalog, fetched once per session (empty on failure, retried next call). */
export function loadTopics(fetchFn: typeof fetch = fetch): Promise<TopicCatalog> {
  if (cached) return cached;
  cached = fetchFn(nip11Url(), { headers: { Accept: 'application/nostr+json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => ({ groups: parseTopics(doc), featured: parseFeatured(doc) }))
    .then((catalog) => {
      if (catalog.groups.length === 0) cached = null;
      return catalog;
    })
    .catch(() => {
      cached = null;
      return { groups: [], featured: null };
    });
  return cached;
}

export function resetTopicsForTests(): void {
  cached = null;
}
