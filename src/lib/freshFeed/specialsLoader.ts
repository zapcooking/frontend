import { SPECIALS } from './specialsConfig';
import {
  archiveStandout,
  dayMemory,
  memoryLabel,
  nextMemoryVariant,
  pickTopic,
  Rotation,
  spotlightPosts,
  type MemoryVariant,
  type Rng,
  type Special,
  type TopicPick
} from './specials';
import { loadOnThisDay, MonthPager, type HistorySource } from './archiveLoader';
import { archiveMonths, type DaySection } from './archive';
import type { PageResult, RelayEvent } from './relay';
import type { TopicGroup } from './topicList';

/**
 * Gets the next spotlight and memory card ready ahead of their slots, one
 * of each at a time, after the first page has loaded. Members only: for
 * anyone else nothing is ever requested (topics and the archive are
 * members-only on the relay). The recipe box and the non-member teaser need
 * no requests of their own.
 */

/** What the loader needs from FreshClient. */
export interface SpecialsSource extends HistorySource {
  topic(slug: string, seen: Set<string>, until?: number, limit?: number): Promise<PageResult>;
  floor(): number;
}

export interface LoaderDeps {
  member: () => boolean;
  groups: () => TopicGroup[];
  hiddenTopics: () => string[];
  /** Posts this device has shown in cards. */
  shown: () => Map<string, number>;
  /** Posts already on screen (the feed, other cards). */
  exclude: () => Set<string>;
  /** The reader's filters (mutes, hellthreads). */
  accept: (e: RelayEvent) => boolean;
  topicHistory: () => Map<string, number>;
  now?: () => Date;
  rng?: Rng;
}

/** One tab's session: caps and "no repeat" span the whole visit. */
export class SpecialsSession {
  usedTopics = new Set<string>();
  lastParent: string | null = null;
  lastMemory: MemoryVariant | null = null;
  rotation = new Rotation();
}

let tabSession: SpecialsSession | null = null;

/** This tab's session, shared by every Fresh view until a reload. */
export function specialsTabSession(): SpecialsSession {
  tabSession ??= new SpecialsSession();
  return tabSession;
}

export class SpecialsLoader {
  spotlight: Special | null = null;
  memory: Special | null = null;
  /** The relay said no (not a member there): stop asking this session. */
  locked = false;
  private spotlightBusy = false;
  private memoryBusy = false;
  private daySections: DaySection[] | null = null;
  private triedMonths = new Set<string>();

  constructor(
    private src: SpecialsSource,
    private deps: LoaderDeps,
    readonly session: SpecialsSession = new SpecialsSession()
  ) {}

  private get rng(): Rng {
    return this.deps.rng ?? Math.random;
  }

  private get now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private usable(): boolean {
    return this.deps.member() && !this.locked;
  }

  /** The next spotlight topic for a non-member teaser (no request). */
  teaser(): Special | null {
    const t = pickTopic(this.deps.groups(), {
      hidden: this.deps.hiddenTopics(),
      used: this.session.usedTopics,
      lastParent: this.session.lastParent,
      history: this.deps.topicHistory(),
      rng: this.rng
    });
    return t ? { type: 'teaser', ...t } : null;
  }

  /**
   * A spotlight for `lastParent` (default: the session's last one): tries up
   * to maxTopicTries topics, skipping thin ones. Returns null when none is
   * ready (and remembers a relay "no").
   */
  async buildSpotlight(
    lastParent: string | null = this.session.lastParent
  ): Promise<Special | null> {
    if (!this.usable()) return null;
    const tried = new Set<string>();
    for (let i = 0; i < SPECIALS.spotlight.maxTopicTries; i++) {
      const t: TopicPick | null = pickTopic(this.deps.groups(), {
        hidden: this.deps.hiddenTopics(),
        used: this.session.usedTopics,
        lastParent,
        history: this.deps.topicHistory(),
        tried,
        rng: this.rng
      });
      if (!t) return null;
      tried.add(t.slug);
      // Older than the free window: the topic's archive, not posts the
      // reader is scrolling past in the feed right now.
      const r = await this.src.topic(
        t.slug,
        new Set(),
        this.src.floor() - 1,
        SPECIALS.spotlight.fetchLimit
      );
      if (r.state === 'auth-required' || r.state === 'restricted') {
        this.locked = true;
        return null;
      }
      if (r.state !== 'ok') return null;
      const posts = spotlightPosts(r.events.filter(this.deps.accept), {
        shown: this.deps.shown(),
        exclude: this.deps.exclude()
      });
      if (!posts) continue; // thin topic
      this.session.usedTopics.add(t.slug);
      return { type: 'spotlight', ...t, posts };
    }
    return null;
  }

