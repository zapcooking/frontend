import type { HistoryResult, PageState, RelayEvent } from './relay';
import {
  capPerAuthor,
  dayWindow,
  labelTopics,
  labeledOnly,
  visibleSections,
  type DaySection,
  type Month
} from './archive';

/** What the archive loaders need from FreshClient. */
export interface HistorySource {
  history(
    since: number,
    until: number,
    opts?: { authedOnly?: boolean; limit?: number }
  ): Promise<HistoryResult>;
}

export type ArchiveState = PageState | 'ok';

/**
 * "On this day": today's local date 1, 2 and 3 years back, labeled posts
 * only, at most 2 per author per day; 3 years back only with ≥3 posts.
 * One request per year (a day is far under the relay's 500-post page) plus
 * its label requests. `authedOnly` for the caught-up card (no signer prompt).
 */
export async function loadOnThisDay(
  src: HistorySource,
  now: Date,
  opts: { authedOnly?: boolean } = {}
): Promise<{ state: ArchiveState; sections: DaySection[] }> {
  const sections: DaySection[] = [];
  for (const yearsBack of [1, 2, 3]) {
    const window = dayWindow(now, yearsBack);
    const r = await src.history(window.since, window.until, opts);
    if (r.state !== 'ok') return { state: r.state, sections: [] };
    const posts = capPerAuthor(labeledOnly(r.events, labelTopics(r.labels)));
    sections.push({ yearsBack, window, posts });
  }
  return { state: 'ok', sections: visibleSections(sections) };
}

/**
 * The time machine's pages for one month: labeled posts, newest first,
 * paged back through the month (the relay's `until` is inclusive, so ids
 * already shown are skipped).
 */
export class MonthPager {
  private until: number;
  private seen = new Set<string>();
  done = false;
  labeled = 0;

  constructor(
    private src: HistorySource,
    readonly month: Month,
    /** authedOnly: only on an already logged-in connection (no signer prompt). */
    private opts: { authedOnly?: boolean } = {}
  ) {
    this.until = month.window.until;
  }

  async next(): Promise<{ state: ArchiveState; posts: RelayEvent[] }> {
    if (this.done) return { state: 'ok', posts: [] };
    const r = await this.src.history(this.month.window.since, this.until, this.opts);
    if (r.state !== 'ok') return { state: r.state, posts: [] };
    const fresh = r.events.filter((e) => !this.seen.has(e.id));
    for (const e of fresh) this.seen.add(e.id);
    // A full page that brought nothing new: more posts share the boundary
    // second than fit on a page; step past it.
    if (r.end === 'more' && fresh.length === 0) this.until = (r.nextUntil ?? this.until) - 1;
    else if (r.nextUntil !== undefined) this.until = r.nextUntil;
    if (r.end !== 'more' || this.until < this.month.window.since) this.done = true;
    const posts = labeledOnly(fresh, labelTopics(r.labels));
    this.labeled += posts.length;
    return { state: 'ok', posts };
  }
}
