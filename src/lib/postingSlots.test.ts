import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ScheduledItem, ScheduleStatus } from './scheduleClient';
import type { CalendarEntry } from './scheduledCalendar';
import { dayKey } from './scheduledCalendar';
import {
  DEFAULT_POSTING_TIMES,
  MAX_SLOTS_PER_DAY,
  fromTimeInputValue,
  isWeekend,
  layoutDay,
  normalizeTimes,
  nextOpenSlots,
  openSlotsOn,
  parsePostingTimes,
  pickerStartFor,
  serializePostingTimes,
  slotLabel,
  slotsForDay,
  toTimeInputValue,
  type DayRow,
  type PostingTimes
} from './postingSlots';

// Slots are local wall-clock times, so the zone is pinned to one with
// daylight saving while each test runs. Times are built inside the tests:
// anything built at describe level would be in the machine's own zone.
const realTz = process.env.TZ;
beforeEach(() => {
  process.env.TZ = 'America/New_York';
});
afterEach(() => {
  if (realTz === undefined) delete process.env.TZ;
  else process.env.TZ = realTz;
});

const at = (y: number, m: number, d: number, h = 0, min = 0) => Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);
const clock = (u: number) => {
  const d = new Date(u * 1000);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const TIMES: PostingTimes = { weekdays: [9 * 60, 12 * 60 + 30, 18 * 60], weekends: [10 * 60, 18 * 60] };

let seq = 0;
function entry(when: number, status: ScheduleStatus = 'pending'): CalendarEntry {
  const id = (++seq).toString(16).padStart(64, '0');
  const item: ScheduledItem = {
    id,
    publishAt: when,
    relayMode: 'all',
    relays: [],
    status,
    attempts: 0,
    lastError: null,
    sentAt: null,
    event: { id, pubkey: 'p', created_at: when, kind: 1, tags: [], content: 'x', sig: 's' }
  };
  return { item, at: when, tone: status === 'cancelled' ? 'pending' : (status as CalendarEntry['tone']), day: dayKey(new Date(when * 1000)) };
}
/** A day's rows as short strings: "open 9:00", "post 9:05 in 9:00", "post 14:00". */
const shape = (rows: DayRow[]) =>
  rows.map((r) =>
    r.type === 'open'
      ? `open ${clock(r.at)}${r.usable ? '' : ' (not usable)'}`
      : `post ${clock(r.at)}${r.slot === null ? '' : ` in ${clock(r.slot)}`}`
  );

describe('defaults and storage', () => {
  it('unset: 9:00, 12:30 and 6:00 PM on weekdays; 10:00 and 6:00 PM at weekends', () => {
    expect(parsePostingTimes(null)).toEqual(DEFAULT_POSTING_TIMES);
    expect(DEFAULT_POSTING_TIMES.weekdays.map((m) => slotLabel(m, 'en-US'))).toEqual(['9:00 AM', '12:30 PM', '6:00 PM']);
    expect(DEFAULT_POSTING_TIMES.weekends.map((m) => slotLabel(m, 'en-US'))).toEqual(['10:00 AM', '6:00 PM']);
  });

  it('round-trips what was saved, sorted and without repeats', () => {
    const saved = serializePostingTimes({ weekdays: [1080, 540, 540, 420], weekends: [] });
    expect(parsePostingTimes(saved)).toEqual({ weekdays: [420, 540, 1080], weekends: [] });
  });

  it('an empty list is a choice and is kept; anything unreadable is the defaults', () => {
    expect(parsePostingTimes('{"weekdays":[],"weekends":[]}')).toEqual({ weekdays: [], weekends: [] });
    for (const raw of ['', '{', 'null', '[]', '{"weekdays":[540]}', '{"weekdays":"9","weekends":[]}']) {
      expect(parsePostingTimes(raw), raw).toEqual(DEFAULT_POSTING_TIMES);
    }
    // A fresh copy each time: editing one must not edit the defaults.
    parsePostingTimes(null).weekdays.push(1);
    expect(DEFAULT_POSTING_TIMES.weekdays).toHaveLength(3);
  });

  it('drops times that are not minutes of a day, and caps a day at 8 slots', () => {
    expect(normalizeTimes([540, -1, 1440, 9.5, '600', null, 600])).toEqual([540, 600]);
    expect(normalizeTimes(Array.from({ length: 20 }, (_, i) => i * 60))).toHaveLength(MAX_SLOTS_PER_DAY);
    expect(normalizeTimes('nope')).toEqual([]);
  });

  it('time inputs: HH:mm in and out', () => {
    expect(toTimeInputValue(9 * 60)).toBe('09:00');
    expect(toTimeInputValue(18 * 60 + 5)).toBe('18:05');
    expect(fromTimeInputValue('09:00')).toBe(540);
    expect(fromTimeInputValue('23:59:30')).toBe(1439);
    for (const bad of ['', '9:00', '24:00', '12:60', 'noon']) expect(fromTimeInputValue(bad), bad).toBeNull();
  });
});

describe('a day’s slots are local wall-clock times', () => {
  it('weekdays and weekends take their own times', () => {
    expect(isWeekend(new Date(2026, 10, 28))).toBe(true); // Saturday
    expect(isWeekend(new Date(2026, 10, 29))).toBe(true); // Sunday
    expect(isWeekend(new Date(2026, 10, 30))).toBe(false); // Monday
    expect(slotsForDay(new Date(2026, 10, 30), TIMES).map(clock)).toEqual(['9:00', '12:30', '18:00']);
    expect(slotsForDay(new Date(2026, 10, 28), TIMES).map(clock)).toEqual(['10:00', '18:00']);
  });

  it('9:00 AM is 9:00 AM on both sides of a clock change, though the days differ in length', () => {
    const times: PostingTimes = { weekdays: [540], weekends: [540] };
    // Spring forward: Sunday 2027-03-14 is 23 hours long.
    const sat = slotsForDay(new Date(2027, 2, 13), times)[0];
    const sun = slotsForDay(new Date(2027, 2, 14), times)[0];
    const mon = slotsForDay(new Date(2027, 2, 15), times)[0];
    expect([sat, sun, mon].map(clock)).toEqual(['9:00', '9:00', '9:00']);
    expect(sun - sat).toBe(23 * 3600);
    expect(mon - sun).toBe(24 * 3600);
    // Fall back: Sunday 2026-11-01 is 25 hours long.
    const before = slotsForDay(new Date(2026, 9, 31), times)[0];
    const during = slotsForDay(new Date(2026, 10, 1), times)[0];
    expect([before, during].map(clock)).toEqual(['9:00', '9:00']);
    expect(during - before).toBe(25 * 3600);
  });

  it('a time that does not exist that day has no slot; one that happens twice is the first', () => {
    const times: PostingTimes = { weekdays: [], weekends: [90, 150, 210] }; // 1:30, 2:30, 3:30
    // 2:30 AM does not happen on 2027-03-14; it must not turn into a second 3:30.
    expect(slotsForDay(new Date(2027, 2, 14), times).map(clock)).toEqual(['1:30', '3:30']);
    // 1:30 AM happens twice on 2026-11-01: the slot is the first (still on summer time).
    const fallBack = slotsForDay(new Date(2026, 10, 1), times);
    expect(fallBack.map(clock)).toEqual(['1:30', '2:30', '3:30']);
    expect(fallBack[0]).toBe(Date.UTC(2026, 10, 1, 5, 30) / 1000);
  });
});

describe('which post fills which slot', () => {
  const MON = () => new Date(2026, 10, 30);
  const NOW = () => at(2026, 11, 24, 12, 0);

  it('an empty day is its slots', () => {
    expect(shape(layoutDay(MON(), [], TIMES, NOW()))).toEqual(['open 9:00', 'open 12:30', 'open 18:00']);
  });

  it('a post exactly on a slot fills it', () => {
    const rows = layoutDay(MON(), [entry(at(2026, 11, 30, 12, 30))], TIMES, NOW());
    expect(shape(rows)).toEqual(['open 9:00', 'post 12:30 in 12:30', 'open 18:00']);
  });

  it('a post within 30 minutes fills the slot and keeps its own time; at 31 minutes it is a post of its own', () => {
    expect(shape(layoutDay(MON(), [entry(at(2026, 11, 30, 9, 5))], TIMES, NOW()))).toEqual([
      'post 9:05 in 9:00',
      'open 12:30',
      'open 18:00'
    ]);
    expect(shape(layoutDay(MON(), [entry(at(2026, 11, 30, 8, 30))], TIMES, NOW()))[0]).toBe('post 8:30 in 9:00');
    expect(shape(layoutDay(MON(), [entry(at(2026, 11, 30, 9, 31))], TIMES, NOW()))).toEqual([
      'open 9:00',
      'post 9:31',
      'open 12:30',
      'open 18:00'
    ]);
  });

  it('two posts near one slot: the nearer has it, the other is shown at its own time', () => {
    const rows = layoutDay(MON(), [entry(at(2026, 11, 30, 9, 10)), entry(at(2026, 11, 30, 9, 2))], TIMES, NOW());
    expect(shape(rows)).toEqual(['post 9:02 in 9:00', 'post 9:10', 'open 12:30', 'open 18:00']);
  });

  it('a tie goes to the earlier post', () => {
    const rows = layoutDay(MON(), [entry(at(2026, 11, 30, 9, 10)), entry(at(2026, 11, 30, 8, 50))], TIMES, NOW());
    expect(shape(rows)).toEqual(['post 8:50 in 9:00', 'post 9:10', 'open 12:30', 'open 18:00']);
  });

  it('a post between two close slots takes the nearer; each slot holds one post', () => {
    const times: PostingTimes = { weekdays: [9 * 60, 9 * 60 + 40], weekends: [] };
    const rows = layoutDay(MON(), [entry(at(2026, 11, 30, 9, 25)), entry(at(2026, 11, 30, 9, 15))], times, NOW());
    // 9:25 is 15 from 9:40; 9:15 is 15 from 9:00. Both placed, neither slot doubled.
    expect(shape(rows)).toEqual(['post 9:15 in 9:00', 'post 9:25 in 9:40']);
  });

  it('posts at other times sit in time order between the slots', () => {
    const rows = layoutDay(MON(), [entry(at(2026, 11, 30, 15, 0)), entry(at(2026, 11, 30, 7, 0)), entry(at(2026, 11, 30, 22, 0))], TIMES, NOW());
    expect(shape(rows)).toEqual(['post 7:00', 'open 9:00', 'open 12:30', 'post 15:00', 'open 18:00', 'post 22:00']);
  });

  it('a post that already went out, or failed, has used its slot', () => {
    for (const status of ['sent', 'failed', 'publishing'] as const) {
      expect(shape(layoutDay(MON(), [entry(at(2026, 11, 30, 9, 0), status)], TIMES, NOW()))[0]).toBe('post 9:00 in 9:00');
    }
  });

  it('with no posting times at all, a day is just its posts', () => {
    const rows = layoutDay(MON(), [entry(at(2026, 11, 30, 9, 0))], { weekdays: [], weekends: [] }, NOW());
    expect(shape(rows)).toEqual(['post 9:00']);
  });
});

describe('which empty slots can be used', () => {
  it('today: a slot in the past or under 5 minutes away is there but not usable', () => {
    const today = new Date(2026, 10, 24); // a Tuesday
    const rows = layoutDay(today, [], TIMES, at(2026, 11, 24, 12, 26));
    expect(shape(rows)).toEqual(['open 9:00 (not usable)', 'open 12:30 (not usable)', 'open 18:00']);
    // Exactly 5 minutes away is usable.
    expect(shape(layoutDay(today, [], TIMES, at(2026, 11, 24, 12, 25)))[1]).toBe('open 12:30');
  });

  it('a slot 90 days out or more is not usable', () => {
    const far = new Date(2027, 1, 22); // 90 days after 2026-11-24
    expect(shape(layoutDay(far, [], TIMES, at(2026, 11, 24, 8, 0)))).toEqual(['open 9:00 (not usable)', 'open 12:30 (not usable)', 'open 18:00 (not usable)']);
  });

  it('days gone by show their posts and no empty slots', () => {
    const rows = layoutDay(new Date(2026, 10, 23), [entry(at(2026, 11, 23, 9, 0), 'sent')], TIMES, at(2026, 11, 24, 12, 0), { emptySlots: false });
    expect(shape(rows)).toEqual(['post 9:00 in 9:00']);
  });

  it('openSlotsOn: the empty, usable slots of a day; the post being moved does not hold its own', () => {
    const now = at(2026, 11, 24, 12, 0);
    const mon = new Date(2026, 10, 30);
    const moving = entry(at(2026, 11, 30, 9, 0));
    const other = entry(at(2026, 11, 30, 18, 0));
    const elsewhere = entry(at(2026, 12, 1, 12, 30));
    const all = [moving, other, elsewhere];
    expect(openSlotsOn(mon, all, TIMES, now).map(clock)).toEqual(['12:30']);
    expect(openSlotsOn(mon, all, TIMES, now, moving.item.id).map(clock)).toEqual(['9:00', '12:30']);
    // Today: only what is still ahead.
    expect(openSlotsOn(new Date(2026, 10, 24), all, TIMES, now).map(clock)).toEqual(['12:30', '18:00']);
    expect(openSlotsOn(new Date(2026, 10, 23), all, TIMES, now)).toEqual([]);
  });
});

describe('the next open slots, across days', () => {
  it('the first few empty, usable slots from a day onward, skipping what is taken or passed', () => {
    const now = at(2026, 11, 24, 12, 0); // a Tuesday, at noon
    const taken = entry(at(2026, 11, 24, 18, 0));
    const tomorrow9 = entry(at(2026, 11, 25, 9, 0));
    const next = nextOpenSlots(new Date(2026, 10, 24), [taken, tomorrow9], TIMES, now);
    expect(next.map((u) => `${dayKey(new Date(u * 1000))} ${clock(u)}`)).toEqual([
      '2026-11-24 12:30',
      '2026-11-25 12:30',
      '2026-11-25 18:00',
      '2026-11-26 9:00'
    ]);
  });

  it('the post being moved does not hold its own slot; the limit and the look-ahead are respected', () => {
    const now = at(2026, 11, 24, 12, 0);
    const moving = entry(at(2026, 11, 24, 18, 0));
    const next = nextOpenSlots(new Date(2026, 10, 24), [moving], TIMES, now, { ignoreId: moving.item.id, limit: 2 });
    expect(next.map(clock)).toEqual(['12:30', '18:00']);
    expect(nextOpenSlots(new Date(2026, 10, 24), [], { weekdays: [], weekends: [] }, now)).toEqual([]);
    expect(nextOpenSlots(new Date(2026, 10, 24), [], TIMES, now, { limit: 99, maxDays: 1 }).map(clock)).toEqual(['12:30', '18:00']);
  });
});

describe('the picker’s start for a day’s "+"', () => {
  it('noon on that day', () => {
    expect(clock(pickerStartFor(new Date(2026, 10, 30), at(2026, 11, 24, 15, 0)))).toBe('12:00');
    expect(dayKey(new Date(pickerStartFor(new Date(2026, 10, 30), at(2026, 11, 24, 15, 0)) * 1000))).toBe('2026-11-30');
  });

  it('today after noon: the next quarter hour an hour from now', () => {
    const start = pickerStartFor(new Date(2026, 10, 24), at(2026, 11, 24, 15, 7));
    expect(clock(start)).toBe('16:15');
  });
});
