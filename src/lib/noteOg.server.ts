/**
 * Server-only resolver for NOTE (kind:1) Open Graph metadata used by the
 * crawler branch of the `handle` hook.
 *
 * Notes are the most-shared link type but had no server-side OG: the layout
 * suppresses its generic tags for `/note1…` / `/nevent1…` routes (they're in
 * `hasCustomOgTags`), yet the note's real tags are fetched client-side, so a
 * JS-less crawler saw an empty card. This resolves the note event AND its
 * author profile SERVER-SIDE (raw WebSocket relay race — no NDK, keeping the
 * worker bundle small, same constraint as the recipe path) and builds a card.
 *
 * Mirrors recipeOg.server.ts: never throws, never hangs past the timeout.
 */

import { nip19 } from 'nostr-tools';
import { raceRelays } from './recipePackOg.server';
import {
  capRecipeDescription,
  type OgEventLike,
  type RecipeOgMeta
} from './recipeOgMeta';
import { extractImageUrls } from './imageUrls';
import { fetchProfilesForOg } from './profileBatchOg.server';

// The note event is the card; the author/mention profiles are a best-effort
// enrichment. They're bounded SEPARATELY so a slow kind:0 relay can never
// consume the note's budget and drop the whole card.
const NOTE_TIMEOUT_MS = 4000;
// One shared, short budget for the author + mentioned profiles.
const PROFILE_TIMEOUT_MS = 2000;
// Cap how many mentions we resolve (they ride the same batched request).
const MAX_MENTION_LOOKUPS = 3;
// Only mentions near the start of the note can survive the ~155-char
// description cap, so don't resolve ones that never reach the card.
const MENTION_SCAN_CHARS = 400;
const FALLBACK_IMAGE = 'https://zap.cooking/social-share.png';

/**
 * First image URL for the card, preferring NIP-92 `imeta` tags (the
 * structured, authoritative source some clients — Amethyst and others —
 * attach) over scanning the note body. Falls back to `$lib/imageUrls`'s
 * shared extractor, which recognizes both file-extension URLs AND known
 * extensionless image-CDN hosts (nostr.build, imgur, primal's proxy, …) —
 * a plain extension regex misses that second class entirely. See
 * docs/plans/og-missing-images-fix.md.
 */
function findCardImage(event: OgEventLike): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'imeta') continue;
    for (let i = 1; i < tag.length; i++) {
      const slot = tag[i];
      if (typeof slot === 'string' && slot.startsWith('url ')) {
        const url = slot.slice(4).trim();
        if (url) return url;
      }
    }
  }
  return extractImageUrls(event.content)[0];
}

/** Resolve `p`, but never take longer than `ms`; on timeout or error → `fallback`. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
}

interface NoteAuthor {
  name?: string;
  picture?: string;
}

export interface NoteOgData {
  event: OgEventLike;
  author: NoteAuthor;
  /** hex pubkey → display name, for `nostr:npub1…` mentions that resolved. */
  mentions?: Record<string, string>;
}

/** Emitted when the note can't be resolved — a generic but valid note card. */
export const FALLBACK_NOTE_OG: RecipeOgMeta = {
  pageTitle: 'Note - zap.cooking',
  ogTitle: 'A note on Zap Cooking',
  description: 'A note shared on zap.cooking - Food is Open Source',
  image: FALLBACK_IMAGE,
  publishedAt: null,
  authorPubkey: null
};

/** note1… / nevent1… / raw-hex → event id, or null. */
function decodeNoteId(slug: string): string | null {
  if (/^[0-9a-f]{64}$/i.test(slug)) return slug;
  try {
    const decoded = nip19.decode(slug);
    if (decoded.type === 'note') return decoded.data as string;
    if (decoded.type === 'nevent') return (decoded.data as nip19.EventPointer).id;
  } catch {
    /* fall through */
  }
  return null;
}

function toOgEvent(evt: unknown): OgEventLike | null {
  if (!evt || typeof evt !== 'object') return null;
  const e = evt as Record<string, unknown>;
  if (!Array.isArray(e.tags)) return null;
  return {
    tags: e.tags as string[][],
    content: typeof e.content === 'string' ? e.content : '',
    pubkey: typeof e.pubkey === 'string' ? e.pubkey : undefined,
    created_at: typeof e.created_at === 'number' ? e.created_at : undefined,
    kind: typeof e.kind === 'number' ? e.kind : undefined
  };
}

