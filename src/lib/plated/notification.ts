/**
 * Plated notifications: "Maria plated your Sourdough Waffles."
 *
 * A plate is still an ordinary kind-1111 comment notification; this module
 * decides which ones are plates of the signed-in member's recipes (the same
 * Plated rule as the recipe page), keeps the little the row needs, and
 * looks up recipe titles in memory.
 *
 * Pure apart from the shared in-memory lookup store; the relay fetch is
 * injected, so everything here is unit-tested in notification.test.ts.
 */
import { writable, get } from 'svelte/store';
import { nip19 } from 'nostr-tools';
import { isTaggedRecipe } from '$lib/consts';
import { parseCoordinate } from '$lib/coordinate';
import { isEventMutedBy, type MuteList } from '$lib/muteFilter';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { eventRelayHints } from '$lib/utils/eventUrl';
import { isPlatedPost, platedAnchorId, platedImage, platedNote, type PlatedEventLike } from './plated';

/** Size limits for what a stored notification keeps (localStorage). */
export const PLATED_NOTE_MAX = 1000;
export const PLATED_HASHTAGS_MAX = 20;
export const PLATED_HASHTAG_MAX_LENGTH = 64;
export const PLATED_IMAGE_MAX_LENGTH = 2048;
/** Longest title kept in memory; the layout truncates what it shows. */
export const PLATED_TITLE_MAX = 200;
export const PLATED_LOOKUP_TIMEOUT_MS = 6000;

const HEX64 = /^[0-9a-f]{64}$/;

/** What a plated notification stores beside the usual comment fields. */
export interface PlatedNotificationData {
  /** `30023:<your pubkey>:<d>` */
  recipeAddress: string;
  image: string;
  /** The cook's note (content minus the photo URL), for muted-word checks. */
  note: string;
  /** The plate's `t` tags, for muted-tag checks. */
  hashtags: string[];
}

/** The slice of a stored notification these checks read. */
export interface PlatedNotificationLike {
  id: string;
  fromPubkey: string;
  plated?: PlatedNotificationData;
}

/**
 * The Plated data for a comment notification, or null when it stays a
 * normal comment: not a valid top-level plate (the shared Plated rule), not
 * on a kind-30023 recipe address of `userPubkey`, or posted by them.
 */
export function platedNotificationData(
  event: PlatedEventLike,
  userPubkey: string
): PlatedNotificationData | null {
  if (!HEX64.test(userPubkey) || event.pubkey === userPubkey) return null;
  const address = (event.tags ?? []).find((t) => Array.isArray(t) && t[0] === 'A')?.[1];
  const coord = parseCoordinate(address);
  if (!address || !coord || coord.kind !== 30023 || coord.pubkey !== userPubkey) return null;
  if (!isPlatedPost(event, { address, authorPubkey: userPubkey })) return null;

  const image = platedImage(event)!;
  if (image.length > PLATED_IMAGE_MAX_LENGTH) return null;
  const hashtags: string[] = [];
  for (const t of event.tags ?? []) {
    if (hashtags.length >= PLATED_HASHTAGS_MAX) break;
    if (!Array.isArray(t) || t[0] !== 't' || typeof t[1] !== 'string') continue;
    const tag = t[1].trim().slice(0, PLATED_HASHTAG_MAX_LENGTH);
    if (tag && !hashtags.includes(tag)) hashtags.push(tag);
  }
  return {
    recipeAddress: address,
    image,
    note: platedNote(event.content ?? '', image).slice(0, PLATED_NOTE_MAX),
    hashtags
  };
}

// ── Recipe lookup (titles + the recipe rule), in memory only ──────────

export type PlatedRecipeLookup =
  | { status: 'pending' }
  /** Couldn't be loaded: tags unchecked, so the plate stays (text only). */
  | { status: 'missing' }
  | { status: 'recipe'; title: string | null; relays: string[] }
  /** Loaded and not a recipe (an article): a normal comment notification. */
  | { status: 'not-recipe' };

/** Shared by the notifications page and the bell. Never persisted. */
export const platedRecipeLookups = writable<ReadonlyMap<string, PlatedRecipeLookup>>(new Map());

/** A loaded recipe-address event, with where it was seen. */
export interface LookedUpEvent {
  kind?: number;
  pubkey?: string;
  created_at?: number;
  tags?: string[][];
  relays?: string[];
}

/** One-shot fetch for kind-30023 events by author and d-tag. */
export type RecipeFetcher = (
  filters: { kinds: number[]; authors: string[]; '#d': string[] }[],
  timeoutMs: number
) => Promise<LookedUpEvent[]>;

/**
 * The real fetcher: one closeOnEose REQ, stopped at EOSE or the timeout,
 * whichever comes first. No live subscription is left open.
 */
export function ndkRecipeFetcher(ndk: NDK): RecipeFetcher {
  return (filters, timeoutMs) =>
    new Promise((resolve) => {
      const found: LookedUpEvent[] = [];
      let done = false;
      const sub = ndk.subscribe(filters as NDKFilter[], { closeOnEose: true, groupable: false });
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          sub.stop();
        } catch {}
        resolve(found);
      };
      const timer = setTimeout(finish, timeoutMs);
      sub.on('event', (ev: NDKEvent) => {
        found.push({
          kind: ev.kind,
          pubkey: ev.pubkey,
          created_at: ev.created_at,
          tags: ev.tags,
          relays: eventRelayHints(ev)
        });
      });
      sub.on('eose', finish);
    });
}

function cleanTitle(tags: string[][] | undefined): string | null {
  const raw = tags?.find((t) => Array.isArray(t) && t[0] === 'title')?.[1];
  if (typeof raw !== 'string') return null;
  const title = raw.replace(/\s+/g, ' ').trim().slice(0, PLATED_TITLE_MAX);
  return title || null;
}

