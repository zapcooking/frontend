import { outboxRelaySet } from '$lib/outboxPublish';
import { writable, get, type Readable } from 'svelte/store';
import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk';

/**
 * Fresh's follow, bookmark and report actions. Every write goes through the
 * app's `$ndk` (the reader's own relays), never the feed relay. Each edit
 * fetches the latest copy of the list first, so a change made from another
 * client isn't overwritten, and keeps every other entry as it was.
 *
 * The tag editors are pure (and tested); the async wrappers fetch, edit,
 * publish.
 */

// --- Follow (kind 3) ---

/**
 * The contact list's `p` tags after following / unfollowing `hex`. Null
 * means "don't publish": nothing would change, or an unfollow would empty a
 * list that had more than one entry (the safeguard ProfileSheet uses
 * against wiping a list from a stale or partial read).
 */
export function nextContactTags(tags: string[][], hex: string, follow: boolean): string[][] | null {
  const ps = tags.filter((t) => t[0] === 'p');
  const has = ps.some((t) => t[1] === hex);
  if (follow === has) return null;
  if (follow) return [...ps, ['p', hex]];
  const next = ps.filter((t) => t[1] !== hex);
  if (next.length === 0 && ps.length > 1) return null;
  return next;
}

async function latest(ndk: NDK, me: string, kind: number): Promise<NDKEvent | null> {
  const filter: NDKFilter = { authors: [me], kinds: [kind], limit: 1 };
  const events = Array.from(await ndk.fetchEvents(filter));
  events.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return events[0] ?? null;
}

const followingStore = writable<Set<string> | null>(null);
/** The reader's follows (hex), once loaded; null until then. */
export const following: Readable<Set<string> | null> = { subscribe: followingStore.subscribe };
let followingOwner = '';

export async function loadFollowing(ndk: NDK, me: string): Promise<Set<string>> {
  const cur = get(followingStore);
  if (cur && followingOwner === me) return cur;
  const ev = await latest(ndk, me, 3);
  const set = new Set((ev?.tags ?? []).filter((t) => t[0] === 'p').map((t) => t[1]));
  followingOwner = me;
  followingStore.set(set);
  return set;
}

export async function setFollowing(ndk: NDK, me: string, hex: string, follow: boolean) {
  // Safe edit ($lib/followUpdate): throws FollowSafetyError, publishing
  // nothing, when the latest list can't be read reliably.
  const { updateFollows } = await import('$lib/followUpdate');
  const set = await updateFollows(ndk, me, follow ? { add: [hex] } : { remove: [hex] });
  followingOwner = me;
  followingStore.set(set);
}

// --- Bookmarks (NIP-51 kind 10003) ---

/** How a post is referenced in a bookmark list: `a` for long-form, `e` for notes. */
export function bookmarkRef(e: {
  id: string;
  kind: number;
  pubkey: string;
  tags: string[][];
}): string[] {
  if (e.kind === 30023) {
    const d = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
    return ['a', `${e.kind}:${e.pubkey}:${d}`];
  }
  return ['e', e.id];
}

function sameRef(t: string[], ref: string[]) {
  return t[0] === ref[0] && t[1] === ref[1];
}

/**
 * The bookmark list's tags after adding / removing `ref`; every other tag
 * (and order) is kept. Null when nothing would change.
 */
export function nextBookmarkTags(tags: string[][], ref: string[], add: boolean): string[][] | null {
  const has = tags.some((t) => sameRef(t, ref));
  if (add === has) return null;
  return add ? [...tags, ref] : tags.filter((t) => !sameRef(t, ref));
}

const bookmarksStore = writable<string[][] | null>(null);
/** The reader's public bookmark tags, once loaded. */
export const bookmarks: Readable<string[][] | null> = { subscribe: bookmarksStore.subscribe };
let bookmarksOwner = '';

export function isBookmarked(tags: string[][] | null, ref: string[]): boolean {
  return !!tags?.some((t) => sameRef(t, ref));
}

export async function loadBookmarks(ndk: NDK, me: string): Promise<string[][]> {
  const cur = get(bookmarksStore);
  if (cur && bookmarksOwner === me) return cur;
  const ev = await latest(ndk, me, 10003);
  bookmarksOwner = me;
  bookmarksStore.set(ev?.tags ?? []);
  return ev?.tags ?? [];
}

export async function setBookmarked(ndk: NDK, me: string, ref: string[], add: boolean) {
  const existing = await latest(ndk, me, 10003);
  const tags = nextBookmarkTags(existing?.tags ?? [], ref, add);
  if (tags) {
    const ev = new NDKEvent(ndk);
    ev.kind = 10003;
    // Private bookmarks live encrypted in content: keep them as they are.
    ev.content = existing?.content ?? '';
    ev.tags = tags;
    await ev.publish(await outboxRelaySet(ev, 'list'));
  }
  bookmarksOwner = me;
  bookmarksStore.set(tags ?? existing?.tags ?? []);
}

// --- Reports (NIP-56 kind 1984) ---

export const REPORT_TYPES = [
  { value: 'spam', label: 'Spam' },
  { value: 'nudity', label: 'Nudity or sexual content' },
  { value: 'profanity', label: 'Hateful or abusive' },
  { value: 'illegal', label: 'Illegal content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'malware', label: 'Malware or scam link' },
  { value: 'other', label: 'Something else' }
] as const;

export type ReportType = (typeof REPORT_TYPES)[number]['value'];

/**
 * "Also mute this person" starts unticked: muting publishes the reader's
 * mute list, so it should be a choice, not a side effect of reporting.
 */
export const REPORT_ALSO_MUTE_DEFAULT = false;

/** A NIP-56 report of one post: the note and its author, same type. */
export function reportTemplate(
  post: { id: string; pubkey: string },
  type: ReportType,
  note: string
): { kind: number; content: string; tags: string[][] } {
  return {
    kind: 1984,
    content: note.trim(),
    tags: [
      ['e', post.id, type],
      ['p', post.pubkey, type]
    ]
  };
}

export async function publishReport(
  ndk: NDK,
  post: { id: string; pubkey: string },
  type: ReportType,
  note: string
) {
  const t = reportTemplate(post, type, note);
  const ev = new NDKEvent(ndk);
  ev.kind = t.kind;
  ev.content = t.content;
  ev.tags = t.tags;
  await ev.publish();
}
