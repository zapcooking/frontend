import { describe, expect, it, vi } from 'vitest';
import { createHeadPoller, type PollerDoc } from './poller';
import type { PowPayload } from './types';

function fakeDoc(initial: 'visible' | 'hidden' = 'visible') {
  let state = initial;
  const handlers = new Set<() => void>();
  const doc: PollerDoc = {
    get visibilityState() {
      return state;
    },
    addEventListener: (_t, fn) => handlers.add(fn),
    removeEventListener: (_t, fn) => handlers.delete(fn)
  };
  return {
    doc,
    set(next: 'visible' | 'hidden') {
      state = next;
      handlers.forEach((fn) => fn());
    }
  };
}

function fakeTimers() {
  const timers = new Map<number, () => void>();
  let id = 0;
  return {
    setTimer: (fn: () => void) => {
      timers.set(++id, fn);
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    pending: () => timers.size,
    async fire() {
      const [[key, fn]] = [...timers.entries()];
      timers.delete(key);
      await fn();
    }
  };
}

/** A server whose head says `headEtag` and whose ?v= returns `served`. */
function fakeServer(state: { headEtag: string; served: string }) {
  const calls: Array<{ url: string; ifNoneMatch?: string }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const ifNoneMatch = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
    calls.push({ url, ifNoneMatch });
    if (url === '/api/pow/head') {
      if (ifNoneMatch === `"${state.headEtag.replace(/^W\//, '').replace(/"/g, '')}"`) {
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify({ latestId: 'x', updatedAt: 'y', etag: state.headEtag }));
    }
    return new Response(JSON.stringify({ dataVersion: state.served, totals: { prs: 1 } }));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function setup(opts: { visible?: boolean; headEtag?: string; served?: string } = {}) {
  const d = fakeDoc(opts.visible === false ? 'hidden' : 'visible');
  const t = fakeTimers();
  const state = { headEtag: opts.headEtag ?? '"v1"', served: opts.served ?? 'v1' };
  const s = fakeServer(state);
  const onSummary = vi.fn((_p: PowPayload) => {});
  const poller = createHeadPoller({
    version: 'v1',
    onSummary,
    fetchImpl: s.fetchImpl,
    doc: d.doc,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer
  });
  return { d, t, s, state, onSummary, poller };
}

describe('createHeadPoller', () => {
  it('polls on an interval while visible, with the rendered version as If-None-Match', async () => {
    const { t, s, poller, onSummary } = setup();
    poller.start();
    expect(t.pending()).toBe(1);
    await t.fire();
    expect(s.calls).toEqual([{ url: '/api/pow/head', ifNoneMatch: '"v1"' }]);
    expect(onSummary).not.toHaveBeenCalled(); // 304
    expect(t.pending()).toBe(1); // rescheduled
  });

  it('pauses while hidden and polls immediately on becoming visible', async () => {
    const { d, t, s, poller } = setup({ visible: false });
    poller.start();
    expect(t.pending()).toBe(0);

    d.set('visible');
    await vi.waitFor(() => expect(s.calls).toHaveLength(1)); // immediately, no timer fire
    await vi.waitFor(() => expect(t.pending()).toBe(1));

    d.set('hidden');
    expect(t.pending()).toBe(0);
    poller.stop();
  });

  it('on an etag change, fetches ?v=<version> and renders it', async () => {
    const { t, s, state, poller, onSummary } = setup();
    state.headEtag = 'W/"v2"'; // weakened on the way, still version v2
    state.served = 'v2';
    poller.start();
    await t.fire();
    expect(s.calls.map((c) => c.url)).toEqual(['/api/pow/head', '/api/pow?v=v2']);
    expect(onSummary).toHaveBeenCalledTimes(1);
    expect(onSummary.mock.calls[0][0].dataVersion).toBe('v2');
    expect(poller.version).toBe('v2');
  });

  it('never renders a mismatched ?v= body, and retries on the next poll', async () => {
    const { t, s, state, poller, onSummary } = setup();
    state.headEtag = '"v2"';
    state.served = 'v1'; // this location's KV hasn't caught up yet
    poller.start();
    await t.fire();
    expect(onSummary).not.toHaveBeenCalled();
    expect(poller.version).toBe('v1');

    state.served = 'v2';
    await t.fire();
    expect(s.calls.filter((c) => c.url.startsWith('/api/pow?v=')).length).toBe(2);
    expect(onSummary).toHaveBeenCalledTimes(1);
    expect(poller.version).toBe('v2');
  });

  it('survives a network failure and keeps polling; stop() clears the timer', async () => {
    const t = fakeTimers();
    const onSummary = vi.fn();
    const p = createHeadPoller({
      version: 'v1',
      onSummary,
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      doc: fakeDoc().doc,
      setTimer: t.setTimer,
      clearTimer: t.clearTimer
    });
    p.start();
    await t.fire();
    expect(onSummary).not.toHaveBeenCalled();
    expect(t.pending()).toBe(1);
    p.stop();
    expect(t.pending()).toBe(0);
  });
});
