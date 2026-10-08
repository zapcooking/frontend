import { SPECIALS, type SpecialType } from './specialsConfig';
import { spotlightTitle } from './spotlightTitles';
import { isImageUrl, mediaUrls } from './posts';
import type { RelayEvent } from './relay';
import type { TopicGroup } from './topicList';
import type { DaySection } from './archive';

/**
 * Fresh's special cards, as pure decisions ($lib/freshFeed/specialsConfig
 * has every number):
 *
 * - Where: the first card at a random position 6–8, then one every 7–10
 *   posts (jittered). Positions 1–5 are always posts.
 * - Which: recipe box → topic spotlight → memory → …, never the same type
 *   twice in a row (while another type can still appear), each type up to
 *   its per-session cap. A type the reader asked to see fewer of has a
 *   lower cap and takes only every other turn. A slot far below the screen
 *   waits for its own type; near the screen, the next ready type takes it;
 *   with nothing ready by the time the reader gets there, it is skipped.
 * - What: spotlight topics rotate across all topics (never the same parent
 *   group twice in a row, no repeat in a session, least recently shown
 *   first, thin topics skipped); posts prefer images, one per author, and
 *   nothing this device has shown before.
 */

export type Rng = () => number;

function between(rng: Rng, r: { min: number; max: number }): number {
  return r.min + Math.min(r.max - r.min, Math.floor(rng() * (r.max - r.min + 1)));
}

// --- Where ---

/**
 * The slots' anchors: card k goes after the anchors[k]-th post (1-based).
 * Grows lazily so a long feed keeps getting slots; the same Slots object
 * always returns the same positions.
 */
export class Slots {
  private anchors: number[] = [];
  constructor(private rng: Rng = Math.random) {}

  /** Anchors (post counts) up to and including `postCount`. */
  upTo(postCount: number): number[] {
    if (this.anchors.length === 0)
      this.anchors.push(
        Math.max(SPECIALS.leadPosts, between(this.rng, SPECIALS.firstPosition) - 1)
      );
    while (this.anchors[this.anchors.length - 1] <= postCount)
      this.anchors.push(this.anchors[this.anchors.length - 1] + between(this.rng, SPECIALS.gap));
    return this.anchors.filter((a) => a <= postCount);
  }
}

// --- Which ---

export interface RotationPrefs {
  fewer: Record<SpecialType, boolean>;
}

export function capsFor(member: boolean, prefs: RotationPrefs): Record<SpecialType, number> {
  const base = member ? SPECIALS.caps : SPECIALS.freeCaps;
  const out = { ...base };
  for (const t of SPECIALS.rotation)
    if (prefs.fewer[t]) out[t] = Math.min(base[t], SPECIALS.fewerCap);
  return out;
}

/** The session's rotation: what was shown, how often, what comes next. */
export class Rotation {
  counts: Record<SpecialType, number> = { recipe: 0, spotlight: 0, memory: 0 };
  last: SpecialType | null = null;
  private next = 0;
  private turns: Record<SpecialType, number> = { recipe: 0, spotlight: 0, memory: 0 };

  /**
   * The type for the next slot: the rotation's next type that is under its
   * cap, has its turn (fewer: every Nth), has something ready, and isn't
   * the last one shown, unless no other type can still appear for this
   * reader (non-members after their one teaser get recipes only).
   * `strict` (the slot is still far below the screen): only the rotation's
   * own next type counts, so a card that is still loading isn't replaced by
   * another one. null = wait (strict) or skip this slot.
   */
  choose(
    ready: (t: SpecialType) => boolean,
    caps: Record<SpecialType, number>,
    prefs: RotationPrefs,
    strict = false
  ): SpecialType | null {
    const order = SPECIALS.rotation;
    const open = (t: SpecialType) => this.counts[t] < caps[t];
    const repeatOk = !order.some((t) => t !== this.last && open(t));
    for (let i = 0; i < order.length; i++) {
      const t = order[(this.next + i) % order.length];
      if (!open(t) || (t === this.last && !repeatOk)) continue;
      if (prefs.fewer[t]) {
        this.turns[t]++;
        if (this.turns[t] % SPECIALS.fewerTurnEvery !== 0) continue;
      }
      if (ready(t)) return t;
      if (strict) return null;
    }
    return null;
  }

  record(t: SpecialType): void {
    this.counts[t]++;
    this.last = t;
    this.next = (SPECIALS.rotation.indexOf(t) + 1) % SPECIALS.rotation.length;
  }
}

// --- What: spotlight topics ---

export interface TopicPick {
  slug: string;
  name: string;
  parent: string;
  title: string;
}

/** Every leaf topic (all 44, not just the featured ones), with its parent group. */
export function allTopics(groups: TopicGroup[]): TopicPick[] {
  return groups.flatMap((g) =>
    g.topics.map((t) => ({
      slug: t.slug,
      name: t.name,
      parent: g.slug,
      title: spotlightTitle(t.slug, t.name)
    }))
  );
}

/**
 * The next spotlight topic: not hidden, not used this session, not tried
 * (thin) this time, not the same parent group as the last spotlight; the
 * least recently shown on this device first (never shown before = first),
 * ties broken at random.
 */
