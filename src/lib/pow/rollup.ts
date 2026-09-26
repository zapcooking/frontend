/**
 * Merged-PR records → the /pow Summary. Pure: no I/O, and "now" is a
 * parameter so the streak is testable.
 *
 * Day and month keys are calendar dates in TIME_ZONE (via Intl, so DST is
 * handled by the platform's tz data, not by a fixed offset). Day stepping
 * is done on the calendar string itself, which a DST shift cannot skew.
 */

import { BOT_AUTHORS, REPOS, START, TIME_ZONE, isPowRepo, type PowRepo } from './config';
import type { ContributorEntry, LineTotals, PrRecord, Summary } from './types';

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** `YYYY-MM-DD` of the instant, in TIME_ZONE. */
export function zonedDate(instant: Date): string {
  const parts = dayFormatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Calendar arithmetic on a `YYYY-MM-DD` string. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyTotals(): LineTotals {
  return { prs: 0, additions: 0, deletions: 0, countedAdditions: 0, countedDeletions: 0 };
}

function addTo(t: LineTotals, r: PrRecord): void {
  t.prs += 1;
  t.additions += r.additions;
  t.deletions += r.deletions;
  t.countedAdditions += r.countedAdditions;
  t.countedDeletions += r.countedDeletions;
}

function repoCounts(): Record<PowRepo, number> {
  return Object.fromEntries(REPOS.map((r) => [r, 0])) as Record<PowRepo, number>;
}

function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function computeStreak(activeDays: Set<string>, today: string): Summary['streak'] {
  // Current: a day with no merge YET doesn't break it — count through yesterday.
  let current = 0;
  let currentStart: string | null = null;
  let cursor = activeDays.has(today) ? today : addDays(today, -1);
  while (activeDays.has(cursor)) {
    current += 1;
    currentStart = cursor;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let longestStart: string | null = null;
  let longestEnd: string | null = null;
  let runStart: string | null = null;
  let runLength = 0;
  let prev: string | null = null;
  for (const day of [...activeDays].sort()) {
    if (prev !== null && addDays(prev, 1) === day) {
      runLength += 1;
    } else {
      runStart = day;
      runLength = 1;
    }
    if (runLength > longest) {
      longest = runLength;
      longestStart = runStart;
      longestEnd = day;
    }
    prev = day;
  }

  return { current, currentStart, longest, longestStart, longestEnd };
}

export function rollup(input: readonly PrRecord[], now: Date): Summary {
  // Defense in depth: REPOS is the allowlist even if a stray record got stored.
  const byId = new Map<string, PrRecord>();
  for (const r of input) {
    if (isPowRepo(r.repo) && r.mergedAt >= START) byId.set(r.id, r);
  }
  const records = [...byId.values()].sort((a, b) =>
    a.mergedAt < b.mergedAt ? 1 : a.mergedAt > b.mergedAt ? -1 : 0
  );

  const today = zonedDate(now);
  const totals = emptyTotals();
  const byRepo = Object.fromEntries(REPOS.map((r) => [r, emptyTotals()])) as Record<
    PowRepo,
    LineTotals
  >;
  const daily: Summary['daily'] = {};
  // START is UTC midnight (to match GitHub search), which is still Dec 31 in
  // TIME_ZONE. The few merges in that gap are clamped onto START's calendar
  // day so daily, monthly and totals always agree.
  const firstDay = START.slice(0, 10);
  const monthKeys = monthRange(firstDay.slice(0, 7), today.slice(0, 7));
  const monthly = new Map(
    monthKeys.map((month) => [month, { month, ...emptyTotals(), byRepo: repoCounts() }])
  );
  const humans = new Map<string, ContributorEntry>();
  const automation: ContributorEntry = {
    kind: 'automation',
    login: 'Automation',
    prs: 0,
    countedAdditions: 0,
    countedDeletions: 0
  };

  for (const r of records) {
    const zoned = zonedDate(new Date(r.mergedAt));
    const day = zoned < firstDay ? firstDay : zoned;
    addTo(totals, r);
    addTo(byRepo[r.repo], r);

    const d = (daily[day] ??= {});
    d[r.repo] = (d[r.repo] ?? 0) + 1;

    // Always present: day is within [firstDay, today] unless a merge is
    // timestamped in the future, which GitHub doesn't produce.
    const m = monthly.get(day.slice(0, 7));
    if (m) {
      addTo(m, r);
      m.byRepo[r.repo] += 1;
    }

    const isBot = r.author !== null && BOT_AUTHORS.includes(r.author);
    let c = automation;
    if (!isBot) {
      const login = r.author ?? 'ghost';
      c = humans.get(login) ?? {
        kind: 'human',
        login,
        prs: 0,
        countedAdditions: 0,
        countedDeletions: 0
      };
      humans.set(login, c);
    }
    c.prs += 1;
    c.countedAdditions += r.countedAdditions;
    c.countedDeletions += r.countedDeletions;
  }

  const contributors = [...humans.values()].sort(
    (a, b) => b.prs - a.prs || a.login.localeCompare(b.login)
  );
  if (automation.prs > 0) contributors.push(automation);

  const activeDays = new Set(Object.keys(daily));

  return {
    tz: TIME_ZONE,
    start: START,
    generatedAt: now.toISOString(),
    asOfDate: today,
    totals: { ...totals, contributors: humans.size, activeDays: activeDays.size },
    byRepo,
    daily,
    monthly: [...monthly.values()],
    contributors,
    streak: computeStreak(activeDays, today),
    recent: records.slice(0, 20)
  };
}
