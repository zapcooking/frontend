/**
 * ISO-week identifiers for meal plans — the d-tag clock.
 *
 * A week id is `{isoWeekYear}-W{ww}` (e.g. "2026-W29"): ISO 8601 weeks,
 * Monday start, week-numbering year (NOT calendar year — Jan 1–3 2027
 * fall in 2026-W53), zero-padded week. Resolved from the device's local
 * wall-clock date per docs/mealplan-contract.md.
 */

import {
  addDays,
  addWeeks,
  format,
  getISOWeek,
  getISOWeekYear,
  getISOWeeksInYear,
  startOfISOWeek
} from 'date-fns';

export const MEALPLAN_D_TAG_PREFIX = 'mealplan-';

const WEEK_ID_RE = /^(\d{4})-W(\d{2})$/;

/** Week id for an arbitrary local date. */
export function weekIdForDate(date: Date): string {
  const year = getISOWeekYear(date);
  const week = getISOWeek(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Week id for "now" in the device's local timezone. */
export function currentWeekId(): string {
  return weekIdForDate(new Date());
}

/** Number of ISO weeks (52 or 53) in an ISO week-numbering year. */
export function weeksInISOYear(isoYear: number): number {
  // Jan 4 is always inside week 1 of its ISO year.
  return getISOWeeksInYear(new Date(isoYear, 0, 4));
}

/** Parse a week id into its parts, or null if malformed/out of range. */
export function parseWeekId(weekId: string): { year: number; week: number } | null {
  const m = WEEK_ID_RE.exec(weekId);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > weeksInISOYear(year)) return null;
  return { year, week };
}

export function isValidWeekId(weekId: string): boolean {
  return parseWeekId(weekId) !== null;
}

/** The Monday (local midnight) that starts the given week. */
export function mondayOfWeek(weekId: string): Date {
  const parsed = parseWeekId(weekId);
  if (!parsed) throw new Error(`Invalid week id: ${weekId}`);
  // Jan 4 is always in W01 of its ISO year; walk forward from W01's Monday.
  const w1Monday = startOfISOWeek(new Date(parsed.year, 0, 4));
  return addWeeks(w1Monday, parsed.week - 1);
}

export function nextWeekId(weekId: string): string {
  return weekIdForDate(addWeeks(mondayOfWeek(weekId), 1));
}

export function prevWeekId(weekId: string): string {
  return weekIdForDate(addWeeks(mondayOfWeek(weekId), -1));
}

export function dTagForWeek(weekId: string): string {
  return `${MEALPLAN_D_TAG_PREFIX}${weekId}`;
}

/** Inverse of dTagForWeek; null when the d-tag is not a valid mealplan tag. */
export function weekIdFromDTag(dTag: string): string | null {
  if (!dTag.startsWith(MEALPLAN_D_TAG_PREFIX)) return null;
  const weekId = dTag.slice(MEALPLAN_D_TAG_PREFIX.length);
  return isValidWeekId(weekId) ? weekId : null;
}

/**
 * Human display range, e.g. "Week 29 (Jul 13–19)" or, across a month
 * boundary, "Week 27 (Jun 29–Jul 5)".
 */
export function weekDisplayRange(weekId: string): string {
  const parsed = parseWeekId(weekId);
  if (!parsed) throw new Error(`Invalid week id: ${weekId}`);
  const monday = mondayOfWeek(weekId);
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const range = sameMonth
    ? `${format(monday, 'MMM d')}–${format(sunday, 'd')}`
    : `${format(monday, 'MMM d')}–${format(sunday, 'MMM d')}`;
  return `Week ${parsed.week} (${range})`;
}
