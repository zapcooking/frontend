/**
 * The Scheduled calendar in My Kitchen — its logic, kept out of the
 * components so it can be tested: which posts the calendar shows, which
 * local day each one belongs to, the days a week or a month view lays
 * out, and how far the views may be paged.
 *
 * DAYS ARE LOCAL CALENDAR DAYS, built from date components (year, month,
 * day) and never by adding 86,400 seconds: a local day is 23 or 25 hours
 * long when the clocks change, and seconds arithmetic then puts a post
 * in the wrong day or an hour off. Every Date here is a local midnight
 * made by `new Date(y, m, d)`, and stepping is `setDate` (date-fns
 * addDays / addMonths do the same).
 */

import { addDays, addMonths, startOfMonth } from 'date-fns';
import type { ScheduledItem } from './scheduleClient';
import { SENT_HISTORY_DAYS } from './scheduledList';

/** How far the calendar can be paged: 30 days back (sent history), 90 ahead (the scheduling limit). */
export const CALENDAR_DAYS_BACK = SENT_HISTORY_DAYS;
export const CALENDAR_DAYS_AHEAD = 90;

/** Weeks start on Monday, as in the Planner. */
export const WEEK_STARTS_ON_MONDAY = true;

/** Where the List / Calendar choice and the calendar's own view are remembered, per device. */
export const SCHEDULED_VIEW_KEY = 'zapcooking_scheduled_view';
export const SCHEDULED_CALENDAR_MODE_KEY = 'zapcooking_scheduled_calendar_mode';

export type ScheduledView = 'list' | 'calendar';
export type CalendarMode = 'week' | 'month';

export function parseScheduledView(raw: string | null | undefined): ScheduledView {
  return raw === 'calendar' ? 'calendar' : 'list';
}

export function parseCalendarMode(raw: string | null | undefined): CalendarMode {
  return raw === 'month' ? 'month' : 'week';
}

// ── days ────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** Local midnight of the day `date` falls in. */
export function localDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `YYYY-MM-DD` of the local day: the key posts are bucketed under. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local day a unix-seconds instant falls in, as a key. */
export function dayKeyOf(unixSeconds: number): string {
  return dayKey(new Date(unixSeconds * 1000));
}

/** Monday (local midnight) of the week `date` falls in. */
export function weekStart(date: Date): Date {
  const day = localDay(date);
  const sinceMonday = (day.getDay() + 6) % 7;
  return addDays(day, -sinceMonday);
}

/** The seven days of the week starting at `start`. */
export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * The weeks a month view lays out: whole Monday-to-Sunday rows covering
 * every day of `month`, so the first and last rows may hold days of the
 * neighbouring months.
 */
export function monthWeeks(month: Date): Date[][] {
  const first = startOfMonth(month);
  const next = addMonths(first, 1);
  const weeks: Date[][] = [];
  for (let start = weekStart(first); start < next; start = addDays(start, 7)) {
    weeks.push(weekDays(start));
  }
  return weeks;
}

/**
 * The same time of day as `unixSeconds`, on `day`: what dragging a post
 * to another day means. By wall clock, not by adding days' worth of
 * seconds, so 9:00 stays 9:00 across a clock change. A time that does
 * not exist on that day (2:30 AM when the clocks go forward) becomes the
 * next one that does, as the Date constructor has it.
 */
export function sameTimeOn(day: Date, unixSeconds: number): number {
  const t = new Date(unixSeconds * 1000);
  const moved = new Date(day.getFullYear(), day.getMonth(), day.getDate(), t.getHours(), t.getMinutes(), t.getSeconds());
  return Math.floor(moved.getTime() / 1000);
}

// ── how far the views go ────────────────────────────────────────────

export interface CalendarBounds {
  today: Date;
  /** First day that can be shown. */
  min: Date;
  /** Last day that can be shown. */
  max: Date;
}

export function calendarBounds(nowSeconds: number): CalendarBounds {
  const today = localDay(new Date(nowSeconds * 1000));
  return {
    today,
    min: addDays(today, -CALENDAR_DAYS_BACK),
    max: addDays(today, CALENDAR_DAYS_AHEAD)
  };
}

export function inBounds(day: Date, bounds: CalendarBounds): boolean {
  return day >= bounds.min && day <= bounds.max;
}

/** A week can be shown if any of its days is inside the bounds. */
export function canShowWeek(start: Date, bounds: CalendarBounds): boolean {
  return addDays(start, 6) >= bounds.min && start <= bounds.max;
}