async function resolveNote(slug: string): Promise<NoteOgData | null> {
  const id = decodeNoteId(slug);
  if (!id) return null;

  // Bound the note fetch on its own budget.
  const event = toOgEvent(await withTimeout(raceRelays({ ids: [id] }), NOTE_TIMEOUT_MS, null));
  if (!event) return null;

  // Author + mentioned profiles in ONE batched lookup (a socket per relay, not
  // per pubkey) on its own short budget, so it can't starve the note.
  const mentionKeys = extractMentionedPubkeys(event.content);
  const profiles = await fetchProfilesForOg(
    [...(event.pubkey ? [event.pubkey] : []), ...mentionKeys],
    PROFILE_TIMEOUT_MS
  );

  const mentions: Record<string, string> = {};
  for (const pk of mentionKeys) {
    const name = profiles[pk]?.name;
    if (name) mentions[pk] = name;
  }
  const authorProfile = event.pubkey ? profiles[event.pubkey] : undefined;
  const author: NoteAuthor = authorProfile
    ? { name: authorProfile.name, picture: authorProfile.picture }
    : {};

  return { event, author, mentions };
}

const MENTION_RE = /nostr:((?:npub1|nprofile1)[0-9a-z]+)/gi;

/** nostr:npub1… / nostr:nprofile1… → hex pubkey, or null if undecodable. */
function mentionToPubkey(bech32: string): string | null {
  try {
    const decoded = nip19.decode(bech32.toLowerCase());
    if (decoded.type === 'npub') return decoded.data as string;
    if (decoded.type === 'nprofile') return (decoded.data as nip19.ProfilePointer).pubkey;
  } catch {
    /* fall through */
  }
  return null;
}

/** Unique pubkeys mentioned near the start of the note, capped. */
export function extractMentionedPubkeys(content: string): string[] {
  const keys: string[] = [];
  for (const m of content.slice(0, MENTION_SCAN_CHARS).matchAll(MENTION_RE)) {
    const pk = mentionToPubkey(m[1]);
    if (pk && !keys.includes(pk)) keys.push(pk);
    if (keys.length >= MAX_MENTION_LOOKUPS) break;
  }
  return keys;
}

/** `@Name` when the profile resolved, else a short npub so the sentence still reads. */
function mentionLabel(bech32: string, mentions: Record<string, string>): string {
  const pk = mentionToPubkey(bech32);
  if (!pk) return '';
  const name = mentions[pk]?.replace(/\s+/g, ' ').trim();
  if (name) return `@${name}`;
  const npub = nip19.npubEncode(pk);
  return `@${npub.slice(0, 9)}…${npub.slice(-4)}`;
}

export function cleanNoteText(content: string, mentions: Record<string, string> = {}): string {
  return content
    .replace(/https?:\/\/[^\s]+/g, '')
    // People mentions read as part of the sentence ("Thanks to @Name for…"),
    // so keep them. Quoted events/notes/addresses don't, so those still go.
    .replace(MENTION_RE, (_m, bech32: string) => mentionLabel(bech32, mentions))
    .replace(/nostr:[^\s]+/g, '')
    .replace(/#\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getNoteOgMeta({ event, author, mentions }: NoteOgData): RecipeOgMeta {
  const name = author.name?.trim();
  const text = cleanNoteText(event.content, mentions);
  const imageInBody = findCardImage(event);

  return {
    pageTitle: name ? `${name} on zap.cooking` : 'Note - zap.cooking',
    ogTitle: name ? `${name} on Zap Cooking` : 'A note on Zap Cooking',
    description:
      capRecipeDescription(text) || 'A note shared on zap.cooking - Food is Open Source',
    image: imageInBody || author.picture || FALLBACK_IMAGE,
    publishedAt: typeof event.created_at === 'number' ? event.created_at : null,
    authorPubkey: typeof event.pubkey === 'string' ? event.pubkey : null
  };
}

/**
 * Resolve a note for OG rendering. Never throws; the note and author fetches
 * are each independently time-bounded (see NOTE_TIMEOUT_MS / PROFILE_TIMEOUT_MS)
 * so a slow author lookup can't drop the note card.
 */
export async function fetchNoteForOg(slug: string): Promise<NoteOgData | null> {
  try {
    return await resolveNote(slug);
  } catch {
    return null;
  }
}
