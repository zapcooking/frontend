import { describe, it, expect, vi, beforeEach } from 'vitest';

const published: { tags: string[][]; created_at: number; content: string }[] = [];
vi.mock('$lib/nip65Routing', () => ({
  getOwnWriteRelays: async () => ['wss://puravida.nostr.land', 'wss://pyramid.fiatjaf.com']
}));
vi.mock('$lib/nostr', () => ({ getCurrentRelays: () => ['wss://nos.lol', 'wss://nostr.wine'] }));
vi.mock('$lib/outboxPublish', () => ({ outboxRelaySet: async () => undefined }));
vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKEvent: class {
    kind = 0;
    content = '';
    tags: string[][] = [];
    created_at?: number;
    async sign() {}
    async publish() {
      published.push({ tags: this.tags, created_at: this.created_at!, content: this.content });
    }
  }
}));

import { updateFollows, readFollowLists, FollowSafetyError, type QueryRelay } from './followUpdate';
import { resetSeenForTests, type ContactList } from './followSafety';

const ME = 'a'.repeat(64);
const list = (created_at: number, n: number): ContactList => ({
  id: `l${created_at}`,
  created_at,
  tags: Array.from({ length: n }, (_, i) => ['p', `f${i}`]),
  content: ''
});
const NEW = list(1_790_000_000, 1096); // Sep 30 (purplepag, puravida)
const OLD = list(1_768_000_000, 978); // Jan (nostr.wine)

/** Seth's relays as measured 2026-10-07, with optional delays and failures. */
function relays(
  o: { purpleDelay?: number; down?: string[]; purpleList?: ContactList | null } = {}
): QueryRelay {
  return async (url) => {
    if (o.down?.includes(url)) return { url, ok: false, list: null };
    if (url === 'wss://purplepag.es') {
      if (o.purpleDelay) await new Promise((r) => setTimeout(r, o.purpleDelay));
      return { url, ok: true, list: o.purpleList === undefined ? NEW : o.purpleList };
    }
    if (url === 'wss://puravida.nostr.land') return { url, ok: true, list: NEW };
    if (url === 'wss://nostr.wine') return { url, ok: true, list: OLD };
    return { url, ok: true, list: null };
  };
}

beforeEach(() => {
  published.length = 0;
  resetSeenForTests();
});

describe('updateFollows', () => {
  it('normal add: reads every relay, adds one to the newest list (1096 → 1097)', async () => {
    const f = await updateFollows({} as never, ME, { add: ['someone'] }, relays());
    expect(f.size).toBe(1097);
    expect(published).toHaveLength(1);
    expect(published[0].tags.filter((t) => t[0] === 'p')).toHaveLength(1097);
    expect(published[0].created_at).toBeGreaterThan(NEW.created_at);
  });

  it('waits for a slow purplepag (4 s) instead of settling for the older list', async () => {
    vi.useFakeTimers();
    try {
      const p = updateFollows({} as never, ME, { add: ['someone'] }, relays({ purpleDelay: 4000 }));
      await vi.advanceTimersByTimeAsync(4000);
      await p;
      expect(published[0].tags.filter((t) => t[0] === 'p')).toHaveLength(1097);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no answers: refuses with a clear error and publishes nothing', async () => {
    const all = [
      'wss://purplepag.es',
      'wss://puravida.nostr.land',
      'wss://pyramid.fiatjaf.com',
      'wss://nos.lol',
      'wss://nostr.wine'
    ];
    await expect(
      updateFollows({} as never, ME, { add: ['x'] }, relays({ down: all }))
    ).rejects.toBeInstanceOf(FollowSafetyError);
    expect(published).toHaveLength(0);
  });

  it('stale older list: after seeing Sep 30’s 1096, a read that only finds January’s 978 refuses', async () => {
    await readFollowLists(ME, relays()); // this session saw 1096
    const staleOnly: QueryRelay = async (url) =>
      url === 'wss://nostr.wine' || url === 'wss://purplepag.es'
        ? { url, ok: true, list: OLD }
        : { url, ok: true, list: null };
    const err = await updateFollows({} as never, ME, { add: ['x'] }, staleOnly).catch((e) => e);
    expect(err).toBeInstanceOf(FollowSafetyError);
    expect(err.reason).toBe('stale');
    expect(published).toHaveLength(0);
  });

  it('two unfollows in a row: the second isn’t refused as "smaller" than the first’s baseline', async () => {
    let current = NEW;
    const live: QueryRelay = async (url) => ({
      url,
      ok: true,
      list: url === 'wss://purplepag.es' ? current : null
    });
    await updateFollows({} as never, ME, { remove: ['f1'] }, live);
    current = { ...current, created_at: published[0].created_at, tags: published[0].tags };
    await updateFollows({} as never, ME, { remove: ['f2'] }, live);
    expect(published).toHaveLength(2);
    expect(published[1].tags.filter((t) => t[0] === 'p')).toHaveLength(1094);
  });
});