/**
 * Look up the recipes behind these addresses in one request (one filter per
 * author), skipping any already looked up or in flight. Rows never wait on
 * this: they show "plated your recipe" until the store updates.
 */
export async function lookupPlatedRecipes(
  addresses: readonly string[],
  fetchRecipes: RecipeFetcher,
  timeoutMs = PLATED_LOOKUP_TIMEOUT_MS
): Promise<void> {
  const known = get(platedRecipeLookups);
  const wanted = new Map<string, { pubkey: string; d: string }>();
  for (const address of addresses) {
    if (known.has(address) || wanted.has(address)) continue;
    const c = parseCoordinate(address);
    if (!c || c.kind !== 30023 || !HEX64.test(c.pubkey)) continue;
    wanted.set(address, { pubkey: c.pubkey, d: c.identifier });
  }
  if (wanted.size === 0) return;

  setLookups([...wanted.keys()].map((a) => [a, { status: 'pending' }]));

  const byAuthor = new Map<string, Set<string>>();
  for (const { pubkey, d } of wanted.values()) {
    if (!byAuthor.has(pubkey)) byAuthor.set(pubkey, new Set());
    byAuthor.get(pubkey)!.add(d);
  }
  const filters = [...byAuthor].map(([pubkey, ds]) => ({
    kinds: [30023],
    authors: [pubkey],
    '#d': [...ds]
  }));

  let events: LookedUpEvent[] = [];
  try {
    events = await fetchRecipes(filters, timeoutMs);
  } catch {
    events = [];
  }

  // Newest revision per address wins.
  const newest = new Map<string, LookedUpEvent>();
  for (const ev of events) {
    if (ev.kind !== 30023 || !ev.pubkey) continue;
    const d = ev.tags?.find((t) => Array.isArray(t) && t[0] === 'd')?.[1];
    if (typeof d !== 'string') continue;
    const address = `30023:${ev.pubkey}:${d}`;
    if (!wanted.has(address)) continue;
    const prev = newest.get(address);
    if (!prev || (ev.created_at ?? 0) > (prev.created_at ?? 0)) newest.set(address, ev);
  }

  setLookups(
    [...wanted.keys()].map((address): [string, PlatedRecipeLookup] => {
      const ev = newest.get(address);
      if (!ev) return [address, { status: 'missing' }];
      if (!isTaggedRecipe(ev)) return [address, { status: 'not-recipe' }];
      return [address, { status: 'recipe', title: cleanTitle(ev.tags), relays: ev.relays ?? [] }];
    })
  );
}

function setLookups(entries: [string, PlatedRecipeLookup][]): void {
  platedRecipeLookups.update((m) => {
    const next = new Map(m);
    for (const [k, v] of entries) next.set(k, v);
    return next;
  });
}

/** For tests: forget every lookup. */
export function resetPlatedRecipeLookups(): void {
  platedRecipeLookups.set(new Map());
}

// ── Display decisions ──────────────────────────────────────────────────

/**
 * The plate to show for a notification, or null to show it as a normal
 * comment: no Plated data (older notifications too), or the lookup found
 * the address is not a recipe.
 */
export function effectivePlated(
  n: PlatedNotificationLike,
  lookups: ReadonlyMap<string, PlatedRecipeLookup>
): PlatedNotificationData | null {
  if (!n.plated) return null;
  return lookups.get(n.plated.recipeAddress)?.status === 'not-recipe' ? null : n.plated;
}

/** The recipe title for a shown plate, once the lookup has one. */
export function platedRecipeTitle(
  plate: PlatedNotificationData,
  lookups: ReadonlyMap<string, PlatedRecipeLookup>
): string | null {
  const l = lookups.get(plate.recipeAddress);
  return l?.status === 'recipe' ? l.title : null;
}

export type IsBlockedPointer = (pointer: { eventId: string; pubkey: string }) => boolean;

/**
 * Should this notification be hidden? Only plates are checked: the full
 * mute list (author, words in the note, tags, the event's own id) and the
 * site moderation lists by event id and author. Never keyword rules.
 * Ordinary comment notifications are untouched (always false).
 */
export function isPlatedNotificationHidden(
  n: PlatedNotificationLike,
  lookups: ReadonlyMap<string, PlatedRecipeLookup>,
  muteList: MuteList | null | undefined,
  isBlocked: IsBlockedPointer
): boolean {
  const plate = effectivePlated(n, lookups);
  if (!plate) return false;
  if (isBlocked({ eventId: n.id, pubkey: n.fromPubkey })) return true;
  return isEventMutedBy(muteList, {
    id: n.id,
    kind: 1111,
    pubkey: n.fromPubkey,
    content: plate.note,
    tags: plate.hashtags.map((h) => ['t', h])
  });
}

/**
 * Where tapping a plate goes: the recipe (with relay hints when the lookup
 * saw it somewhere) scrolled to the plate's card. Null for a bad address.
 */
export function platedNotificationHref(
  eventId: string,
  plate: PlatedNotificationData,
  lookups: ReadonlyMap<string, PlatedRecipeLookup>
): string | null {
  const c = parseCoordinate(plate.recipeAddress);
  if (!c || c.kind !== 30023 || !HEX64.test(eventId)) return null;
  const l = lookups.get(plate.recipeAddress);
  const relays = l?.status === 'recipe' ? l.relays.slice(0, 3) : [];
  try {
    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey: c.pubkey,
      identifier: c.identifier,
      ...(relays.length > 0 ? { relays } : {})
    });
    return `/recipe/${naddr}#${platedAnchorId(eventId)}`;
  } catch {
    return null;
  }
}
