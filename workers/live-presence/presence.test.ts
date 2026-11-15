import { describe, it, expect, vi, afterEach } from 'vitest';
import { LivePresence, TOTALS_RETAIN_MS, type PresenceState } from './index';

const code = (n: number) => n.toString(16).padStart(32, '0');

function fakeState() {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  let ready: Promise<unknown> = Promise.resolve();
  const state: PresenceState & {
    data: typeof data;
    alarmAt: () => number | null;
    ready: () => Promise<unknown>;
  } = {
    data,
    alarmAt: () => alarm,
    ready: () => ready,
    blockConcurrencyWhile<T>(fn: () => Promise<T>) {
      const p = fn();
      ready = p;
      return p;
    },
    storage: {
      async get<T>(key: string) {
        return data.get(key) as T | undefined;
      },
      async put(key: string, value: unknown) {
        data.set(key, value);
      },
      async delete(keys: string[]) {
        let n = 0;
        for (const k of keys) if (data.delete(k)) n++;
        return n;
      },
      async list<T>({ prefix }: { prefix: string }) {
        return new Map([...data].filter(([k]) => k.startsWith(prefix))) as Map<string, T>;
      },
      async deleteAll() {
        data.clear();
        alarm = null;
      },
      async getAlarm() {
        return alarm;
      },
      async setAlarm(when: number) {
        alarm = when;
      }
    }
  };
  return state;
}

const beat = (o: LivePresence, c: string, ip = '203.0.113.1') =>
  o
    .fetch(
      new Request('https://presence/beat', {
        method: 'POST',
        body: JSON.stringify({ code: c, ip })
      })
    )
    .then((r) => r.json());
const watching = (o: LivePresence) =>
  o.fetch(new Request('https://presence/watching')).then((r) => r.json());

afterEach(() => vi.useRealTimers());

describe('LivePresence across a restart', () => {
  it('keeps the count when Cloudflare restarts the object', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    const a = new LivePresence(state);
    await state.ready();
    await beat(a, code(1));
    await beat(a, code(2), '198.51.100.2');
    expect(await watching(a)).toEqual({ watching: 2 });

    vi.setSystemTime(1_015_000);
    const b = new LivePresence(state); // restarted: empty memory, same storage
    await state.ready();
    expect(await watching(b)).toEqual({ watching: 2 });
    // The peak survives too: a recount is not a new peak.
    expect(await beat(b, code(1))).toEqual({ watching: 2, peak: 2, newPeak: false });
  });

  it('stores only codes and the peak, never the address', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    const a = new LivePresence(state);
    await state.ready();
    await beat(a, code(1), '203.0.113.77');
    expect([...state.data.keys()].sort()).toEqual([`c:${code(1)}`, 'peak', 'vms']);
    expect(JSON.stringify([...state.data])).not.toContain('203.0.113.77');
  });

  it('deletes each code about a second after it expires, keeping only the totals', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    const a = new LivePresence(state);
    await state.ready();
    await beat(a, code(1));
    expect(state.alarmAt()).toBe(1_061_000);
    vi.setSystemTime(1_030_000);
    await beat(a, code(2), '198.51.100.2');

    vi.setSystemTime(1_061_000);
    await a.alarm();
    expect(state.data.has(`c:${code(1)}`)).toBe(false);
    expect(state.data.has(`c:${code(2)}`)).toBe(true);
    expect(state.alarmAt()).toBe(1_091_000);

    vi.setSystemTime(1_091_000);
    await a.alarm();
    // No codes left: only the totals, kept for the sweep, with a retention alarm.
    expect([...state.data.keys()].sort()).toEqual(['idle', 'peak', 'vms']);
    expect(state.alarmAt()).toBe(1_091_000 + TOTALS_RETAIN_MS);

    vi.setSystemTime(1_091_000 + TOTALS_RETAIN_MS);
    await a.alarm();
    expect(state.data.size).toBe(0);
    expect(state.alarmAt()).toBeNull();
  });

  it('wipes storage at once when nothing was ever counted', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    const a = new LivePresence(state);
    await state.ready();
    await a.alarm();
    expect(state.data.size).toBe(0);
  });

  it('schedules cleanup before storing, and re-arms leftovers after a restart', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    // A code left in storage with no alarm (a restart between the two writes).
    await state.storage.put(`c:${code(9)}`, 990_000);
    const b = new LivePresence(state);
    await state.ready();
    expect(state.alarmAt()).toBe(1_001_000);
    expect(await watching(b)).toEqual({ watching: 1 });
  });
});

const totals = (o: LivePresence) =>
  o.fetch(new Request('https://presence/totals')).then((r) => r.json());
const finish = (o: LivePresence) =>
  o.fetch(new Request('https://presence/finish', { method: 'POST' })).then((r) => r.json());

describe('LivePresence viewer time', () => {
  it('adds the time between heartbeats of a counted code, capped at one window', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    const a = new LivePresence(state);
    await state.ready();
    await beat(a, code(1)); // first beat: nothing yet
    expect(await totals(a)).toEqual({ viewer_seconds: 0, peak: 1 });
    vi.setSystemTime(1_030_000);
    await beat(a, code(1)); // +30 s
    await beat(a, code(2), '198.51.100.2'); // new: nothing
    vi.setSystemTime(1_059_000);
    await beat(a, code(1)); // +29 s
    await beat(a, code(2), '198.51.100.2'); // +29 s
    expect(await totals(a)).toEqual({ viewer_seconds: 88, peak: 2 });
    // A code gone quiet past the window starts again from nothing.
    vi.setSystemTime(1_200_000);
    await beat(a, code(1));
    expect(await totals(a)).toEqual({ viewer_seconds: 88, peak: 2 });
  });

  it('keeps the total across a restart and after the codes expire', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    const a = new LivePresence(state);
    await state.ready();
    await beat(a, code(1));
    vi.setSystemTime(1_030_000);
    await beat(a, code(1));
    vi.setSystemTime(1_091_000);
    await a.alarm();
    const b = new LivePresence(state);
    await state.ready();
    expect(await totals(b)).toEqual({ viewer_seconds: 30, peak: 1 });
  });

  it('re-arms an alarm for totals left without one', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    await state.storage.put('vms', 5000);
    const b = new LivePresence(state);
    await state.ready();
    expect(state.alarmAt()).toBe(1_001_000);
  });

  it('brings a retention alarm forward when a new code arrives', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    const a = new LivePresence(state);
    await state.ready();
    await beat(a, code(1));
    vi.setSystemTime(1_061_000);
    await a.alarm();
    expect(state.alarmAt()).toBe(1_061_000 + TOTALS_RETAIN_MS);
    vi.setSystemTime(1_100_000);
    await beat(a, code(2));
    expect(state.alarmAt()).toBe(1_161_000);
  });

  it('finish wipes storage and memory', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const state = fakeState();
    const a = new LivePresence(state);
    await state.ready();
    await beat(a, code(1));
    vi.setSystemTime(1_030_000);
    await beat(a, code(1));
    expect(await finish(a)).toEqual({ ok: true });
    expect(state.data.size).toBe(0);
    expect(await totals(a)).toEqual({ viewer_seconds: 0, peak: 0 });
    expect(await watching(a)).toEqual({ watching: 0 });
  });
});
