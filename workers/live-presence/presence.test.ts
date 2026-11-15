import { describe, it, expect, vi, afterEach } from 'vitest';
import { LivePresence, type PresenceState } from './index';

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
    expect([...state.data.keys()].sort()).toEqual([`c:${code(1)}`, 'peak']);
    expect(JSON.stringify([...state.data])).not.toContain('203.0.113.77');
  });

  it('deletes each code about a second after it expires, then wipes storage', async () => {
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
    expect(state.data.size).toBe(0);
    expect(state.alarmAt()).toBeNull();
  });
});
