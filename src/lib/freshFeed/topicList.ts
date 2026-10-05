import { FRESH_RELAY_URL } from './relay';

/**
 * The feed relay's topic list, from its NIP-11 document (`topics`; see
 * feed-relay #76): groups ("parents") of topics, each a slug and a name.
 * A group's slug also works as a feed (the relay expands it to its topics).
 * One HTTP GET per session; nothing is sent but the request itself.
 */

export interface Topic {
  slug: string;
  name: string;
}

export interface TopicGroup extends Topic {
  topics: Topic[];
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The `topics` field of a NIP-11 document, validated; [] when absent or malformed. */
export function parseTopics(doc: unknown): TopicGroup[] {
  const t = (doc as { topics?: { parents?: unknown } } | null)?.topics;
  const parents = t?.parents;
  if (!Array.isArray(parents)) return [];
  const ok = (x: unknown): x is Topic =>
    !!x &&
    typeof (x as Topic).slug === 'string' &&
    SLUG.test((x as Topic).slug) &&
    typeof (x as Topic).name === 'string' &&
    (x as Topic).name.length > 0;
  const out: TopicGroup[] = [];
  for (const p of parents) {
    if (!ok(p)) continue;
    const topics = Array.isArray((p as TopicGroup).topics)
      ? (p as TopicGroup).topics.filter(ok)
      : [];
    if (topics.length === 0) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      topics: topics.map((x) => ({ slug: x.slug, name: x.name }))
    });
  }
  return out;
}

/** The relay's HTTP URL for NIP-11 (wss:// → https://). */
export function nip11Url(relayUrl = FRESH_RELAY_URL): string {
  return relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

let cached: Promise<TopicGroup[]> | null = null;

/** The topic list, fetched once per session ([] on failure, retried next call). */
export function loadTopics(fetchFn: typeof fetch = fetch): Promise<TopicGroup[]> {
  if (cached) return cached;
  cached = fetchFn(nip11Url(), { headers: { Accept: 'application/nostr+json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseTopics)
    .then((groups) => {
      if (groups.length === 0) cached = null;
      return groups;
    })
    .catch(() => {
      cached = null;
      return [];
    });
  return cached;
}

export function resetTopicsForTests(): void {
  cached = null;
}
