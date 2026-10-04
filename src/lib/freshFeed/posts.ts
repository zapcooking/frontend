import { RECIPE_TAGS } from '$lib/consts';
import { isEventMutedBy, type MuteList } from '$lib/muteFilter';
import { FREE_WINDOW_SECONDS, type RelayEvent } from './relay';

/**
 * What the Fresh feed shows, and how. Pure functions so they can be tested
 * without a component; the helpers marked "from FoodstrFeedOptimized" are
 * copies (that file can't change during the beta), kept byte-for-byte in
 * behavior.
 */

export type PostKind = 'note' | 'poll' | 'recipe' | 'article';

/** Kind 35000, or a long-form post tagged as a Zap Cooking recipe. */
export function isRecipe(e: Pick<RelayEvent, 'kind' | 'tags'>): boolean {
  if (e.kind === 35000) return true;
  if (e.kind !== 30023) return false;
  return e.tags.some((t) => t[0] === 't' && RECIPE_TAGS.includes((t[1] || '').toLowerCase()));
}

export function postKind(e: Pick<RelayEvent, 'kind' | 'tags'>): PostKind {
  if (e.kind === 1068) return 'poll';
  if (isRecipe(e)) return 'recipe';
  if (e.kind === 30023) return 'article';
  return 'note';
}

/** `published_at`, when the post has a sane one. */
export function publishedAt(e: Pick<RelayEvent, 'tags'>): number | null {
  const v = e.tags.find((t) => t[0] === 'published_at')?.[1];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A long-form post first published before the free window and edited since:
 * an edit, not a new post. Kept out of the newest-first feed (the recipe box
 * shows old recipes); `now` in seconds.
 */
export function isOldEdit(e: Pick<RelayEvent, 'kind' | 'tags'>, now: number): boolean {
  if (e.kind !== 30023 && e.kind !== 35000) return false;
  const p = publishedAt(e);
  return p !== null && p < now - FREE_WINDOW_SECONDS;
}

export interface FilterContext {
  /** The reader's mute list (null when signed out or not loaded). */
  muteList: MuteList | null | undefined;
  /** The member's hellthread rule ($lib/notificationUtils). */
  isHellthread: (e: RelayEvent) => boolean;
  now: number;
}

/**
 * The one question before showing a Fresh post. Mutes and the hellthread
 * threshold always apply, as in OnlyFood; OnlyFood's food test, hashtag cap
 * and ytmeta4 stopgap don't (the relay is curated). Kind 5 deletions never
 * reach here (Fresh doesn't ask for them).
 */
export function passesFreshFilters(e: RelayEvent, ctx: FilterContext): boolean {
  if (
    isEventMutedBy(ctx.muteList, { id: e.id, pubkey: e.pubkey, content: e.content, tags: e.tags })
  )
    return false;
  if (ctx.isHellthread(e)) return false;
  if (isOldEdit(e, ctx.now)) return false;
  return true;
}

// --- From FoodstrFeedOptimized (formatTimeAgo, media helpers) ---

/** Compact "10m", "3h", "2d", "1y"; `now` in seconds. */
export function formatTimeAgo(timestamp: number, now = Math.floor(Date.now() / 1000)): string {
  const seconds = now - timestamp;
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days}d`;
  return `${Math.floor(days / 365)}y`;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v'];

export function isImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.includes(ext));
}

export function isVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    VIDEO_EXTENSIONS.some((ext) => lower.includes(ext)) ||
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    lower.includes('vimeo.com')
  );
}

/** Image and video URLs in a note, in order. */
export function mediaUrls(content: string): string[] {
  const urls = (content || '').match(URL_REGEX) || [];
  return urls.filter((url) => isImageUrl(url) || isVideoUrl(url));
}

function deduplicateText(text: string): string {
  if (!text || text.length < 40) return text;
  const trimmed = text.trim();
  const halfLen = Math.floor(trimmed.length / 2);
  if (halfLen > 20) {
    const firstHalf = trimmed.substring(0, halfLen).trim();
    const secondHalf = trimmed.substring(halfLen).trim();
    if (firstHalf === secondHalf) return firstHalf;
  }
  return text;
}

/** The note's text with media URLs removed (they render in the carousel). */
export function contentWithoutMedia(content: string): string {
  const cleaned = (content || '')
    .replace(URL_REGEX, (url) => (isImageUrl(url) || isVideoUrl(url) ? '' : url))
    .trim();
  return deduplicateText(cleaned);
}
