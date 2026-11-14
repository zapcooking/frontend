import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WatchPolicy,
  NO_PICTURE_MS,
  STALL_MS,
  MAX_ATTEMPTS,
  retryDelayMs,
  decodedVideoFrames,
  type WatchStop
} from './watchPolicy';
import { classifyJoinReply, joinLiveSession, loadPass, savePass } from './joinClient';

// ── WatchPolicy ─────────────────────────────────────────────────────
let now = 0;
let rejoins: string[];
let stops: WatchStop[];
let timers: { fn: () => void; at: number }[];

function makePolicy() {
  return new WatchPolicy(
    {
      rejoin: (r) => rejoins.push(r),
      stop: (r) => stops.push(r),
      setTimer: (fn, ms) => {
        const t = { fn, at: now + ms };
        timers.push(t);
        return t;
      },
      clearTimer: (h) => {
        timers = timers.filter((t) => t !== h);
      }
    },
    () => now
  );
}

/** Advance the clock, firing due timers. */
function advance(ms: number) {
  now += ms;
  for (const t of [...timers].sort((a, b) => a.at - b.at)) {
    if (t.at <= now && timers.includes(t)) {
      timers = timers.filter((x) => x !== t);
      t.fn();
    }
  }
}

beforeEach(() => {
  now = 0;
  rejoins = [];
  stops = [];
  timers = [];
});

function joined(p: WatchPolicy) {
  p.joinStarted();
  p.joinSucceeded();
}

describe('WatchPolicy', () => {
  it('rejoins when no picture arrives within 8 s of a join', () => {
    const p = makePolicy();
    joined(p);
    for (let t = 1000; t < NO_PICTURE_MS; t += 1000) {
      advance(1000);
      p.frames(0);
    }
    expect(rejoins).toEqual([]);
    advance(1000);
    p.frames(0);
    advance(0);
    expect(rejoins).toEqual(['no_picture']);
  });

  it('keeps watching while frames advance, and rejoins after a 4 s stall', () => {
    const p = makePolicy();
    joined(p);
    for (let i = 1; i <= 20; i++) {
      advance(1000);
      p.frames(i * 30);
    }
    expect(rejoins).toEqual([]);
    for (let i = 0; i < STALL_MS / 1000; i++) {
      advance(1000);
      p.frames(600);
    }
    advance(0);
    expect(rejoins).toEqual(['stalled']);
  });

  it('never rejoins from a hidden tab; a rejoin that came due waits for the tab to be visible', () => {
    const p = makePolicy();
    joined(p);
    advance(1000);
    p.frames(30);
    p.setHidden(true);
    for (let i = 0; i < 60; i++) {
      advance(1000);
      p.frames(30); // paused in the background
    }
    expect(rejoins).toEqual([]);

    // A retry that comes due while hidden is held, then runs on return.
    p.joinStarted();
    p.joinFailed('not_live');
    advance(retryDelayMs(0));
    expect(rejoins).toEqual([]);
    p.setHidden(false);
    advance(0);
    expect(rejoins).toEqual(['retry']);
  });

  it('gives the video a fresh grace period after the tab comes back', () => {
    const p = makePolicy();
    joined(p);
    advance(1000);
    p.frames(30);
    p.setHidden(true);
    advance(30_000);
    p.setHidden(false);
    advance(1000);
    p.frames(30);
    advance(0);
    expect(rejoins).toEqual([]);
  });

  it('retries "not live" and failures with backoff, resetting after a picture', () => {
    const p = makePolicy();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      p.joinStarted();
      p.joinFailed(i % 2 ? 'retry' : 'not_live');
      const t = timers[timers.length - 1];
      waits.push(t.at - now);
      advance(t.at - now);
    }
    expect(waits).toEqual([2000, 4000, 8000, 15000, 15000, 15000]);

    joined(p);
    advance(1000);
    p.frames(30);
    p.joinStarted();
    p.joinFailed('retry');
    expect(timers[timers.length - 1].at - now).toBe(2000);
  });

  it('stops for good on ended, off and full', () => {
    for (const failure of ['ended', 'off', 'full'] as const) {
      stops = [];
      const p = makePolicy();
      p.joinStarted();
      p.joinFailed(failure);
      advance(60_000);
      expect(stops).toEqual([failure]);
    }
    expect(rejoins).toEqual([]);
  });

  it(`gives up after ${MAX_ATTEMPTS} joins`, () => {
    const p = makePolicy();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      p.joinStarted();
      p.joinFailed('retry');
      advance(15_000);
    }
    expect(stops).toEqual(['gave_up']);
    expect(rejoins.length).toBe(MAX_ATTEMPTS - 1);
  });

  it('does nothing after shutdown', () => {
    const p = makePolicy();
    p.joinStarted();
    p.joinFailed('retry');
    p.shutdown();
    advance(60_000);
    expect(rejoins).toEqual([]);
    expect(stops).toEqual([]);
  });
});

