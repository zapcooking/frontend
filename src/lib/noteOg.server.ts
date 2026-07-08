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

// The note event is the card; the author profile is a best-effort enrichment.
// They're bounded SEPARATELY so a slow kind:0 relay can never consume the
// note's budget and drop the whole card.
const NOTE_TIMEOUT_MS = 4000;
const AUTHOR_TIMEOUT_MS = 1500;
const FALLBACK_IMAGE = 'https://zap.cooking/social-share.png';
// First raster image URL in the note body → used as the card image.
const IMG_RE = /(https?:\/\/[^\s"']+\.(?:jpe?g|png|gif|webp|avif|bmp)(?:\?[^\s"']*)?)/i;
// Trailing punctuation that markdown/plain text can leave on a captured URL
// (e.g. from `![](url)` or `(url).`) — strip it so og:image stays valid.
const TRAILING_PUNCT_RE = /[)\]}.,!?;'"]+$/;

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

  // Author kind:0 profile — best-effort, on its OWN short budget so it can't
  // starve the note. A timeout just yields a generic title/image.
  let author: NoteAuthor = {};
  if (event.pubkey) {
    const meta = await withTimeout(
      raceRelays({ kinds: [0], authors: [event.pubkey] }),
      AUTHOR_TIMEOUT_MS,
      null
    );
    const content = (meta as Record<string, unknown> | null)?.content;
    if (typeof content === 'string') {
      try {
        const p = JSON.parse(content) as Record<string, string>;
        author = {
          name: p.display_name || p.displayName || p.name,
          picture: p.picture
        };
      } catch {
        /* malformed profile JSON — keep empty author */
      }
    }
  }

  return { event, author };
}

function cleanNoteText(content: string): string {
  return content
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/nostr:[^\s]+/g, '')
    .replace(/#\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getNoteOgMeta({ event, author }: NoteOgData): RecipeOgMeta {
  const name = author.name?.trim();
  const text = cleanNoteText(event.content);
  const imageInBody = event.content.match(IMG_RE)?.[1]?.replace(TRAILING_PUNCT_RE, '');

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
 * are each independently time-bounded (see NOTE_TIMEOUT_MS / AUTHOR_TIMEOUT_MS)
 * so a slow author lookup can't drop the note card.
 */
export async function fetchNoteForOg(slug: string): Promise<NoteOgData | null> {
  try {
    return await resolveNote(slug);
  } catch {
    return null;
  }
}
