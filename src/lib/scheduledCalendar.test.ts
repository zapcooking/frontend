import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ScheduledItem, ScheduleStatus } from './scheduleClient';
import {
  CALENDAR_DAYS_AHEAD,
  CALENDAR_DAYS_BACK,
  bucketByDay,
  calendarBounds,
  calendarEntries,
  canShowMonth,
  canShowWeek,
  countDay,
  dayKey,
  dayKeyOf,
  describeCounts,
  firstLine,
  inBounds,
  localDay,
  monthWeeks,
  sameTimeOn,
  shortTime,
  parseCalendarMode,
  parseScheduledView,
  weekDays,
  weekStart,
  weekTitle
} from './scheduledCalendar';

// Every case here is about LOCAL days, so the zone is pinned to one with
// daylight saving: 2027-03-14 is 23 hours long there and 2026-11-01 is 25.
// Set around each test and put back after, so no other file sees it.
const realTz = process.env.TZ;
beforeEach(() => {
  process.env.TZ = 'America/New_York';
});
afterEach(() => {
  if (realTz === undefined) delete process.env.TZ;
  else process.env.TZ = realTz;
});

const at = (y: number, m: number, d: number, h = 0, min = 0) => Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);

let seq = 0;
function item(status: ScheduleStatus, publishAt: number, extra: Partial<ScheduledItem> = {}): ScheduledItem {
  const id = (++seq).toString(16).padStart(64, '0');
  return {
    id,
    publishAt,
    relayMode: 'all',
    relays: [],
    status,
    attempts: 0,
    lastError: null,
    sentAt: null,
    event: { id, pubkey: 'p', created_at: publishAt, kind: 1, tags: [], content: 'x', sig: 's' },
    ...extra
  };
}

describe('the zone is the one these tests assume', () => {
  it('New York, with a 23-hour day on 2027-03-14', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/New_York');
    expect((new Date(2027, 2, 15).getTime() - new Date(2027, 2, 14).getTime()) / 3_600_000).toBe(23);
  });
});

