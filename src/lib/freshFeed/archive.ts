import { LABELER_PUBKEY, type RelayEvent } from './relay';

export { LABELER_PUBKEY };

/**
 * Fresh's archive views (members): "On this day" and the time machine.
 * Pure date and selection rules; the requests are FreshClient.history().
 *
 * Both show topic-labeled posts only: the relay's labeler (kind 1985,
 * namespace cooking.zap.topic) labels on-topic food posts, so an unlabeled
 * old post is the likeliest to be off-topic.
 */

export const TOPIC_NAMESPACE = 'cooking.zap.topic';
/** "On this day": at most this many posts per author per day. */
export const PER_AUTHOR_PER_DAY = 2;
/** 3 years back shows only with at least this many posts. */
export const THREE_YEARS_MIN = 3;
/** The time machine's first month (the archive starts here). */
export const ARCHIVE_START = { year: 2023, month: 4 };
/** A fully loaded month with fewer labeled posts than this is "early days". */
export const EARLY_DAYS_MAX = 20;

export interface Window {
  since: number;
  until: number;
}

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * The reader's local calendar day, `yearsBack` years before `now`, as an
 * inclusive [since, until] in unix seconds. Feb 29 in a year without one is
 * Feb 28.
 */
export function dayWindow(now: Date, yearsBack: number): Window {
  const y = now.getFullYear() - yearsBack;
  let start = new Date(y, now.getMonth(), now.getDate());
  if (start.getMonth() !== now.getMonth()) start = new Date(y, now.getMonth() + 1, 0);
  const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { since: sec(start), until: sec(next) - 1 };
}

/** Topics per post from label events (only the labeler's, only our namespace). */
export function labelTopics(labels: RelayEvent[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const ev of labels) {
    if (ev.kind !== 1985 || ev.pubkey !== LABELER_PUBKEY) continue;
    const topics = ev.tags
      .filter((t) => t[0] === 'l' && t[2] === TOPIC_NAMESPACE && t[1])
      .map((t) => t[1]);
    if (!topics.length) continue;
    for (const t of ev.tags) if (t[0] === 'e' && t[1]) out.set(t[1], topics);
  }
  return out;
}

/** Labeled posts only, newest first. */
export function labeledOnly(events: RelayEvent[], topics: Map<string, string[]>): RelayEvent[] {
  return events
    .filter((e) => topics.has(e.id))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
}

/** At most `max` posts per author, keeping each author's newest. Order kept. */
export function capPerAuthor(events: RelayEvent[], max = PER_AUTHOR_PER_DAY): RelayEvent[] {
  const n = new Map<string, number>();
  return events.filter((e) => {
    const c = n.get(e.pubkey) ?? 0;
    n.set(e.pubkey, c + 1);
    return c < max;
  });
}

export interface DaySection {
  yearsBack: number;
  window: Window;
  posts: RelayEvent[];
}

/** Which "On this day" sections to show: 1 and 2 years when they have posts; 3 only with ≥3. */
export function visibleSections(sections: DaySection[]): DaySection[] {
  return sections.filter((s) =>
    s.yearsBack >= 3 ? s.posts.length >= THREE_YEARS_MIN : s.posts.length > 0
  );
}

export interface Month {
  /** "2025-10" */
  key: string;
  label: string;
  window: Window;
}

/** One local calendar month as an inclusive window. */
export function monthWindow(year: number, month: number): Window {
  return {
    since: sec(new Date(year, month - 1, 1)),
    until: sec(new Date(year, month, 1)) - 1
  };
}

/** Every month from ARCHIVE_START to `now`'s month, newest first. */
export function archiveMonths(now: Date): Month[] {
  const out: Month[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  while (y > ARCHIVE_START.year || (y === ARCHIVE_START.year && m >= ARCHIVE_START.month)) {
    const d = new Date(y, m - 1, 1);
    out.push({
      key: `${y}-${String(m).padStart(2, '0')}`,
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      window: monthWindow(y, m)
    });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** A month whose posts are all loaded and number fewer than EARLY_DAYS_MAX. */
export function isEarlyDays(labeledCount: number, fullyLoaded: boolean): boolean {
  return fullyLoaded && labeledCount < EARLY_DAYS_MAX;
}

/** "1 year ago", "2 years ago". */
export function yearsAgoLabel(n: number): string {
  return n === 1 ? '1 year ago' : `${n} years ago`;
}

/** Drop section headings left with no rows under them (after reader filters). */
export function dropEmptyHeaders<T extends { header?: string }>(rows: T[]): T[] {
  return rows.filter((r, i) => !r.header || (i + 1 < rows.length && !rows[i + 1].header));
}
