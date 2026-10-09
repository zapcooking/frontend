import { SPECIALS } from './specialsConfig';
import {
  archiveStandout,
  choosePosts,
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
 * of each at a time, after the first page has loaded.
 *
 * Spotlights are previews, the same for everyone: a few of a topic's
 * newest posts in the free window from the relay's anonymous preview
 * query, sent as the connection is — no login, never the signer. Opening
 * the full topic feed behind a card is the members' gate, and the feed's
 * business. A relay that refuses a preview (`auth-required:` because it
 * doesn't serve them, or `restricted:` while it holds a stale verdict on a
 * member's logged-in connection) is asked again later (`previewHold`),
 * with a growing wait. A refusal is never "no content": nothing is marked
 * used, thin or tried by it, and nothing is locked for the session.
 *
 * Memories ("on this day", "from the archive") are members-only: the
 * archive stays gated on the relay and there is no anonymous preview of
 * it (decided 2026-10-09; nothing here waits for one). In the background
 * they are asked for only on a connection that is already logged in
 * (`authedOnly`); for a member whose login hasn't happened yet the type
 * simply isn't available until it does (`loggedIn()`), and the signer is
 * never asked for a card. Non-members get no memory cards. "Keep
 * exploring" is a tap, so its full "on this day" may ask the signer once.
 */

/** What the loader needs from FreshClient. */
export interface SpecialsSource extends HistorySource {
  topic(
    slug: string,
    seen: Set<string>,
    until?: number,
    limit?: number,
    opts?: { authedOnly?: boolean; preview?: boolean }
  ): Promise<PageResult>;
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

export type Kind = 'spotlight' | 'memory';

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
  /**
   * The relay said `restricted:` to a members-only request (memories) on a
   * logged-in connection. Not final: the relay holds a failed or unresolved
   * membership lookup for a while, so this is cleared by `loggedIn()` when
   * the feed's login counts again.
   */
  denied = false;
  /** The relay wants a feed login for members-only content (not yet made, or declined). */
  needsLogin = false;
  /** The reader asked (a tap): members-only requests may ask the signer to log in. */
  private interactive = false;
  /** Types with no unshown content left this session (skipped in the rotation). */
  private out = new Set<Kind>();
  private emptyMemories = 0;
  private spotlightBusy = false;
  private memoryBusy = false;
  /** "On this day" (members, labeled), loaded once per session. */
  private daySections: DaySection[] | null = null;
  private triedMonths = new Set<string>();
  /** When the relay last refused a preview (ms clock), and how many times in a row. */
  private previewRefusedAt: number | null = null;
  private previewRefusals = 0;

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

  private clock(): number {
    return this.now.getTime();
  }

  // --- The anonymous preview (everyone) ---

  /** Milliseconds until a refused preview may be asked for again (0 = now). */
  previewHoldLeftMs(): number {
    if (this.previewRefusedAt === null) return 0;
    const wait = Math.min(
      SPECIALS.preview.retryMs * 2 ** Math.max(0, this.previewRefusals - 1),
      SPECIALS.preview.retryMaxMs
    );
    return Math.max(0, this.previewRefusedAt + wait - this.clock());
  }

  /**
   * The relay refused a preview: hold, with a growing wait; nothing else
   * changes. Refusals during one hold (a spotlight and a memory asked for
   * together) count once.
   */
  private refusedPreview(): void {
    if (this.previewRefusedAt !== null && this.previewHoldLeftMs() > 0) return;
    this.previewRefusedAt = this.clock();
    this.previewRefusals++;
  }

  /** A preview was answered: the hold (and its backoff) is over. */
  private previewServed(): void {
    this.previewRefusedAt = null;
    this.previewRefusals = 0;
  }

  private previewsOpen(): boolean {
    return this.previewHoldLeftMs() === 0;
  }

  // --- Members-only content (memories, "Keep exploring") ---

  /**
   * The relay refused a members-only request: `restricted` (the relay's
   * membership check said no, held for a while) or `auth-required` (no
   * feed login yet, or a declined one). Nothing more of that kind is asked
   * until `loggedIn()`. Never "no content".
   */
  private refused(state: 'auth-required' | 'restricted'): void {
    if (state === 'restricted') this.denied = true;
    else this.needsLogin = true;
  }

  /** Out of unshown content this session: skip the type in the rotation. */
  isOut(t: Kind): boolean {
    return this.out.has(t);
  }

  /** Members-only content is waiting for the feed login (or a relay hold) to count. */
  waitingForLogin(): boolean {
    return this.needsLogin || this.denied;
  }

  /**
   * The feed's login counts (again): members-only requests may go again,
   * and what was gathered while it didn't is forgotten. Results answered
   * to a connection the relay treated as a non-member's are not content:
   * an empty "on this day", months that came back empty, the memory type
   * given up on. Idempotent while logged in. Previews don't depend on it.
   */
  loggedIn(): void {
    if (!this.needsLogin && !this.denied) return;
    this.needsLogin = false;
    this.denied = false;
    this.triedMonths.clear();
    this.emptyMemories = 0;
    this.out.delete('memory');
    if (this.daySections && !this.daySections.some((s) => s.posts.length)) this.daySections = null;
  }

  /** May members-only content be asked for? A member, with no login or relay hold pending. */
  memberAccess(): boolean {
    return this.deps.member() && !this.denied && !this.needsLogin;
  }

  // --- Spotlights ---

  /**
   * A spotlight for `lastParent` (default: the session's last one): tries up
   * to maxTopicTries topics, skipping thin ones, each from the relay's
   * anonymous preview. Returns null when none is ready (a refusal starts
   * the preview hold).
   */
  async buildSpotlight(
    lastParent: string | null = this.session.lastParent
  ): Promise<Special | null> {
    if (!this.previewsOpen()) return null;
    const anyLeft = pickTopic(this.deps.groups(), {
      hidden: this.deps.hiddenTopics(),
      used: this.session.usedTopics,
      lastParent: null,
      history: new Map()
    });
    if (!anyLeft && this.deps.groups().length) {
      this.out.add('spotlight'); // every topic used (or hidden) this session
      return null;
    }
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
      const r = await this.src.topic(t.slug, new Set(), undefined, undefined, { preview: true });
      if (r.state === 'auth-required' || r.state === 'restricted') {
        this.refusedPreview();
        return null;
      }
      if (r.state !== 'ok') return null;
      this.previewServed();
      const posts = spotlightPosts(r.events.filter(this.deps.accept), {
        shown: this.deps.shown(),
        exclude: this.deps.exclude()
      });
      if (!posts) {
        // Thin (for this reader): don't ask for it again this session.
        this.session.usedTopics.add(t.slug);
        continue;
      }
      this.session.usedTopics.add(t.slug);
      return { type: 'spotlight', ...t, posts };
    }
    return null;
  }

  /** Keep one spotlight ready for the main feed. */
  async prepareSpotlight(): Promise<void> {
    if (this.spotlight || this.spotlightBusy || !this.previewsOpen()) return;
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

  // --- Memories (members only) ---

  /**
   * "On this day" (members, labeled posts), once per session. In the
   * background only on an already logged-in connection; a tap ("Keep
   * exploring") may ask the signer once.
   */
  async onThisDay(): Promise<DaySection[] | null> {
    if (!this.memberAccess()) return null;
    if (this.daySections) return this.daySections;
    const r = await loadOnThisDay(this.src, this.now, { authedOnly: !this.interactive });
    if (r.state === 'auth-required' || r.state === 'restricted') {
      this.refused(r.state);
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
      if (!this.memberAccess()) return null;
      // Months that end before the free window: the archive, not this week.
      const floor = this.src.floor();
      const months = archiveMonths(this.now).filter(
        (m) => m.window.until < floor && !this.triedMonths.has(m.key)
      );
      if (months.length === 0) return null;
      const month = months[Math.min(months.length - 1, Math.floor(this.rng() * months.length))];
      const r = await new MonthPager(this.src, month, { authedOnly: !this.interactive }).next();
      if (r.state === 'auth-required' || r.state === 'restricted') {
        this.refused(r.state);
        return null;
      }
      if (r.state !== 'ok') return null;
      // Only an answered month is spent; a refused or dropped one may be asked again.
      this.triedMonths.add(month.key);
      const post = archiveStandout(r.posts.filter(this.deps.accept), o);
      if (post)
        return {
          type: 'memory',
          variant,
          label: memoryLabel('archive'),
          heading: month.label,
          posts: [post],
          monthKey: month.key
        };
    }
    return null;
  }

  /** Keep one memory ready (members), alternating "on this day" and "from the archive". */
  async prepareMemory(): Promise<void> {
    if (this.memory || this.memoryBusy || !this.memberAccess()) return;
    this.memoryBusy = true;
    try {
      const first = nextMemoryVariant(this.session.lastMemory);
      for (const v of [first, nextMemoryVariant(first)]) {
        if (!this.memberAccess()) return;
        const m = await this.buildMemory(v);
        if (m) {
          this.memory = m;
          this.session.lastMemory = v;
          this.emptyMemories = 0;
          return;
        }
      }
      // Nothing in either variant, repeatedly: the archive is used up for now.
      if (this.memberAccess() && ++this.emptyMemories >= 3) this.out.add('memory');
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

  // --- Keep exploring ---

  /**
   * "Keep exploring" (the reader asked for it): on this day for members
   * (one login may be asked for, never again after a decline), two preview
   * spotlights from different parent groups, and the recipe row the caller
   * picked. Non-members get the spotlights and the recipes.
   */
  async explore(recipes: RelayEvent[]): Promise<ExploreContent> {
    const out: ExploreContent = { day: null, spotlights: [], recipes };
    this.needsLogin = false;
    this.interactive = true;
    try {
      return await this.exploreContent(out);
    } finally {
      this.interactive = false;
    }
  }

  private async exploreContent(out: ExploreContent): Promise<ExploreContent> {
    const sections = await this.onThisDay();
    if (sections) {
      const all = [...sections]
        .sort((a, b) => a.yearsBack - b.yearsBack)
        .flatMap((s) => s.posts.filter(this.deps.accept));
      const posts = choosePosts(all, {
        shown: this.deps.shown(),
        exclude: this.deps.exclude(),
        max: SPECIALS.explore.dayPosts
      });
      if (posts.length) out.day = { posts };
    }
    let lastParent = this.session.lastParent;
    for (let i = 0; i < SPECIALS.explore.spotlights && this.previewsOpen(); i++) {
      const s = await this.buildSpotlight(lastParent);
      if (!s || s.type !== 'spotlight') break;
      out.spotlights.push(s);
      lastParent = s.parent;
    }
    return out;
  }
}

export interface ExploreContent {
  day: { posts: RelayEvent[] } | null;
  spotlights: Special[];
  recipes: RelayEvent[];
}
