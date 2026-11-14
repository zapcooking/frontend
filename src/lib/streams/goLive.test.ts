import { describe, it, expect } from 'vitest';
import {
  fetchLiveSessions,
  fetchSession,
  isGoLiveSession,
  mergeLiveItems,
  sessionToStreamItem,
  streamPath,
  type GoLiveSession
} from './goLive';
import type { StreamItem } from './types';

const HOST = 'f'.repeat(64);
const session = (over: Partial<GoLiveSession> = {}): GoLiveSession => ({
  id: 'a'.repeat(32),
  status: 'live',
  title: 'Sunday sourdough',
  recipe_a: `30023:${'b'.repeat(64)}:sourdough`,
  host_pubkey: HOST,
  created_at: 100,
  started_at: 110,
  ended_at: null,
  ...over
});

describe('sessionToStreamItem', () => {
  it('maps a session to a stream item the directory and player can use', () => {
    const item = sessionToStreamItem(session(), { title: 'Sourdough', image: 'https://img/x.jpg' });
    expect(item).toMatchObject({
      key: `zc:${'a'.repeat(32)}`,
      source: 'zapcooking',
      sessionId: 'a'.repeat(32),
      title: 'Sunday sourdough',
      url: null,
      recording: null,
      status: 'live',
      live: true,
      image: 'https://img/x.jpg',
      starts: 110,
      host: HOST,
      viewers: null,
      recipeA: `30023:${'b'.repeat(64)}:sourdough`
    });
  });

  it('reads a not-yet-started session as live and an ended one as ended', () => {
    expect(sessionToStreamItem(session({ status: 'created', started_at: null })).status).toBe(
      'live'
    );
    const ended = sessionToStreamItem(session({ status: 'ended', ended_at: 200 }));
    expect(ended.status).toBe('ended');
    expect(ended.live).toBe(false);
    expect(ended.updated).toBe(200);
  });
});

describe('streamPath', () => {
  it('sends Go live to /live/s/<id> and NIP-53 to /live/<naddr>', () => {
    expect(streamPath(sessionToStreamItem(session()))).toBe(`/live/s/${'a'.repeat(32)}`);
    const nostr = { key: `30311:${HOST}:abc`, relays: [] } as unknown as StreamItem;
    expect(streamPath(nostr)).toMatch(/^\/live\/naddr1/);
    expect(streamPath({ key: 'junk', relays: [] } as unknown as StreamItem)).toBeNull();
  });
});

describe('mergeLiveItems', () => {
  it('puts Zap Cooking streams first, newest first, then the rest in order', () => {
    const older = sessionToStreamItem(session({ id: '1'.repeat(32), started_at: 10 }));
    const newer = sessionToStreamItem(session({ id: '2'.repeat(32), started_at: 20 }));
    const n1 = { key: 'n1' } as StreamItem;
    const n2 = { key: 'n2' } as StreamItem;
    expect(mergeLiveItems([older, newer], [n1, n2]).map((i) => i.key)).toEqual([
      `zc:${'2'.repeat(32)}`,
      `zc:${'1'.repeat(32)}`,
      'n1',
      'n2'
    ]);
  });
});

describe('reading sessions', () => {
  it('accepts only well-formed sessions', () => {
    expect(isGoLiveSession(session())).toBe(true);
    expect(isGoLiveSession({ ...session(), id: '../etc' })).toBe(false);
    expect(isGoLiveSession({ ...session(), status: 'weird' })).toBe(false);
    expect(isGoLiveSession(null)).toBe(false);
  });

  it('lists sessions, dropping malformed ones, and is empty on any failure', async () => {
    const ok = async () => Response.json({ sessions: [session(), { id: 'bad' }] });
    expect((await fetchLiveSessions(ok as never)).length).toBe(1);
    expect(
      await fetchLiveSessions((async () => new Response('', { status: 500 })) as never)
    ).toEqual([]);
    expect(
      await fetchLiveSessions((async () => {
        throw new Error('offline');
      }) as never)
    ).toEqual([]);
  });

  it('reads one session: null when gone, undefined when it cannot tell', async () => {
    const id = 'a'.repeat(32);
    expect(await fetchSession(id, (async () => Response.json(session())) as never)).toEqual(
      session()
    );
    expect(
      await fetchSession(id, (async () => new Response('', { status: 404 })) as never)
    ).toBeNull();
    expect(
      await fetchSession(id, (async () => new Response('', { status: 503 })) as never)
    ).toBeUndefined();
    expect(await fetchSession('not-an-id')).toBeNull();
  });
});

describe('recipe fetch retry', () => {
  it('tries again while nothing is found, and stops when no longer wanted', async () => {
    const { fetchRecipeEventWithRetry } = await import('./recipeCard');
    const a = `30023:${'b'.repeat(64)}:sourdough`;
    const waits: number[] = [];
    let calls = 0;
    const event = { tags: [['title', 'Sourdough']] };
    const ndk = {
      fetchEvent: async () => (++calls >= 3 ? event : null)
    };
    const found = await fetchRecipeEventWithRetry(
      () => ndk as never,
      a,
      () => true,
      async (ms) => void waits.push(ms)
    );
    expect(found).toBe(event);
    expect(waits).toEqual([3000, 8000]);

    calls = -100;
    let wanted = true;
    const none = await fetchRecipeEventWithRetry(
      () => ndk as never,
      `30023:${'c'.repeat(64)}:other`,
      () => wanted,
      async () => {
        wanted = false;
      }
    );
    expect(none).toBeNull();
    expect(await fetchRecipeEventWithRetry(() => ndk as never, 'not-an-address')).toBeNull();
  });
});
