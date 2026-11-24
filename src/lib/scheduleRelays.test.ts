/**
 * Unit tests for the scheduled-posts relay list helpers. The route
 * tests (src/routes/api/schedule/schedule.test.ts) cover the same
 * rules through POST; these pin the helpers the sweep also relies on.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_SCHEDULE_RELAYS,
  MAX_SCHEDULE_RELAY_URL_LENGTH,
  normalizeScheduleRelay,
  parseScheduleRelays,
  storedScheduleRelays
} from './scheduleRelays';

describe('normalizeScheduleRelay', () => {
  // A `for` loop, not it.each: the each helpers don't typecheck under this repo's svelte-check.
  for (const [input, expected] of [
    ['wss://Relay.Example.COM', 'wss://relay.example.com'],
    ['WSS://relay.example.com/', 'wss://relay.example.com'],
    ['wss://relay.example.com:443', 'wss://relay.example.com'],
    ['wss://relay.example.com:4443/', 'wss://relay.example.com:4443'],
    ['wss://relay.example.com/inbox/', 'wss://relay.example.com/inbox'],
    ['wss://relay.example.com/Inbox?key=A#frag', 'wss://relay.example.com/Inbox?key=A'],
    ['wss://relay.example.com.', 'wss://relay.example.com.']
  ]) {
    it(`${input} → ${expected}`, () => {
      expect(normalizeScheduleRelay(input)).toBe(expected);
    });
  }
});

describe('parseScheduleRelays', () => {
  it('absent means none', () => {
    expect(parseScheduleRelays(undefined)).toEqual({ ok: true, relays: [] });
    expect(parseScheduleRelays(null)).toEqual({ ok: true, relays: [] });
    expect(parseScheduleRelays([])).toEqual({ ok: true, relays: [] });
  });

  it('the cap applies after duplicates are folded', () => {
    const four = ['wss://a.example.com', 'wss://b.example.com', 'wss://c.example.com', 'wss://d.example.com'];
    expect(MAX_SCHEDULE_RELAYS).toBe(4);
    expect(parseScheduleRelays([...four, 'wss://A.example.com/', 'wss://d.example.com:443'])).toEqual({
      ok: true,
      relays: four
    });
    expect(parseScheduleRelays([...four, 'wss://e.example.com'])).toEqual({ ok: false });
  });

  it('paths distinguish relays; a fragment does not', () => {
    expect(parseScheduleRelays(['wss://r.example.com/a', 'wss://r.example.com/b', 'wss://r.example.com/a#x'])).toEqual({
      ok: true,
      relays: ['wss://r.example.com/a', 'wss://r.example.com/b']
    });
  });

  it('one bad entry fails the whole list', () => {
    for (const bad of ['ws://a.example.com', 'wss://127.0.0.1', 'wss://[::1]', 'wss://localhost', 'wss://nas.lan', 5, null, {}]) {
      expect(parseScheduleRelays(['wss://a.example.com', bad]), String(bad)).toEqual({ ok: false });
    }
    expect(parseScheduleRelays('wss://a.example.com')).toEqual({ ok: false });
    expect(parseScheduleRelays({ length: 1, 0: 'wss://a.example.com' })).toEqual({ ok: false });
  });

  it('each URL must be under 200 characters', () => {
    expect(MAX_SCHEDULE_RELAY_URL_LENGTH).toBe(200);
    const at = (n: number) => `wss://a.example.com/${'p'.repeat(n - 'wss://a.example.com/'.length)}`;
    expect(at(199)).toHaveLength(199);
    expect(parseScheduleRelays([at(199)]).ok).toBe(true);
    expect(parseScheduleRelays([at(200)]).ok).toBe(false);
  });
});

describe('storedScheduleRelays', () => {
  it('reads back what parseScheduleRelays stored', () => {
    const parsed = parseScheduleRelays(['wss://a.example.com/', 'wss://b.example.com']);
    expect(parsed.ok && storedScheduleRelays(JSON.stringify(parsed.relays))).toEqual([
      'wss://a.example.com',
      'wss://b.example.com'
    ]);
  });

  it('NULL, empty, non-JSON and non-array read as none', () => {
    for (const raw of [null, undefined, '', '{', '"wss://a.example.com"', '{"0":"wss://a.example.com"}', '7']) {
      expect(storedScheduleRelays(raw), String(raw)).toEqual([]);
    }
  });

  it('drops entries that would not pass validation, folds duplicates, and stops at the cap', () => {
    expect(
      storedScheduleRelays(
        JSON.stringify(['wss://localhost', 'wss://a.example.com', 'wss://A.example.com/', 'ws://b.example.com', 9, 'wss://192.168.1.4'])
      )
    ).toEqual(['wss://a.example.com']);
    const many = Array.from({ length: 10 }, (_, i) => `wss://r${i}.example.com`);
    expect(storedScheduleRelays(JSON.stringify(many))).toEqual(many.slice(0, MAX_SCHEDULE_RELAYS));
  });
});