export function pickTopic(
  groups: TopicGroup[],
  o: {
    hidden: Iterable<string>;
    used: Set<string>;
    lastParent: string | null;
    history: Map<string, number>;
    tried?: Set<string>;
    rng?: Rng;
  }
): TopicPick | null {
  const hidden = new Set(o.hidden);
  const rng = o.rng ?? Math.random;
  const open = allTopics(groups).filter(
    (t) =>
      !hidden.has(t.slug) &&
      !o.used.has(t.slug) &&
      !(o.tried?.has(t.slug) ?? false) &&
      t.parent !== o.lastParent
  );
  if (open.length === 0) return null;
  const keyed = open.map((t) => ({ t, last: o.history.get(t.slug) ?? 0, r: rng() }));
  keyed.sort((a, b) => a.last - b.last || a.r - b.r);
  return keyed[0].t;
}

// --- What: posts ---

export function hasImage(e: Pick<RelayEvent, 'content' | 'tags'>): boolean {
  if (e.tags.some((t) => t[0] === 'image' && t[1])) return true;
  return mediaUrls(e.content || '').some((u) => isImageUrl(u));
}

/**
 * Up to `max` posts: not shown on this device, not excluded (already in the
 * feed or another card), one per author, posts with images first (otherwise
 * in the given order).
 */
export function choosePosts(
  events: RelayEvent[],
  o: { shown: Map<string, number> | Set<string>; exclude: Set<string>; max: number }
): RelayEvent[] {
  const fresh = events.filter((e) => !o.shown.has(e.id) && !o.exclude.has(e.id));
  const ordered = [...fresh.filter(hasImage), ...fresh.filter((e) => !hasImage(e))];
  const authors = new Set<string>();
  const out: RelayEvent[] = [];
  for (const e of ordered) {
    if (out.length >= o.max) break;
    if (authors.has(e.pubkey)) continue;
    authors.add(e.pubkey);
    out.push(e);
  }
  return out;
}

/** A spotlight's posts, or null when the topic is too thin. */
export function spotlightPosts(
  events: RelayEvent[],
  o: { shown: Map<string, number> | Set<string>; exclude: Set<string> }
): RelayEvent[] | null {
  const posts = choosePosts(events, { ...o, max: SPECIALS.spotlight.posts });
  return posts.length >= SPECIALS.spotlight.minPosts ? posts : null;
}

// --- What: memories ---

export type MemoryVariant = 'day' | 'archive';

export function nextMemoryVariant(last: MemoryVariant | null): MemoryVariant {
  return last === 'day' ? 'archive' : 'day';
}

/** "One year ago today": the nearest year back with an eligible post (1–2 posts). */
export function dayMemory(
  sections: DaySection[],
  o: { shown: Map<string, number> | Set<string>; exclude: Set<string> }
): { yearsBack: number; posts: RelayEvent[] } | null {
  for (const s of [...sections].sort((a, b) => a.yearsBack - b.yearsBack)) {
    const posts = choosePosts(s.posts, { ...o, max: SPECIALS.memory.dayPosts.max });
    if (posts.length >= SPECIALS.memory.dayPosts.min) return { yearsBack: s.yearsBack, posts };
  }
  return null;
}

/** "From the archive": the month's standout: images first, then the most to read. */
export function archiveStandout(
  events: RelayEvent[],
  o: { shown: Map<string, number> | Set<string>; exclude: Set<string> }
): RelayEvent | null {
  const fresh = events.filter((e) => !o.shown.has(e.id) && !o.exclude.has(e.id));
  if (fresh.length === 0) return null;
  const score = (e: RelayEvent) => (hasImage(e) ? 1_000_000 : 0) + (e.content || '').length;
  return [...fresh].sort((a, b) => score(b) - score(a))[0];
}

export function memoryLabel(variant: MemoryVariant, yearsBack = 1): string {
  if (variant === 'archive') return 'From the archive';
  return yearsBack === 1 ? 'One year ago today' : `${yearsBack} years ago today`;
}

// --- The feed with its cards ---

export type Special =
  | { type: 'recipe'; post: RelayEvent }
  | ({ type: 'spotlight'; posts: RelayEvent[] } & TopicPick)
  | ({ type: 'teaser' } & TopicPick)
  | {
      type: 'memory';
      variant: MemoryVariant;
      label: string;
      /** The day ("October 7, 2025") or month ("March 2024") it comes from. */
      heading: string;
      posts: RelayEvent[];
    };

export function rotationType(s: Special): SpecialType {
  return s.type === 'teaser' ? 'spotlight' : s.type;
}

/** A decided slot: after the post `anchorId`, this card (or nothing). */
export interface PlacedSlot {
  anchorId: string;
  special: Special | null;
}

export type FeedRow<T> =
  | { key: string; box: false; item: T; divider?: false }
  | { key: string; box: true; special: Special; divider?: false };

/** Posts with each placed card after its anchor post (a missing anchor drops its card). */
export function placeSpecials<T extends { raw: { id: string } }>(
  posts: T[],
  slots: Map<string, PlacedSlot & { key: string }>
): FeedRow<T>[] {
  const out: FeedRow<T>[] = [];
  for (const p of posts) {
    out.push({ key: p.raw.id, box: false, item: p });
    const s = slots.get(p.raw.id);
    if (s?.special) out.push({ key: s.key, box: true, special: s.special });
  }
  return out;
}
