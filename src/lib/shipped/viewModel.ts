/**
 * Pure view-model math for the /pow page. No DOM, no fetch — everything
 * the page shows is derived here from the /api/pow payload, so it's
 * unit-testable (vitest can't render the Svelte components).
 */

import { BOT_AUTHORS, REPOS, START_MS, type PowRepo } from './config';
import { zonedDate } from './rollup';
import type { PowPayload, PrRecord } from './types';

export const REPO_LABELS: Record<PowRepo, string> = {
  frontend: 'Web',
  zap_cooking_android: 'Android',
  zapcooking_ios: 'iOS'
};

export type RepoFilter = 'all' | PowRepo;

export const FILTERS: ReadonlyArray<{ value: RepoFilter; label: string }> = [
  { value: 'all', label: 'All' },
  ...REPOS.map((r) => ({ value: r, label: REPO_LABELS[r] }))
];

const numberFormat = new Intl.NumberFormat('en-US');
export const formatNumber = (n: number): string => numberFormat.format(n);

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Calendar arithmetic on `YYYY-MM-DD`, immune to DST. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "Mar 9, 2026" for a `YYYY-MM-DD` calendar date. */
export function formatDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

/** "Mar 2026" for a `YYYY-MM` month. */
export function formatMonth(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

/** The first day on the heat map: START's calendar date in the summary's zone. */
export const FIRST_DAY = zonedDate(new Date(START_MS));

/** Conventional-commit types we strip from display titles. */
const CONVENTIONAL_PREFIX =
  /^(?:feat|fix|chore|docs|refactor|perf|tests?|build|ci|style|revert)(?:\([^)]*\))?!?:\s*/i;

/**
 * "feat(nav): match iOS — …" → "Match iOS — …". Only known conventional
 * types are stripped, so "Note: …" survives; the first letter is
 * capitalized either way.
 */
export function displayTitle(title: string): string {
  const trimmed = title.trim();
  const stripped = trimmed.replace(CONVENTIONAL_PREFIX, '').trim() || trimmed;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function isBot(author: string | null): boolean {
  return author !== null && BOT_AUTHORS.includes(author);
}

/** The newest merges by people (never the Automation bucket), newest first. */
export function recentShipped(p: PowPayload, limit = 10): PrRecord[] {
  return [...p.recent]
    .filter((r) => !isBot(r.author))
    .sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : a.mergedAt > b.mergedAt ? -1 : 0))
    .slice(0, limit);
}

export interface HeatCell {
  date: string;
  /** Merges that day under the active filter. */
  count: number;
  byRepo: Record<PowRepo, number>;
  /** 0 (none) … 4 (the busiest day under the filter). */
  level: 0 | 1 | 2 | 3 | 4;
  /** Column (week) and row (0 = Sunday). */
  week: number;
  weekday: number;
}

function repoCounts(entry: Partial<Record<PowRepo, number>> | undefined): Record<PowRepo, number> {
  return Object.fromEntries(REPOS.map((r) => [r, entry?.[r] ?? 0])) as Record<PowRepo, number>;
}

/** One cell per calendar day in the summary's zone, FIRST_DAY through `today`. */
export function heatCells(
  p: PowPayload,
  today: string,
  filter: RepoFilter
): { cells: HeatCell[]; weeks: number; max: number } {
  const offset = weekdayOf(FIRST_DAY);
  const raw: Array<Omit<HeatCell, 'level'>> = [];
  for (let date = FIRST_DAY, i = 0; date <= today; date = addDays(date, 1), i++) {
    const byRepo = repoCounts(p.daily[date]);
    const count =
      filter === 'all' ? REPOS.reduce((n, r) => n + byRepo[r], 0) : byRepo[filter];
    raw.push({ date, count, byRepo, week: Math.floor((i + offset) / 7), weekday: (i + offset) % 7 });
  }
  const max = raw.reduce((m, c) => Math.max(m, c.count), 0);
  const cells = raw.map((c) => ({
    ...c,
    level: (c.count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((4 * c.count) / max)))) as HeatCell['level']
  }));
  return { cells, weeks: cells.length ? cells[cells.length - 1].week + 1 : 0, max };
}

export interface Facts {
  hottestDay: { date: string; count: number } | null;
  currentStreak: number;
  longestStreak: number;
  longestStart: string | null;
  longestEnd: string | null;
  busiestWeekday: { name: string; count: number } | null;
  biggestMonth: { month: string; prs: number } | null;
}

export function facts(p: PowPayload): Facts {
  let hottestDay: Facts['hottestDay'] = null;
  const perWeekday = new Array(7).fill(0) as number[];
  for (const [date, entry] of Object.entries(p.daily)) {
    const count = REPOS.reduce((n, r) => n + (entry[r] ?? 0), 0);
    perWeekday[weekdayOf(date)] += count;
    // Ties go to the most recent day.
    if (!hottestDay || count > hottestDay.count || (count === hottestDay.count && date > hottestDay.date)) {
      hottestDay = { date, count };
    }
  }
  const topWeekday = perWeekday.reduce((best, n, i) => (n > perWeekday[best] ? i : best), 0);
  let biggestMonth: Facts['biggestMonth'] = null;
  for (const m of p.monthly) {
    if (m.prs > 0 && (!biggestMonth || m.prs >= biggestMonth.prs)) {
      biggestMonth = { month: m.month, prs: m.prs };
    }
  }
  return {
    hottestDay,
    currentStreak: p.streak.current,
    longestStreak: p.streak.longest,
    longestStart: p.streak.longestStart,
    longestEnd: p.streak.longestEnd,
    busiestWeekday:
      perWeekday[topWeekday] > 0 ? { name: WEEKDAYS[topWeekday], count: perWeekday[topWeekday] } : null,
    biggestMonth
  };
}

export interface MonthRow {
  month: string;
  label: string;
  prs: number;
  countedAdditions: number;
  countedDeletions: number;
  byRepo: Record<PowRepo, number>;
  /** PRs merged from START through the end of this month. */
  cumulative: number;
}

export function monthlyRows(p: PowPayload): MonthRow[] {
  let cumulative = 0;
  return p.monthly.map((m) => {
    cumulative += m.prs;
    return {
      month: m.month,
      label: formatMonth(m.month),
      prs: m.prs,
      countedAdditions: m.countedAdditions,
      countedDeletions: m.countedDeletions,
      byRepo: m.byRepo,
      cumulative
    };
  });
}

/** The header's one-line summary. Counted lines, not raw. */
export function summarySentence(p: PowPayload): string {
  const t = p.totals;
  const people = t.contributors === 1 ? 'contributor' : 'contributors';
  const days = t.activeDays === 1 ? 'active day' : 'active days';
  return (
    `${formatNumber(t.prs)} pull requests merged, ` +
    `+${formatNumber(t.countedAdditions)} / −${formatNumber(t.countedDeletions)} lines, ` +
    `${formatNumber(t.contributors)} ${people}, ${formatNumber(t.activeDays)} ${days}.`
  );
}

export type PageData =
  | { state: 'ok'; summary: PowPayload }
  | { state: 'unconfigured' | 'unavailable' };

export type PageView =
  | { kind: 'empty' }
  | { kind: 'ok'; counting: boolean; stale: boolean };

/** What the page shows: numbers (maybe "still counting", maybe stale) or a calm empty state. */
export function pageState(data: PageData): PageView {
  if (data.state !== 'ok') return { kind: 'empty' };
  return { kind: 'ok', counting: !data.summary.complete, stale: data.summary.stale };
}