/** A month can be shown if any of its days is inside the bounds. */
export function canShowMonth(month: Date, bounds: CalendarBounds): boolean {
  const first = startOfMonth(month);
  const last = addDays(addMonths(first, 1), -1);
  return last >= bounds.min && first <= bounds.max;
}

// ── what the calendar shows ─────────────────────────────────────────

export type EntryTone = 'pending' | 'publishing' | 'failed' | 'sent';

export interface CalendarEntry {
  item: ScheduledItem;
  /** The instant the entry is placed at: publish time, or for a sent post when it went out. */
  at: number;
  tone: EntryTone;
  day: string;
}

/**
 * The posts the calendar shows, each on its local day, inside the
 * bounds: everything waiting or going out, posts that failed, and posts
 * sent in the last 30 days. Cancelled posts are left out, as in the
 * list. Unlike the list, sent history is not cut to the last ten.
 */
export function calendarEntries(items: readonly ScheduledItem[], nowSeconds: number): CalendarEntry[] {
  const bounds = calendarBounds(nowSeconds);
  const sentCutoff = nowSeconds - SENT_HISTORY_DAYS * 86400;
  const entries: CalendarEntry[] = [];
  for (const item of items) {
    let at = item.publishAt;
    let tone: EntryTone;
    if (item.status === 'pending' || item.status === 'publishing' || item.status === 'failed') {
      tone = item.status;
    } else if (item.status === 'sent') {
      at = item.sentAt ?? item.publishAt;
      if (at < sentCutoff) continue;
      tone = 'sent';
    } else {
      continue;
    }
    const date = new Date(at * 1000);
    if (!inBounds(localDay(date), bounds)) continue;
    entries.push({ item, at, tone, day: dayKey(date) });
  }
  return entries.sort((a, b) => a.at - b.at || a.item.id.localeCompare(b.item.id));
}

/** Entries by local day, each day's in time order. */
export function bucketByDay(entries: readonly CalendarEntry[]): Map<string, CalendarEntry[]> {
  const buckets = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const list = buckets.get(entry.day);
    if (list) list.push(entry);
    else buckets.set(entry.day, [entry]);
  }
  return buckets;
}

export interface DayCounts {
  /** Waiting or going out right now. */
  upcoming: number;
  failed: number;
  sent: number;
}

export function countDay(entries: readonly CalendarEntry[] | undefined): DayCounts {
  const counts: DayCounts = { upcoming: 0, failed: 0, sent: 0 };
  for (const entry of entries ?? []) {
    if (entry.tone === 'failed') counts.failed++;
    else if (entry.tone === 'sent') counts.sent++;
    else counts.upcoming++;
  }
  return counts;
}

/** A day's counts in words, for a screen reader: "2 scheduled, 1 not sent". Empty when there is nothing. */
export function describeCounts(counts: DayCounts): string {
  const parts: string[] = [];
  if (counts.upcoming) parts.push(`${counts.upcoming} scheduled`);
  if (counts.failed) parts.push(`${counts.failed} not sent`);
  if (counts.sent) parts.push(`${counts.sent} posted`);
  return parts.join(', ');
}

// ── wording ─────────────────────────────────────────────────────────

/** "6:30 PM", in the person's own timezone. */
export function entryTime(at: number, locale?: string): string {
  return new Date(at * 1000).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * A time in as few characters as it takes, for a month cell: "9 AM",
 * "12:30 PM". The full form with its ":00" dropped.
 */
export function shortTime(at: number, locale?: string): string {
  // Only where something follows the minutes (an AM/PM marker): a
  // 24-hour "18:00" stays whole, since "18" alone is not a time.
  return entryTime(at, locale).replace(/:00(?=\s*\D)/, '');
}

/** The first line of a post, for a one-line chip. */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}

/** "Nov 23 – 29", "Nov 30 – Dec 6", and with years once the week leaves this one. */
export function weekTitle(start: Date, today: Date, locale?: string): string {
  const end = addDays(start, 6);
  const withYear = start.getFullYear() !== today.getFullYear() || end.getFullYear() !== today.getFullYear();
  const month = (d: Date) => d.toLocaleDateString(locale, { month: 'short' });
  const year = (d: Date) => (withYear ? `, ${d.getFullYear()}` : '');
  if (start.getMonth() === end.getMonth()) {
    return `${month(start)} ${start.getDate()} – ${end.getDate()}${year(end)}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${month(start)} ${start.getDate()}${sameYear ? '' : year(start)} – ${month(end)} ${end.getDate()}${year(end)}`;
}

/** "November 2026". */
export function monthTitle(month: Date, locale?: string): string {
  return month.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
