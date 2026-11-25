/**
 * Posting slots for the Scheduled calendar: the times of day a person
 * usually posts, set once, with weekdays and weekends separate. Each day
 * of the calendar lays its slots out in time order; an empty one is a
 * place to put a post, a filled one shows the post that is there.
 *
 * SLOT TIMES ARE LOCAL WALL-CLOCK TIMES. "9:00 AM" is 9:00 AM on every
 * day it applies to, on both sides of a daylight-saving change: a slot's
 * instant is built from the day's own year, month and day plus the hour
 * and minute, never by adding seconds to another day's slot.
 *
 * The times are kept on this device (localStorage). Logic only; no
 * stores, no DOM.
 */

import { pickedTimeProblem } from './composerSchedule';
import type { CalendarEntry } from './scheduledCalendar';
import { dayKey } from './scheduledCalendar';

/** Where the times are kept, per device. */
export const POSTING_TIMES_KEY = 'zapcooking_posting_times';

/** At most this many slots in a day: past it a day is a list, not a rhythm. */
export const MAX_SLOTS_PER_DAY = 8;

/** A post within this many minutes of a slot fills it. */
export const SLOT_MATCH_MINUTES = 30;

/** Times of day as minutes after midnight, ascending, no repeats. */
export interface PostingTimes {
  /** Monday to Friday. */
  weekdays: number[];
  /** Saturday and Sunday. */
  weekends: number[];
}

/**
 * Used until the person sets their own: morning, lunch and early evening
 * on weekdays; a later morning and early evening at weekends.
 */
export const DEFAULT_POSTING_TIMES: PostingTimes = {
  weekdays: [9 * 60, 12 * 60 + 30, 18 * 60],
  weekends: [10 * 60, 18 * 60]
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Minutes after midnight → the `HH:mm` a time input uses. */
export function toTimeInputValue(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A time input's `HH:mm` (seconds tolerated) → minutes after midnight, or null. */
export function fromTimeInputValue(value: string): number | null {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value ?? '');
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** A list of times as stored or typed → valid, ascending, no repeats, capped. */
export function normalizeTimes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 24 * 60);
  return [...new Set(valid)].sort((a, b) => a - b).slice(0, MAX_SLOTS_PER_DAY);
}

/**
 * What localStorage holds → posting times. Nothing stored, or something
 * unreadable, is the defaults. An EMPTY list is kept as it is: no slots
 * on those days is a choice.
 */
export function parsePostingTimes(raw: string | null | undefined): PostingTimes {
  if (!raw) return { weekdays: [...DEFAULT_POSTING_TIMES.weekdays], weekends: [...DEFAULT_POSTING_TIMES.weekends] };
  try {
    const parsed = JSON.parse(raw) as { weekdays?: unknown; weekends?: unknown } | null;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.weekdays) || !Array.isArray(parsed.weekends)) {
      throw new Error('not posting times');
    }
    return { weekdays: normalizeTimes(parsed.weekdays), weekends: normalizeTimes(parsed.weekends) };
  } catch {
    return { weekdays: [...DEFAULT_POSTING_TIMES.weekdays], weekends: [...DEFAULT_POSTING_TIMES.weekends] };
  }
}

export function serializePostingTimes(times: PostingTimes): string {
  return JSON.stringify({ weekdays: normalizeTimes(times.weekdays), weekends: normalizeTimes(times.weekends) });
}

export function isWeekend(day: Date): boolean {
  return day.getDay() === 0 || day.getDay() === 6;
}

