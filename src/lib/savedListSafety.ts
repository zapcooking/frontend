/**
 * Safe edits to the member's recipe lists (kind 30001): the "Saved" list
 * (`30001:<pubkey>:nostrcooking-bookmarks`) and every custom collection.
 * The rules were written for Saved (hence the names) and apply unchanged to
 * every list.
 *
 * A list is a replaceable event: every edit republishes the whole list, so
 * an edit built on a missing or partial read publishes a smaller list and
 * drops saved recipes. Before EVERY publish the list is read from the relays
 * it is written to, and `decideSavedListBase` (pure, tested) decides what the
 * edit may be built on:
 *
 * - **The read must reach a quorum** for any edit: at least
 *   MIN_EMPTY_ANSWERS list-capable relays answered (EOSE), AND at least
 *   half of the member's own list-capable write relays answered (no write
 *   relays → only the first condition). "List-capable" leaves out
 *   relays that refuse kind-30001 writes (NON_EVIDENCE_RELAYS): their
 *   answers prove nothing. A relay that never answered (timeout, error,
 *   dead) counts as nothing at all — silence is never absence. Otherwise:
 *   **unconfirmed**, nothing is published. (The quorum guards the "present"
 *   case too: the newest copy may sit on a write relay that didn't answer;
 *   half makes the silent ones at most half, and the overall floor still
 *   needs two list-capable answers. Requiring every write relay — or a
 *   strict majority, with two write relays — would let one dead relay in a
 *   member's list block every save.)
 * - **Present**: the base is the newest by created_at of the relays'
 *   answers, a signed copy held locally (store or IndexedDB), and the newest
 *   version seen or published this session.
 * - **Confirmed absent** (base = null, the first save creates the list): the
 *   read was complete and none of those sources has a list.
 * - **Fresh account**: a key generated in this browser session has no list
 *   on any relay — no network read; the base is whatever this session
 *   published (signup → save stays fast).
 *
 * `buildSavedListEdit` then makes ONE event per edit (a first save is the
 * whole list with the recipe in it — never an empty list followed by an add)
 * whose created_at is strictly newer than the base and than anything this
 * session published, so two edits can never tie on a timestamp (relays keep
 * the lower id on a tie, which silently dropped saves).
 */

import { NON_LIST_RELAYS } from './outboxRelays';

export const SAVED_LIST_READ_TIMEOUT_MS = 5000;
/**
 * How long each relay has to acknowledge (OK) a list edit. NDK's default is
 * 2.5 s, which a slow connection or a relay connected just for the edit can
 * miss even when it stored the event.
 */
export const LIST_PUBLISH_OK_TIMEOUT_MS = 8000;
export const MIN_EMPTY_ANSWERS = 2;

/**
 * Relays that refuse kind-30001 writes (NON_LIST_RELAYS: purplepag.es and
 * nostr.wine). nostr.wine is still read and written when the member's own
 * relay list names it (paying members can store lists there), and a list it
 * returns counts like any relay's — but an empty answer from it (or from
 * purplepag.es) says nothing about whether the list exists, so it never
 * counts toward absence or the quorum.
 */
export const NON_EVIDENCE_RELAYS = NON_LIST_RELAYS;

export interface ListEvent {
  id?: string;
  created_at: number;
  tags: string[][];
  content?: string;
}

export interface ListRelayAnswer {
  url: string;
  /** Answered (EOSE), with or without a list. */
  ok: boolean;
  list: ListEvent | null;
}

export type SavedListDecision =
  { ok: true; base: ListEvent | null } | { ok: false; reason: 'unconfirmed' };

const key = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '');
const NON_EVIDENCE = new Set(NON_EVIDENCE_RELAYS.map(key));

export function newestList(...lists: Array<ListEvent | null | undefined>): ListEvent | null {
  let best: ListEvent | null = null;
  for (const l of lists) {
    if (l && (!best || l.created_at > best.created_at)) best = l;
  }
  return best;
}

export function decideSavedListBase(o: {
  answers: ListRelayAnswer[];
  /** The member's own write relays (kind 10002). */
  ownWrite: string[];
  /** A copy in the store or IndexedDB. */
  local: ListEvent | null;
  /** The newest list seen or published this session. */
  seen: ListEvent | null;
  /** The key was generated in this browser session. */
  fresh: boolean;
}): SavedListDecision {
  if (o.fresh) return { ok: true, base: newestList(o.local, o.seen) };

  const answered = new Set(o.answers.filter((a) => a.ok).map((a) => key(a.url)));
  const evidence = [...answered].filter((u) => !NON_EVIDENCE.has(u));
  const ownCapable = [...new Set(o.ownWrite.map(key))].filter((u) => !NON_EVIDENCE.has(u));
  const ownAnswered = ownCapable.filter((u) => answered.has(u)).length;
  const ownHalf = ownCapable.length === 0 || ownAnswered * 2 >= ownCapable.length;
  if (evidence.length < MIN_EMPTY_ANSWERS || !ownHalf) {
    return { ok: false, reason: 'unconfirmed' };
  }

  const found = newestList(...o.answers.map((a) => a.list));
  return { ok: true, base: newestList(found, o.local, o.seen) };
}