  /** Keep one spotlight ready for the main feed. */
  async prepareSpotlight(): Promise<void> {
    if (this.spotlight || this.spotlightBusy || !this.usable()) return;
    this.spotlightBusy = true;
    try {
      const s = await this.buildSpotlight();
      if (s && s.type === 'spotlight') {
        this.spotlight = s;
        this.session.lastParent = s.parent;
      }
    } finally {
      this.spotlightBusy = false;
    }
  }

  /** The ready spotlight (the caller prepares the next one). */
  takeSpotlight(): Special | null {
    const s = this.spotlight;
    this.spotlight = null;
    return s;
  }

  /** "On this day" sections, loaded once per session. */
  async onThisDay(): Promise<DaySection[] | null> {
    if (!this.usable()) return null;
    if (this.daySections) return this.daySections;
    const r = await loadOnThisDay(this.src, this.now);
    if (r.state === 'auth-required' || r.state === 'restricted') {
      this.locked = true;
      return null;
    }
    if (r.state !== 'ok') return null;
    this.daySections = r.sections;
    return r.sections;
  }

  private async buildMemory(variant: MemoryVariant): Promise<Special | null> {
    const o = { shown: this.deps.shown(), exclude: this.deps.exclude() };
    if (variant === 'day') {
      const sections = await this.onThisDay();
      if (!sections) return null;
      const accepted = sections.map((s) => ({ ...s, posts: s.posts.filter(this.deps.accept) }));
      const m = dayMemory(accepted, o);
      if (!m) return null;
      const section = sections.find((s) => s.yearsBack === m.yearsBack)!;
      const heading = new Date(section.window.since * 1000).toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
      return {
        type: 'memory',
        variant,
        label: memoryLabel('day', m.yearsBack),
        heading,
        posts: m.posts
      };
    }
    // Random time-machine months (not tried yet) until one has a post worth
    // showing.
    for (let i = 0; i < SPECIALS.memory.archiveMonthTries; i++) {
      // Months that end before the free window: the archive, not this week.
      const floor = this.src.floor();
      const months = archiveMonths(this.now).filter(
        (m) => m.window.until < floor && !this.triedMonths.has(m.key)
      );
      if (months.length === 0) return null;
      const month = months[Math.min(months.length - 1, Math.floor(this.rng() * months.length))];
      this.triedMonths.add(month.key);
      const r = await new MonthPager(this.src, month).next();
      if (r.state === 'auth-required' || r.state === 'restricted') {
        this.locked = true;
        return null;
      }
      if (r.state !== 'ok') return null;
      const post = archiveStandout(r.posts.filter(this.deps.accept), o);
      if (post)
        return {
          type: 'memory',
          variant,
          label: memoryLabel('archive'),
          heading: month.label,
          posts: [post]
        };
    }
    return null;
  }

  /** Keep one memory ready, alternating "on this day" and "from the archive". */
  async prepareMemory(): Promise<void> {
    if (this.memory || this.memoryBusy || !this.usable()) return;
    this.memoryBusy = true;
    try {
      const first = nextMemoryVariant(this.session.lastMemory);
      for (const v of [first, nextMemoryVariant(first)]) {
        if (!this.usable()) return;
        const m = await this.buildMemory(v);
        if (m) {
          this.memory = m;
          this.session.lastMemory = v;
          return;
        }
      }
    } finally {
      this.memoryBusy = false;
    }
  }

  /** The ready memory (the caller prepares the next one). */
  takeMemory(): Special | null {
    const m = this.memory;
    this.memory = null;
    return m;
  }
}
