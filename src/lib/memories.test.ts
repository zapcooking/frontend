/**
 * Tests for the Memories ("On this day") service's pure helpers.
 *
 * Window math is asserted by round-tripping the unix-second bounds back
 * through Date rather than asserting fixed second counts, so the tests
 * are timezone- and DST-robust (a target day straddling a DST change is
 * 23 or 25 hours long; the contract is "00:00:00 to 23:59:59 local").
 *
 * No network: fetchMemories / getMemoriesCached are intentionally not
 * exercised here.
 */

import { describe, it, expect } from 'vitest';
import { getMemoryWindows, isReplyNote, shouldCacheMemories } from './memories';

/** Assert a window spans exactly the given local calendar day. */
function expectLocalDaySpan(
  window: { since: number; until: number },
  year: number,
  monthIndex: number,
  day: number
) {
  const start = new Date(window.since * 1000);
  expect(start.getFullYear()).toBe(year);
  expect(start.getMonth()).toBe(monthIndex);
  expect(start.getDate()).toBe(day);
  expect(start.getHours()).toBe(0);
  expect(start.getMinutes()).toBe(0);
  expect(start.getSeconds()).toBe(0);

  const end = new Date(window.until * 1000);
  expect(end.getFullYear()).toBe(year);
  expect(end.getMonth()).toBe(monthIndex);
  expect(end.getDate()).toBe(day);
  expect(end.getHours()).toBe(23);
  expect(end.getMinutes()).toBe(59);
  expect(end.getSeconds()).toBe(59);
}

describe('getMemoryWindows', () => {
  it('returns windows for 1, 2, and 3 years ago in order', () => {
    const windows = getMemoryWindows(new Date(2026, 5, 10, 14, 30, 0)); // Jun 10 2026, 2:30pm
    expect(windows.map((w) => w.yearsAgo)).toEqual([1, 2, 3]);
    expectLocalDaySpan(windows[0], 2025, 5, 10);
    expectLocalDaySpan(windows[1], 2024, 5, 10);
    expectLocalDaySpan(windows[2], 2023, 5, 10);
  });

  it('since precedes until in every window', () => {
    for (const w of getMemoryWindows(new Date(2026, 5, 10))) {
      expect(w.since).toBeLessThan(w.until);
    }
  });

  it('handles Jan 1 (start-of-year boundary)', () => {
    const windows = getMemoryWindows(new Date(2026, 0, 1, 0, 5, 0));
    expectLocalDaySpan(windows[0], 2025, 0, 1);
    expectLocalDaySpan(windows[1], 2024, 0, 1);
    expectLocalDaySpan(windows[2], 2023, 0, 1);
  });

  it('handles Dec 31 (end-of-year boundary)', () => {
    const windows = getMemoryWindows(new Date(2025, 11, 31, 23, 55, 0));
    expectLocalDaySpan(windows[0], 2024, 11, 31);
    expectLocalDaySpan(windows[1], 2023, 11, 31);
    expectLocalDaySpan(windows[2], 2022, 11, 31);
  });

  it('falls back to Feb 28 when the target year has no Feb 29', () => {
    // Feb 29 2024 (leap). 2023/2022/2021 are all non-leap.
    const windows = getMemoryWindows(new Date(2024, 1, 29, 12, 0, 0));
    expectLocalDaySpan(windows[0], 2023, 1, 28);
    expectLocalDaySpan(windows[1], 2022, 1, 28);
    expectLocalDaySpan(windows[2], 2021, 1, 28);
  });

  it('keeps Feb 28 as Feb 28 regardless of leap status', () => {
    // Feb 28 2025 → 2024 is leap but the source day is the 28th, not the 29th.
    const windows = getMemoryWindows(new Date(2025, 1, 28, 12, 0, 0));
    expectLocalDaySpan(windows[0], 2024, 1, 28);
    expectLocalDaySpan(windows[1], 2023, 1, 28);
    expectLocalDaySpan(windows[2], 2022, 1, 28);
  });
});

describe('isReplyNote', () => {
  const eventId = 'e'.repeat(64);
  const pubkey = 'a'.repeat(64);

  it('keeps notes with no e tags (top-level)', () => {
    expect(isReplyNote({ tags: [] })).toBe(false);
    expect(isReplyNote({ tags: [['p', pubkey], ['t', 'zapcooking']] })).toBe(false);
  });

  it('drops notes with an e tag marked root', () => {
    expect(isReplyNote({ tags: [['e', eventId, '', 'root']] })).toBe(true);
  });

  it('drops notes with an e tag marked reply', () => {
    expect(isReplyNote({ tags: [['e', eventId, '', 'reply']] })).toBe(true);
  });

  it('drops notes with an unmarked e tag (legacy positional reply)', () => {
    expect(isReplyNote({ tags: [['e', eventId]] })).toBe(true);
    expect(isReplyNote({ tags: [['e', eventId, 'wss://relay.example']] })).toBe(true);
  });

  it('keeps notes whose only e tags are marked mention', () => {
    expect(isReplyNote({ tags: [['e', eventId, '', 'mention']] })).toBe(false);
    // Marker comparison is case-insensitive
    expect(isReplyNote({ tags: [['e', eventId, '', 'Mention']] })).toBe(false);
  });

  it('keeps q-tag quotes (NIP-18 style quoting)', () => {
    expect(isReplyNote({ tags: [['q', eventId]] })).toBe(false);
    expect(isReplyNote({ tags: [['q', eventId], ['p', pubkey]] })).toBe(false);
  });

  it('drops notes mixing a mention e tag with a reply e tag', () => {
    expect(
      isReplyNote({
        tags: [
          ['e', eventId, '', 'mention'],
          ['e', 'f'.repeat(64), '', 'reply']
        ]
      })
    ).toBe(true);
  });

  it('drops e tags with unknown markers (conservative)', () => {
    expect(isReplyNote({ tags: [['e', eventId, '', 'fork']] })).toBe(true);
  });

  it('ignores e tags with no event id', () => {
    expect(isReplyNote({ tags: [['e']] })).toBe(false);
  });
});

describe('shouldCacheMemories', () => {
  const note = {}; // contents irrelevant; only presence is checked

  it('does not cache empty results when every window timed out', () => {
    expect(
      shouldCacheMemories([
        { events: [], resolvedVia: 'timeout' },
        { events: [], resolvedVia: 'timeout' },
        { events: [], resolvedVia: 'timeout' }
      ])
    ).toBe(false);
  });

  it('caches empty results when at least one window received EOSE', () => {
    expect(
      shouldCacheMemories([
        { events: [], resolvedVia: 'eose' },
        { events: [], resolvedVia: 'timeout' },
        { events: [], resolvedVia: 'timeout' }
      ])
    ).toBe(true);
  });

  it('caches all-EOSE empty results (genuinely no memories today)', () => {
    expect(
      shouldCacheMemories([
        { events: [], resolvedVia: 'eose' },
        { events: [], resolvedVia: 'eose' },
        { events: [], resolvedVia: 'eose' }
      ])
    ).toBe(true);
  });

  it('caches non-empty results even if every window timed out', () => {
    expect(
      shouldCacheMemories([
        { events: [note], resolvedVia: 'timeout' },
        { events: [], resolvedVia: 'timeout' },
        { events: [], resolvedVia: 'timeout' }
      ])
    ).toBe(true);
  });
});