/**
 * Whether a per-relay read proves the list does not exist, for DISPLAY only
 * (an empty "Saved" instead of "couldn't load"). Edits still need the quorum
 * in decideSavedListBase. Proven when no relay returned a list and at least
 * MIN_EMPTY_ANSWERS list-capable relays answered (EOSE) empty. Silent relays
 * and NON_EVIDENCE_RELAYS never count. An aggregate "subscription finished"
 * is not an answer: NDK ends a subscription once half its relays have
 * answered, and a fast empty answer is not proof.
 */
export function listAbsenceProven(answers: ListRelayAnswer[]): boolean {
  if (answers.some((a) => a.list)) return false;
  const emptyEvidence = new Set(
    answers
      .filter((a) => a.ok)
      .map((a) => key(a.url))
      .filter((u) => !NON_EVIDENCE.has(u))
  );
  return emptyEvidence.size >= MIN_EMPTY_ANSWERS;
}

export interface SavedListChange {
  add?: string[];
  remove?: string[];
  /** Set the cover recipe (must be in the list after the change). */
  cover?: string;
  /**
   * Reorder (My Kitchen's Manage Recipes). Recipes the caller didn't know
   * about — saved elsewhere since it loaded — keep their place after the
   * ordered ones: an order is never a reason to drop a recipe.
   */
  order?: string[];
  /**
   * List details; an empty string removes the summary / image. A title is
   * never removed (an empty one is ignored), and the Saved list's callers
   * never pass one: its title stays "Saved".
   */
  meta?: { title?: string; summary?: string; image?: string };
}

/**
 * The next version of the list: every tag of the base except its recipes
 * kept verbatim (title, cover, summary, image, `t`, other clients' tags),
 * recipes edited in place, created_at strictly after `floor`. With no base
 * (the list's first event), `initialTags` follow the d and title tags.
 */
export function buildSavedListEdit(
  base: ListEvent | null,
  change: SavedListChange,
  opts: { dTag: string; title: string; now: number; floor: number; initialTags?: string[][] }
): { tags: string[][]; content: string; created_at: number; changed: boolean; added: number } {
  const baseTags = base?.tags ?? [];
  let others = baseTags.filter((t) => t[0] !== 'a' && t[0] !== 'cover' && t[0] !== 'client');
  if (!others.some((t) => t[0] === 'd')) others.unshift(['d', opts.dTag]);
  if (!others.some((t) => t[0] === 'title')) others.push(['title', opts.title]);
  if (!base) others.push(...(opts.initialTags ?? []).map((t) => [...t]));
  let metaChanged = false;
  for (const [name, value] of Object.entries(change.meta ?? {})) {
    if (value === undefined) continue;
    if (name === 'title' && !value) continue;
    const current = others.find((t) => t[0] === name)?.[1] ?? '';
    if (current === value) continue;
    metaChanged = true;
    others = others.filter((t) => t[0] !== name);
    if (value) others.push([name, value]);
  }

  const before: string[] = [];
  for (const t of baseTags) {
    if (t[0] === 'a' && t[1] && !before.includes(t[1])) before.push(t[1]);
  }
  const remove = new Set(change.remove ?? []);
  let recipes = before.filter((a) => !remove.has(a));
  let added = 0;
  for (const a of change.add ?? []) {
    if (a && !recipes.includes(a)) {
      recipes.push(a);
      added++;
    }
  }
  if (change.order) {
    const rank = new Map(change.order.map((a, i) => [a, i]));
    const ordered = recipes.filter((a) => rank.has(a)).sort((x, y) => rank.get(x)! - rank.get(y)!);
    recipes = [...ordered, ...recipes.filter((a) => !rank.has(a))];
  }

  const oldCover = baseTags.find((t) => t[0] === 'cover')?.[1];
  let cover = oldCover;
  if (change.cover && recipes.includes(change.cover)) cover = change.cover;
  // The cover follows its recipe out of the list; a first recipe seeds it
  // (the same rules My Kitchen has always used).
  if (cover && !recipes.includes(cover)) cover = recipes[0];
  if (!cover && before.length === 0 && recipes.length > 0) cover = recipes[0];

  const tags = [...others.map((t) => [...t])];
  if (cover) tags.push(['cover', cover]);
  for (const a of recipes) tags.push(['a', a]);

  const changed =
    recipes.length !== before.length ||
    recipes.some((a, i) => a !== before[i]) ||
    cover !== oldCover ||
    metaChanged;

  return {
    tags,
    content: base?.content ?? '',
    created_at: Math.max(opts.now, opts.floor + 1, (base?.created_at ?? 0) + 1),
    changed,
    added
  };
}
