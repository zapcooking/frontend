import { describe, it, expect, vi } from 'vitest';

// liveNow reads `browser` to decide whether to start timers; none are needed
// to test the request shape.
vi.mock('$app/environment', () => ({ browser: false }));

import { liveLookupFilters, mergeEventLists } from './liveNow';
import { StreamDirectory, LIVE_ANNOUNCEMENT_MAX_AGE_S } from './directory';
import type { NostrEventLike } from './types';

const NOW = 1_794_000_000;
/** A host who streams through a service (zap.stream): the service is the author. */
const SERVICE_HOST = '55f04590674f3648f4cdc9dc8ce32da2a282074cd0b020596ee033d12d385185';
const SERVICE_ACCOUNT = 'cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5';
/** A host who publishes their own announcements, with no `p` tag at all. */
const SELF_HOST = '312d00fa00000000000000000000000000000000000000000000000000000001';

function announcement(over: Partial<NostrEventLike> & { id: string }, tags: string[][]): NostrEventLike {
  return {
    pubkey: SERVICE_ACCOUNT,
    created_at: NOW - 30,
    kind: 30311,
    content: '',
    sig: 'f'.repeat(128),
    ...over,
    tags: [['d', over.id.slice(0, 8)], ['status', 'live'], ['streaming', `https://cdn.example/${over.id.slice(0, 8)}.m3u8`], ...tags]
  };
}

/** The relay-side matching rule: every field in ONE filter must hold (AND). */
function matches(filter: Record<string, unknown>, event: NostrEventLike): boolean {
  const authors = filter.authors as string[] | undefined;
  const ptags = filter['#p'] as string[] | undefined;
  const since = filter.since as number | undefined;
  if (authors && !authors.includes(event.pubkey)) return false;
  if (ptags && !event.tags.some((t) => t[0] === 'p' && ptags.includes(t[1]))) return false;
  if (since !== undefined && event.created_at < since) return false;
  return (filter.kinds as number[]).includes(event.kind);
}

const serviceStream = announcement({ id: 'a'.repeat(64) }, [['p', SERVICE_HOST, '', 'host']]);
const selfStream = announcement({ id: 'b'.repeat(64), pubkey: SELF_HOST }, []);

describe('liveLookupFilters', () => {
  const filters = liveLookupFilters([SERVICE_HOST, SELF_HOST], NOW);

  it('asks two separate questions, never authors AND #p in one filter', () => {
    expect(filters).toHaveLength(2);
    expect(filters.some((f) => f.authors && !f['#p'])).toBe(true);
    expect(filters.some((f) => f['#p'] && !f.authors)).toBe(true);
    expect(filters.every((f) => !(f.authors && f['#p']))).toBe(true);
  });

  it('asks about every watched host in both', () => {
    for (const f of filters) {
      expect(f.authors ?? f['#p']).toEqual([SERVICE_HOST, SELF_HOST]);
    }
  });

  it('only asks for announcements fresh enough to count as live', () => {
    for (const f of filters) expect(f.since).toBe(NOW - LIVE_ANNOUNCEMENT_MAX_AGE_S);
  });

  it('scales the result limit with the batch', () => {
    expect(liveLookupFilters(['a'], NOW)[0].limit).toBe(100);
    expect(liveLookupFilters(Array.from({ length: 80 }, (_, i) => String(i)), NOW)[0].limit).toBe(160);
  });
});

describe('finding streams published by a service account', () => {
  it('REGRESSION: the old single combined filter never matches them', () => {
    const old = { kinds: [30311], authors: [SERVICE_HOST], '#p': [SERVICE_HOST] };
    // authored by the service, host only in a p tag -> fails the authors half
    expect(matches(old, serviceStream)).toBe(false);
    // authored by the host but untagged -> fails the #p half
    expect(matches({ ...old, authors: [SELF_HOST], '#p': [SELF_HOST] }, selfStream)).toBe(false);
  });

  it('the two filters between them match both kinds of stream', () => {
    const filters = liveLookupFilters([SERVICE_HOST, SELF_HOST], NOW);
    const found = (event: NostrEventLike) => filters.some((f) => matches(f, event));
    expect(found(serviceStream)).toBe(true);
    expect(found(selfStream)).toBe(true);
  });

  it('does not ask for stale announcements', () => {
    const stale = announcement({ id: 'c'.repeat(64), created_at: NOW - 2 * 3600 }, [['p', SERVICE_HOST, '', 'host']]);
    const filters = liveLookupFilters([SERVICE_HOST], NOW);
    expect(filters.some((f) => matches(f, stale))).toBe(false);
  });

  it('end to end: the directory resolves each as live for its own host', () => {
    const directory = new StreamDirectory(50);
    for (const event of mergeEventLists([[serviceStream], [selfStream, serviceStream]])) {
      directory.accept(event, NOW);
    }
    const liveHosts = directory.live(NOW).map((item) => item.host).sort();
    expect(liveHosts).toEqual([SERVICE_HOST, SELF_HOST].sort());
  });
});

describe('mergeEventLists', () => {
  it('keeps each event once however many requests returned it', () => {
    const merged = mergeEventLists([[serviceStream, selfStream], [serviceStream]]);
    expect(merged.map((e) => e.id).sort()).toEqual([serviceStream.id, selfStream.id].sort());
  });

  it('handles empty answers', () => {
    expect(mergeEventLists([[], []])).toEqual([]);
  });
});