describe('local days', () => {
  it('a post belongs to the local day it publishes on, right up to midnight', () => {
    expect(dayKeyOf(at(2026, 11, 24, 0, 0))).toBe('2026-11-24');
    expect(dayKeyOf(at(2026, 11, 24, 23, 59))).toBe('2026-11-24');
    expect(dayKeyOf(at(2026, 11, 25, 0, 0))).toBe('2026-11-25');
  });

  it('both 1:30 AMs of the fall-back night are the same day, in order', () => {
    const first = Date.UTC(2026, 10, 1, 5, 30) / 1000; // 1:30 AM EDT
    const second = first + 3600; // 1:30 AM EST
    expect(dayKeyOf(first)).toBe('2026-11-01');
    expect(dayKeyOf(second)).toBe('2026-11-01');
    const entries = calendarEntries([item('pending', second), item('pending', first)], at(2026, 10, 20));
    expect(entries.map((e) => e.at)).toEqual([first, second]);
  });

  it('the week of a clock change still has seven distinct days', () => {
    const start = weekStart(new Date(2027, 2, 14, 12)); // Sunday of the spring-forward
    expect(dayKey(start)).toBe('2027-03-08');
    expect(weekDays(start).map(dayKey)).toEqual([
      '2027-03-08',
      '2027-03-09',
      '2027-03-10',
      '2027-03-11',
      '2027-03-12',
      '2027-03-13',
      '2027-03-14'
    ]);
    // Every one is a local midnight, including the day after the short one.
    for (const day of weekDays(weekStart(new Date(2027, 2, 15)))) {
      expect(day.getHours()).toBe(0);
    }
    // Adding 86,400 s to 9 AM the day before lands on 10 AM; the day key is still right.
    expect(dayKeyOf(at(2027, 3, 13, 9) + 86400)).toBe('2027-03-14');
    expect(new Date((at(2027, 3, 13, 9) + 86400) * 1000).getHours()).toBe(10);
  });

  it('weeks start on Monday', () => {
    expect(dayKey(weekStart(new Date(2026, 10, 24)))).toBe('2026-11-23'); // a Tuesday
    expect(dayKey(weekStart(new Date(2026, 10, 23)))).toBe('2026-11-23'); // Monday itself
    expect(dayKey(weekStart(new Date(2026, 10, 29)))).toBe('2026-11-23'); // Sunday
  });

  it('a month view is whole weeks covering every day of the month', () => {
    const weeks = monthWeeks(new Date(2026, 10, 15)); // November 2026 starts on a Sunday
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(dayKey(weeks[0][0])).toBe('2026-10-26');
    expect(dayKey(weeks[weeks.length - 1][6])).toBe('2026-12-06');
    expect(weeks).toHaveLength(6);
    const march = monthWeeks(new Date(2027, 2, 1)); // has the short day
    const keys = march.flat().map(dayKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('2027-03-14');
    expect(keys).toContain('2027-03-31');
  });
});

// Built inside each test, never at describe level: the zone is only
// pinned while a test runs, and a time built before that is in the
// machine's own zone (UTC on CI).
const NOW = () => at(2026, 11, 24, 15, 30);

describe('how far the views go', () => {
  it('30 days back and 90 ahead, in calendar days', () => {
    const bounds = calendarBounds(NOW());
    expect(dayKey(bounds.today)).toBe('2026-11-24');
    expect(dayKey(bounds.min)).toBe('2026-10-25');
    expect(dayKey(bounds.max)).toBe('2027-02-22');
    expect(CALENDAR_DAYS_BACK).toBe(30);
    expect(CALENDAR_DAYS_AHEAD).toBe(90);
    expect(inBounds(bounds.min, bounds)).toBe(true);
    expect(inBounds(bounds.max, bounds)).toBe(true);
    expect(inBounds(new Date(2026, 9, 24), bounds)).toBe(false);
    expect(inBounds(new Date(2027, 1, 23), bounds)).toBe(false);
  });

  it('a week or month is reachable while any of its days is inside', () => {
    const bounds = calendarBounds(NOW());
    expect(canShowWeek(weekStart(bounds.min), bounds)).toBe(true); // Oct 19–25: only the 25th is in
    expect(canShowWeek(new Date(2026, 9, 12), bounds)).toBe(false);
    expect(canShowWeek(weekStart(bounds.max), bounds)).toBe(true);
    expect(canShowWeek(new Date(2027, 2, 1), bounds)).toBe(false);
    expect(canShowMonth(new Date(2026, 9, 1), bounds)).toBe(true);
    expect(canShowMonth(new Date(2026, 8, 1), bounds)).toBe(false);
    expect(canShowMonth(new Date(2027, 1, 1), bounds)).toBe(true);
    expect(canShowMonth(new Date(2027, 2, 1), bounds)).toBe(false);
  });
});

describe('what the calendar shows', () => {

  it('pending, publishing and failed posts at their publish time; sent posts when they went out', () => {
    const now = NOW();
    const pending = item('pending', at(2026, 11, 26, 9));
    const publishing = item('publishing', at(2026, 11, 24, 15, 29));
    const failed = item('failed', at(2026, 11, 20, 8));
    const sent = item('sent', at(2026, 11, 22, 23, 59), { sentAt: at(2026, 11, 23, 0, 0) + 20 });
    const entries = calendarEntries([pending, publishing, failed, sent], now);
    expect(entries.map((e) => [e.tone, e.day])).toEqual([
      ['failed', '2026-11-20'],
      ['sent', '2026-11-23'],
      ['publishing', '2026-11-24'],
      ['pending', '2026-11-26']
    ]);
  });

  it('leaves out cancelled posts, sent posts older than 30 days, and anything outside the bounds', () => {
    const now = NOW();
    const entries = calendarEntries(
      [
        item('cancelled', at(2026, 11, 26, 9)),
        item('sent', at(2026, 10, 1, 9), { sentAt: at(2026, 10, 1, 9) }),
        item('failed', at(2026, 9, 1, 9)),
        item('sent', at(2026, 11, 1, 9), { sentAt: at(2026, 11, 1, 9) })
      ],
      now
    );
    expect(entries.map((e) => e.day)).toEqual(['2026-11-01']);
  });

  it('shows all of the last 30 days of sent posts, not just ten', () => {
    const now = NOW();
    const sent = Array.from({ length: 25 }, (_, i) => item('sent', at(2026, 11, 1 + (i % 20), 9), { sentAt: at(2026, 11, 1 + (i % 20), 9) }));
    expect(calendarEntries(sent, now)).toHaveLength(25);
  });

  it('a pending post whose time has just passed (waiting for the sweep or a retry) stays on its day', () => {
    const now = NOW();
    const late = item('pending', now - 120);
    expect(calendarEntries([late], now)[0].day).toBe('2026-11-24');
  });

  it('buckets by day in time order and counts by tone', () => {
    const now = NOW();
    const a = item('pending', at(2026, 11, 26, 18));
    const b = item('pending', at(2026, 11, 26, 9));
    const c = item('failed', at(2026, 11, 26, 7));
    const d = item('sent', at(2026, 11, 23, 9), { sentAt: at(2026, 11, 23, 9) });
    const buckets = bucketByDay(calendarEntries([a, b, c, d], now));
    expect(buckets.get('2026-11-26')?.map((e) => e.item.id)).toEqual([c.id, b.id, a.id]);
    expect(countDay(buckets.get('2026-11-26'))).toEqual({ upcoming: 2, failed: 1, sent: 0 });
    expect(countDay(buckets.get('2026-11-23'))).toEqual({ upcoming: 0, failed: 0, sent: 1 });
    expect(countDay(undefined)).toEqual({ upcoming: 0, failed: 0, sent: 0 });
    expect(describeCounts({ upcoming: 2, failed: 1, sent: 0 })).toBe('2 scheduled, 1 not sent');
    expect(describeCounts({ upcoming: 0, failed: 0, sent: 0 })).toBe('');
  });
});

describe('dragging a post to another day keeps its time of day', () => {
  const clock = (u: number) => {
    const d = new Date(u * 1000);
    return `${dayKey(d)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  it('9:00 stays 9:00 across the spring-forward and the fall-back', () => {
    expect(clock(sameTimeOn(new Date(2027, 2, 14), at(2027, 3, 13, 9)))).toBe('2027-03-14 9:00');
    expect(clock(sameTimeOn(new Date(2027, 2, 15), at(2027, 3, 13, 9)))).toBe('2027-03-15 9:00');
    expect(clock(sameTimeOn(new Date(2026, 10, 2), at(2026, 10, 31, 18, 45)))).toBe('2026-11-02 18:45');
    // …which is not a whole number of days in seconds.
    expect(sameTimeOn(new Date(2027, 2, 14), at(2027, 3, 13, 9)) - at(2027, 3, 13, 9)).toBe(86400 - 3600);
  });

  it('a time that does not exist on the target day becomes the next one that does', () => {
    expect(clock(sameTimeOn(new Date(2027, 2, 14), at(2027, 3, 10, 2, 30)))).toBe('2027-03-14 3:30');
  });

  it('moving earlier works the same way', () => {
    expect(clock(sameTimeOn(new Date(2026, 10, 20), at(2026, 11, 26, 7, 5)))).toBe('2026-11-20 7:05');
  });
});

describe('wording and remembered choices', () => {
  it('week titles', () => {
    const today = new Date(2026, 10, 24);
    expect(weekTitle(new Date(2026, 10, 23), today, 'en-US')).toBe('Nov 23 – 29');
    expect(weekTitle(new Date(2026, 10, 30), today, 'en-US')).toBe('Nov 30 – Dec 6');
    expect(weekTitle(new Date(2026, 11, 28), today, 'en-US')).toBe('Dec 28, 2026 – Jan 3, 2027');
    expect(weekTitle(new Date(2027, 0, 4), today, 'en-US')).toBe('Jan 4 – 10, 2027');
  });

  it('short times drop a ":00" and nothing else', () => {
    expect(shortTime(at(2026, 11, 24, 9, 0), 'en-US')).toBe('9 AM');
    expect(shortTime(at(2026, 11, 24, 12, 30), 'en-US')).toBe('12:30 PM');
    expect(shortTime(at(2026, 11, 24, 10, 0), 'en-US')).toBe('10 AM');
    expect(shortTime(at(2026, 11, 24, 18, 0), 'en-GB')).toBe('18:00');
  });

  it('the first non-empty line of a post', () => {
    expect(firstLine('\n\n  Hello there \nsecond')).toBe('Hello there');
    expect(firstLine('')).toBe('');
  });

  it('anything not stored by us reads as the default', () => {
    expect(parseScheduledView('calendar')).toBe('calendar');
    expect(parseScheduledView(null)).toBe('list');
    expect(parseScheduledView('grid')).toBe('list');
    expect(parseCalendarMode('month')).toBe('month');
    expect(parseCalendarMode(undefined)).toBe('week');
  });

  it('localDay drops the time and keeps the date', () => {
    expect(localDay(new Date(2027, 2, 14, 3, 30)).getTime()).toBe(new Date(2027, 2, 14).getTime());
  });
});