/** "9:00 AM", in the person's own locale. */
export function slotLabel(minutes: number, locale?: string): string {
  return new Date(2001, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * The instants (unix seconds) of `day`'s slots, in time order.
 *
 * Built from the day's own date and the slot's hour and minute. A time
 * that does not exist on that day (2:30 AM when the clocks go forward)
 * has no slot that day, rather than turning up an hour late beside
 * another one. A time that happens twice (1:30 AM when they go back) is
 * the first of the two.
 */
export function slotsForDay(day: Date, times: PostingTimes): number[] {
  const minutes = isWeekend(day) ? times.weekends : times.weekdays;
  const slots: number[] = [];
  for (const m of normalizeTimes(minutes)) {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60, 0, 0);
    if (at.getHours() !== Math.floor(m / 60) || at.getMinutes() !== m % 60) continue;
    slots.push(Math.floor(at.getTime() / 1000));
  }
  return slots;
}

// ── a day, laid out ─────────────────────────────────────────────────

export type DayRow =
  /** A slot with nothing in it. `usable` is false once it is in the past, under 5 minutes away or past 90 days. */
  | { type: 'open'; at: number; usable: boolean }
  /** A post. `slot` is the slot it fills, or null for a post at a time of its own. */
  | { type: 'post'; at: number; entry: CalendarEntry; slot: number | null };

/**
 * A day's rows in time order: its slots, and its posts.
 *
 * WHICH POST FILLS WHICH SLOT. A post fills the slot nearest to it, if
 * that is within 30 minutes and no other post is nearer to that slot.
 * One post per slot, one slot per post, nearest pairs first; a tie goes
 * to the earlier post, then the earlier slot. So a post made for a slot
 * sits exactly in it, a post scheduled in an app for 9:05 still counts
 * as the 9:00 one, and a second post at 9:10 is simply a post at 9:10,
 * shown in time order between the slots with no slot of its own.
 *
 * Every post on the day is placed, whatever its status: one that went
 * out at 9:00 this morning has used the 9:00 slot.
 *
 * `emptySlots` false leaves out slots with nothing in them: for days
 * gone by, where an empty slot is nothing to act on.
 */
export function layoutDay(
  day: Date,
  entries: readonly CalendarEntry[],
  times: PostingTimes,
  nowSeconds: number,
  options: { emptySlots?: boolean } = {}
): DayRow[] {
  const slots = slotsForDay(day, times);
  const limit = SLOT_MATCH_MINUTES * 60;
  const pairs: { gap: number; entry: number; slot: number }[] = [];
  entries.forEach((entry, e) => {
    slots.forEach((slot, s) => {
      const gap = Math.abs(entry.at - slot);
      if (gap <= limit) pairs.push({ gap, entry: e, slot: s });
    });
  });
  pairs.sort((a, b) => a.gap - b.gap || entries[a.entry].at - entries[b.entry].at || a.slot - b.slot);

  const slotOfEntry = new Map<number, number>();
  const takenSlots = new Set<number>();
  for (const pair of pairs) {
    if (slotOfEntry.has(pair.entry) || takenSlots.has(pair.slot)) continue;
    slotOfEntry.set(pair.entry, pair.slot);
    takenSlots.add(pair.slot);
  }

  const rows: (DayRow & { order: number })[] = [];
  entries.forEach((entry, e) => {
    const s = slotOfEntry.get(e);
    // A post in a slot sits where the slot is, so the day keeps its shape.
    rows.push({ type: 'post', at: entry.at, entry, slot: s === undefined ? null : slots[s], order: s === undefined ? entry.at : slots[s] });
  });
  if (options.emptySlots !== false) {
    slots.forEach((slot, s) => {
      if (takenSlots.has(s)) return;
      rows.push({ type: 'open', at: slot, usable: pickedTimeProblem(slot, nowSeconds) === null, order: slot });
    });
  }
  rows.sort((a, b) => a.order - b.order || (a.type === b.type ? 0 : a.type === 'post' ? -1 : 1));
  return rows.map((row): DayRow =>
    row.type === 'open'
      ? { type: 'open', at: row.at, usable: row.usable }
      : { type: 'post', at: row.at, entry: row.entry, slot: row.slot }
  );
}

/**
 * The slots on `day` a post could be moved into or scheduled for now:
 * empty and usable. `ignoreId` is a post that is about to leave its
 * place (the one being moved), so the slot it fills counts as empty.
 */
export function openSlotsOn(
  day: Date,
  entries: readonly CalendarEntry[],
  times: PostingTimes,
  nowSeconds: number,
  ignoreId?: string
): number[] {
  const key = dayKey(day);
  const onDay = entries.filter((e) => e.day === key && e.item.id !== ignoreId);
  return layoutDay(day, onDay, times, nowSeconds)
    .filter((row): row is Extract<DayRow, { type: 'open' }> => row.type === 'open' && row.usable)
    .map((row) => row.at);
}

/**
 * The next few slots a post could go into, from `from` onward, across
 * days: what the Move dialog offers so a post can be moved in a couple of
 * taps without picking a date. Looks at most `maxDays` days ahead.
 */
export function nextOpenSlots(
  from: Date,
  entries: readonly CalendarEntry[],
  times: PostingTimes,
  nowSeconds: number,
  options: { ignoreId?: string; limit?: number; maxDays?: number } = {}
): number[] {
  const limit = options.limit ?? 4;
  const found: number[] = [];
  for (let i = 0; i < (options.maxDays ?? 14) && found.length < limit; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    for (const at of openSlotsOn(day, entries, times, nowSeconds, options.ignoreId)) {
      if (found.length < limit) found.push(at);
    }
  }
  return found;
}

/**
 * Where the picker starts when a day's "+" is used (a post at a time of
 * the person's own choosing on that day): noon, or if that cannot be
 * used any more (today, later on), the next quarter hour an hour from
 * now, the composer's usual start.
 */
export function pickerStartFor(day: Date, nowSeconds: number): number {
  const noon = Math.floor(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0).getTime() / 1000);
  if (pickedTimeProblem(noon, nowSeconds) === null) return noon;
  return Math.ceil((nowSeconds + 3600) / 900) * 900;
}
