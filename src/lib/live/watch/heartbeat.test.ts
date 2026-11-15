import { describe, it, expect, vi } from 'vitest';
import { writable } from 'svelte/store';
import {
  heartbeatCode,
  heartbeatTarget,
  sendHeartbeat,
  startHeartbeat,
  type BeatOutcome,
  type HeartbeatInput
} from './heartbeat';
import { endedStatsLine } from '$lib/live/host/hostApi';
import { sessionToStreamItem, watchingCount, watchingLabel } from '$lib/streams/goLive';
import type { StreamItem } from '$lib/streams/types';

const HOST = 'f'.repeat(64);
const SID = 'a'.repeat(32);

function goLiveItem(over: Partial<StreamItem> = {}): StreamItem {
  return {
    ...sessionToStreamItem({
      id: SID,
      status: 'live',
      title: 'T',
      recipe_a: null,
      host_pubkey: HOST,
      created_at: 1,
      started_at: 1,
      ended_at: null
    }),
    ...over
  };
}

describe('heartbeatCode', () => {
  it('is 32 hex chars and the same for the whole page load', () => {
    expect(heartbeatCode()).toMatch(/^[0-9a-f]{32}$/);
    expect(heartbeatCode()).toBe(heartbeatCode());
  });
});

describe('heartbeatTarget', () => {
  const playing = (item: StreamItem | null, status: HeartbeatInput['status'] = 'playing') => ({
    item,
    status
  });

  it('beats for a playing Go live stream in a visible tab', () => {
    expect(heartbeatTarget(playing(goLiveItem()), null, false)).toBe(SID);
    expect(heartbeatTarget(playing(goLiveItem(), 'buffering'), 'e'.repeat(64), false)).toBe(SID);
  });

  it('does not beat when hidden, not playing, ended, Nostr, or for the host', () => {
    expect(heartbeatTarget(playing(goLiveItem()), null, true)).toBeNull();
    expect(heartbeatTarget(playing(goLiveItem(), 'connecting'), null, false)).toBeNull();
    expect(heartbeatTarget(playing(goLiveItem(), 'full'), null, false)).toBeNull();
    expect(heartbeatTarget(playing(goLiveItem({ status: 'ended' })), null, false)).toBeNull();
    expect(heartbeatTarget(playing(goLiveItem({ source: 'nostr' })), null, false)).toBeNull();
    expect(heartbeatTarget(playing(goLiveItem()), HOST, false)).toBeNull();
    expect(heartbeatTarget(playing(null), null, false)).toBeNull();
  });
});

describe('sendHeartbeat', () => {
  it('sends only the code, with no credentials', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ watching: 3 })));
    expect(await sendHeartbeat(SID, 'c'.repeat(32), fetchFn as any)).toEqual({
      kind: 'counted',
      watching: 3
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/live/${SID}/heartbeat`);
    expect(init.body).toBe(JSON.stringify({ code: 'c'.repeat(32) }));
    expect(init.credentials).toBe('omit');
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('stops on ended or unknown, keeps going otherwise', async () => {
    const reply = (status: number) => async () => new Response('{}', { status });
    expect(await sendHeartbeat(SID, 'c'.repeat(32), reply(410) as any)).toEqual({ kind: 'stop' });
    expect(await sendHeartbeat(SID, 'c'.repeat(32), reply(404) as any)).toEqual({ kind: 'stop' });
    expect(await sendHeartbeat(SID, 'c'.repeat(32), reply(429) as any)).toEqual({ kind: 'skip' });
    expect(
      await sendHeartbeat(SID, 'c'.repeat(32), (async () => {
        throw new Error('offline');
      }) as any)
    ).toEqual({ kind: 'skip' });
  });
});

describe('startHeartbeat', () => {
  function harness(outcome: BeatOutcome = { kind: 'counted', watching: 2 }) {
    const player = writable<HeartbeatInput>({ item: null, status: 'idle' });
    const viewer = writable<string | null>(null);
    let hidden = false;
    let visibility: () => void = () => {};
    const timers: (() => void)[] = [];
    const sent: string[] = [];
    const counts: number[] = [];
    const stop = startHeartbeat({
      player,
      viewer,
      isHidden: () => hidden,
      onVisibility: (fn) => {
        visibility = fn;
        return () => {};
      },
      onCount: (_id, n) => counts.push(n),
      send: async (id) => {
        sent.push(id);
        return outcome;
      },
      setTimer: (fn) => timers.push(fn) - 1,
      clearTimer: (h) => {
        timers[h as number] = () => {};
      }
    });
    return {
      player,
      viewer,
      sent,
      counts,
      timers,
      stop,
      setHidden(h: boolean) {
        hidden = h;
        visibility();
      }
    };
  }

  it('beats at once when playing starts, then on the timer, and reports counts', async () => {
    const h = harness();
    h.player.set({ item: goLiveItem(), status: 'playing' });
    await Promise.resolve();
    expect(h.sent).toEqual([SID]);
    // Store updates that do not change the target do not beat again.
    h.player.set({ item: goLiveItem({ viewers: 2 }), status: 'playing' });
    expect(h.sent).toEqual([SID]);
    h.timers[0]();
    await Promise.resolve();
    expect(h.sent).toEqual([SID, SID]);
    expect(h.counts).toEqual([2, 2]);
  });

  it('pauses while hidden and beats again on return', async () => {
    const h = harness();
    h.player.set({ item: goLiveItem(), status: 'playing' });
    h.setHidden(true);
    h.timers[0]();
    expect(h.sent).toEqual([SID]);
    h.setHidden(false);
    expect(h.sent).toEqual([SID, SID]);
  });

  it('never beats for the host', () => {
    const h = harness();
    h.viewer.set(HOST);
    h.player.set({ item: goLiveItem(), status: 'playing' });
    expect(h.sent).toEqual([]);
  });

  it('gives up on a session the server says is over', async () => {
    const h = harness({ kind: 'stop' });
    h.player.set({ item: goLiveItem(), status: 'playing' });
    await Promise.resolve();
    await Promise.resolve();
    h.player.set({ item: goLiveItem(), status: 'buffering' });
    h.setHidden(true);
    h.setHidden(false);
    expect(h.sent).toEqual([SID]);
  });
});

describe('display', () => {
  it('shows a count from 1 up, nothing for 0 or unknown', () => {
    expect(watchingCount(1)).toBe(1);
    expect(watchingCount(0)).toBeNull();
    expect(watchingCount(null)).toBeNull();
    expect(watchingCount(2.5)).toBeNull();
    expect(watchingLabel(1)).toBe('1 watching');
    expect(sessionToStreamItem({ ...goLiveSession(), watching: 4 }).viewers).toBe(4);
    expect(sessionToStreamItem({ ...goLiveSession(), watching: 0 }).viewers).toBeNull();
  });

  it('writes the ended line, with sats only when there are some', () => {
    expect(endedStatsLine({ peakWatching: 12, joins: 30 }, 2100)).toBe(
      `Peak 12 watching · 30 joins · ${(2100).toLocaleString()} sats`
    );
    expect(endedStatsLine({ peakWatching: 1, joins: 1 }, 0)).toBe('Peak 1 watching · 1 join');
  });
});

function goLiveSession() {
  return {
    id: SID,
    status: 'live' as const,
    title: 'T',
    recipe_a: null,
    host_pubkey: HOST,
    created_at: 1,
    started_at: 1,
    ended_at: null
  };
}