// ── joinClient ──────────────────────────────────────────────────────
describe('decodedVideoFrames', () => {
  const report = (stats: object[]) => ({ forEach: (fn: (s: any) => void) => stats.forEach(fn) });

  it('reads framesDecoded from the inbound video entry', () => {
    expect(
      decodedVideoFrames(
        report([
          { type: 'inbound-rtp', kind: 'audio' },
          { type: 'inbound-rtp', kind: 'video', framesDecoded: 412 },
          { type: 'candidate-pair' }
        ])
      )
    ).toBe(412);
  });

  it('counts a report with no inbound video entry (no packet yet) as 0 frames', () => {
    expect(decodedVideoFrames(report([]))).toBe(0);
    expect(decodedVideoFrames(report([{ type: 'inbound-rtp', kind: 'audio' }]))).toBe(0);
  });

  it('so an answered join that never delivers media still rejoins after 8 s', () => {
    // The black dock on the preview (2026-11-14): one join, never a rejoin,
    // because a report without an inbound video entry was not judged at all.
    const p = makePolicy();
    joined(p);
    for (let t = 0; t <= NO_PICTURE_MS; t += 1000) {
      advance(1000);
      p.frames(decodedVideoFrames(report([{ type: 'transport' }])));
    }
    advance(0);
    expect(rejoins).toEqual(['no_picture']);
  });
});

describe('classifyJoinReply', () => {
  it('maps every server reply to what the player does', () => {
    expect(classifyJoinReply(410, 'ended')).toBe('ended');
    expect(classifyJoinReply(404, 'not_found')).toBe('ended');
    expect(classifyJoinReply(503, 'live_off')).toBe('off');
    expect(classifyJoinReply(403, 'full')).toBe('full');
    expect(classifyJoinReply(409, 'not_live')).toBe('not_live');
    expect(classifyJoinReply(503, 'stream_unavailable')).toBe('retry');
    expect(classifyJoinReply(500, undefined)).toBe('retry');
    expect(classifyJoinReply(422, 'offer_rejected')).toBe('rejected');
    expect(classifyJoinReply(413, 'too_large')).toBe('rejected');
  });
});

describe('joinLiveSession', () => {
  it('posts the offer with the pass and returns the answer and the new pass', async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['Live-Pass']).toBe('old-pass');
      expect(init.body).toBe('v=0 offer');
      return new Response('v=0 answer', { status: 201, headers: { 'Live-Pass': 'new-pass' } });
    });
    const out = await joinLiveSession(
      'a'.repeat(32),
      'v=0 offer',
      { pass: 'old-pass' },
      fetchFn as never
    );
    expect(out).toEqual({ ok: true, answerSdp: 'v=0 answer', pass: 'new-pass' });
    expect(fetchFn.mock.calls[0][0]).toBe(`/api/live/${'a'.repeat(32)}/join`);
  });

  it('reports failures as values, including network errors and a bad answer', async () => {
    const full = async () => new Response('{"error":"full"}', { status: 403 });
    expect(await joinLiveSession('a'.repeat(32), 'v=0', {}, full as never)).toEqual({
      ok: false,
      failure: 'full'
    });
    const boom = async () => {
      throw new TypeError('offline');
    };
    expect(await joinLiveSession('a'.repeat(32), 'v=0', {}, boom as never)).toEqual({
      ok: false,
      failure: 'retry'
    });
    const junk = async () => new Response('<html>', { status: 201 });
    expect(await joinLiveSession('a'.repeat(32), 'v=0', {}, junk as never)).toEqual({
      ok: false,
      failure: 'retry'
    });
  });
});

describe('pass storage', () => {
  it('keeps one pass per session, and survives storage that throws', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v)
    };
    savePass(storage, 's1', 'p1');
    savePass(storage, 's1', null);
    expect(loadPass(storage, 's1')).toBe('p1');
    expect(loadPass(storage, 's2')).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    };
    expect(() => savePass(broken, 's1', 'p')).not.toThrow();
    expect(loadPass(broken, 's1')).toBeNull();
    expect(loadPass(undefined, 's1')).toBeNull();
  });
});
