/**
 * Shared types for the feed overhaul (Phase 0 — Foundations).
 *
 * These are framework-free view-model types — derived from raw NDK events
 * by `normalize.ts` in Phase 2 and consumed by the new `FeedNote.*`
 * component tree in Phase 4. They are NOT persisted anywhere; they are
 * always recomputed from the underlying NDKEvent on read, so changing
 * shapes here never invalidates the IndexedDB caches.
 */

/** Image / video item parsed from a note. Dimensions, blurhash, and alt
 * come from NIP-92 `imeta` tags when present; otherwise only `url` and a
 * best-guess `mime` are populated. */
export interface MediaItem {
  url: string;
  /** Best-effort MIME type — derived from imeta `m`, from the URL
   * extension as a fallback, or `'image/*'` / `'video/*'` when only the
   * coarse kind is known. */
  mime: string;
  /** Pixel dimensions from imeta `dim` (e.g. `"1920x1080"`). Used by
   * MediaTile to reserve aspect-ratio and kill CLS. */
  dim?: { w: number; h: number };
  /** Blurhash placeholder per NIP-92 `blurhash`. Decoded to a data URL
   * lazily by `blurhash.ts`. */
  blurhash?: string;
  /** Alt text per NIP-92 `alt`. */
  alt?: string;
  /** Additional URLs (per NIP-92 `fallback`) tried if the primary URL
   * errors. */
  fallback?: string[];
  /** Optional `x` (sha256) from imeta — for content addressing /
   * deduplication. Not used today but cheap to carry. */
  hash?: string;
}

/** A repost wrapper (kind 6 / kind 16). The repost's body is the inner
 * event; the outer `vm` is rendered as a "X reposted" shell by
 * `FeedNoteRepost.svelte` (Phase 4). */
export interface RepostVM {
  /** Pubkey of the user who reposted. */
  reposterPubkey: string;
  /** Timestamp of the repost action. */
  repostedAt: number;
  /** Inner event's id, so the FeedNoteRepost can resolve it from
   * `eventStore` / NDK cache. */
  innerEventId: string;
  /** Inner event's pubkey when available from the kind-6 `p` tag. */
  innerPubkey?: string;
  /** The inner event's view-model once resolved. Null while loading. */
  inner: FeedNoteVM | null;
}

/** A quoted / embedded event (`nostr:nevent1…` inside the body or a `q`
 * tag). Rendered inline by `FeedNoteBody`. */
export interface EmbedVM {
  /** Bech32 reference (nevent / note / naddr) as it appears in source. */
  ref: string;
  /** Resolved event id, when decoded. */
  eventId?: string;
  /** Resolved view-model once fetched. Null while loading. */
  inner: FeedNoteVM | null;
}

/** Feed view model — what `FeedNote.svelte` consumes. Built once per
 * event by `normalize.ts` (Phase 2) and memoized by event id so passing
 * the same event through multiple sources reuses the same instance. */
export interface FeedNoteVM {
  /** Stable identity — the underlying event id, hex. */
  id: string;
  /** Author pubkey, hex. */
  pubkey: string;
  /** Event kind. 1 / 6 / 16 are the common feed kinds; 30023 / 30024
   * (long-form / draft) fall back to the legacy path in Phase 6. */
  kind: number;
  /** created_at, seconds. */
  createdAt: number;
  /** Raw note content. Rendered by `FeedNoteBody` after parsing. */
  content: string;
  /** Parallel arrays of tags as they appear on the event — kept so
   * downstream code can read e.g. `client`, `subject`, `t` hashtags
   * without going back to NDK. */
  tags: string[][];
  /** Parsed media (images + videos), in source order. Empty if the note
   * has none. */
  media: MediaItem[];
  /** Quoted events found in the body or via `q` tags. */
  embeds: EmbedVM[];
  /** Populated when `kind === 6 || kind === 16` (NIP-18 repost). */
  repost?: RepostVM;
  /** Pubkeys mentioned via `p` tags or `nostr:nprofile1…` — used to
   * pre-warm `profileCache` for the visible window. */
  mentionedPubkeys: string[];
  /** Hashtags from `t` tags, lower-cased. */
  hashtags: string[];
  /** Client attribution from the `client` tag, if present. */
  client?: string;
  /** Set when the note is a reply (has a non-mention `e` tag). */
  replyTo?: { rootId?: string; parentId?: string };
}

/** The feed tab the user is viewing. URL-bookmarkable via the
 * `?tab=` searchParam on `/community`. */
export type FeedTab = 'global' | 'following' | 'replies' | 'members' | 'garden';

/** Pagination cursor passed to `FeedSource.loadMore()`. Matches the
 * `since` / `until` convention used by the existing monolith so cursor
 * semantics port verbatim in Phase 2. */
export interface FeedCursor {
  until?: number;
  since?: number;
}

/** Reactive state surface a `FeedSource` exposes. Consumed by
 * `FeedContainer` / `VirtualFeedList` (Phase 5). */
export interface FeedSourceState {
  /** Events in display order (newest first). */
  events: FeedNoteVM[];
  /** True while the initial fetch is in flight. */
  loading: boolean;
  /** True while a `loadMore` is in flight. */
  loadingMore: boolean;
  /** False when the source has reached its tail (or determined there's
   * nothing further to fetch in this session). */
  hasMore: boolean;
  /** Non-null when the last fetch errored. */
  error: string | null;
}
