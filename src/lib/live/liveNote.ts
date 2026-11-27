/**
 * The "Live now" note a Go live host posts when the broadcast starts.
 *
 * A plain kind 1 note from the host's own account, so the stream shows on
 * their profile and in their followers' feeds in any Nostr app. It names
 * the stream with the shared rule ("<host> is cooking <recipe>" or "Live
 * from Zap Cooking"), links the watch page, and carries the recipe photo.
 * After the stream ends the same link shows "This live stream has ended".
 *
 * The stream's zaps target this note. Its chat does not depend on it (the
 * chat is kind 1311 on the session's address), but replies to the note
 * from other apps are shown in the chat too.
 */

export interface LiveNoteInput {
  /** The stream's name, from $lib/live/streamName. */
  name: string;
  /** Absolute watch page URL, `<origin>/live/s/<id>`. */
  watchUrl: string;
  /** The recipe's photo (https), when there is one. */
  image?: string | null;
  /** The attached recipe's address, `<kind>:<pubkey>:<d>`. */
  recipeA?: string | null;
}

export interface LiveNoteTemplate {
  kind: 1;
  created_at: number;
  content: string;
  tags: string[][];
}

const HTTPS_IMAGE = /^https:\/\/\S+$/;
const RECIPE_A = /^(30023|35000):[0-9a-f]{64}:.{1,200}$/;

export function liveNoteTemplate(input: LiveNoteInput, now = Date.now()): LiveNoteTemplate {
  const name = input.name.replace(/\s+/g, ' ').trim();
  const image = input.image && HTTPS_IMAGE.test(input.image) ? input.image : null;
  const lines = [name, '', `Watch live: ${input.watchUrl}`];
  if (image) lines.push('', image);
  const tags: string[][] = [
    ['r', input.watchUrl],
    ['t', 'zapcooking'],
    ['t', 'live']
  ];
  if (input.recipeA && RECIPE_A.test(input.recipeA)) tags.push(['a', input.recipeA]);
  if (image) tags.push(['imeta', `url ${image}`]);
  return { kind: 1, created_at: Math.floor(now / 1000), content: lines.join('\n'), tags };
}

export interface LiveAnnouncementInput {
  /** The Go live session id — the announcement's replaceable `d` tag. */
  sessionId: string;
  /** The stream's name, from $lib/live/streamName. */
  name: string;
  /** The host's pubkey, tagged so replies reach them (not a service account). */
  hostPubkey: string;
  /** Absolute WHEP playback endpoint, `<origin>/api/live/<id>/join`. */
  joinUrl: string;
  /**
   * Absolute watch page URL, `<origin>/live/s/<id>`: zap.cooking in
   * production, the preview's own origin on a preview.
   */
  watchUrl: string;
  /**
   * The event id of the host's "Watch live on Zap Cooking" chat message
   * (see `liveWatchMessageText`), carried as the `pinned` tag.
   */
  pinnedId?: string | null;
  /** Session start in seconds. */
  startedAt: number;
  /** 'live' while broadcasting; 'ended' replaces the announcement at the end. */
  status: 'live' | 'ended';
  /** The recipe's photo (https), when there is one. */
  image?: string | null;
  /** The attached recipe's address, `<kind>:<pubkey>:<d>`. */
  recipeA?: string | null;
  /**
   * Where the stream's chat and zaps are read and written (wss URLs): the
   * announcement's `relays` tag, so other live apps use the same relays.
   */
  relays?: readonly string[];
}

export interface LiveAnnouncementTemplate {
  kind: 30311;
  created_at: number;
  content: string;
  tags: string[][];
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/;
const EVENT_ID = /^[0-9a-f]{64}$/;
const WSS_RELAY = /^wss:\/\/[^\s/]+\S*$/;

/**
 * The NIP-53 user-status announcement for a Go live session (kind 30311).
 *
 * This is what puts a Go live session in the main live category: every
 * Nostr client scanning kind 30311 (Sidecar's video feature, zap.stream,
 * snort…) finds it, and the `streaming` tag carries the session's WHEP
 * join endpoint so WHEP-capable players can play it directly. The in-app
 * directory reads the same event via fetchStreamByNaddr.
 *
 * Most other live apps cannot play WHEP yet (given the link, their player
 * buffers). So the announcement also points people at the watch page:
 * `summary` and `alt` say so in words, `r` carries the link, and `pinned`
 * names the host's chat message with the same link (kind 1311,
 * `liveWatchMessageText`). The `streaming` tag stays for now: taking it
 * away may drop the stream from those apps' live lists.
 *
 * The host is tagged with the 'host' marker (NIP-53's current-host rule),
 * so clients address replies, zaps and moderation at the host — not at
 * the announcement's author.
 */
export function liveAnnouncementTemplate(
  input: LiveAnnouncementInput,
  now = Date.now()
): LiveAnnouncementTemplate {
  const name = input.name.replace(/\s+/g, ' ').trim();
  const image = input.image && HTTPS_IMAGE.test(input.image) ? input.image : null;
  const host = HEX_PUBKEY.test(input.hostPubkey) ? input.hostPubkey : '';
  const tags: string[][] = [
    ['d', input.sessionId],
    ['title', name],
    ['streaming', input.joinUrl],
    ['status', input.status],
    ['summary', `Live on Zap Cooking. Watch here: ${input.watchUrl}`],
    ['r', input.watchUrl],
    ['alt', `Live cook-along on Zap Cooking. Watch: ${input.watchUrl}`],
    ['t', 'zapcooking'],
    ['t', 'live']
  ];
  if (host) tags.splice(4, 0, ['p', host, '', 'host']);
  if (input.pinnedId && EVENT_ID.test(input.pinnedId)) tags.push(['pinned', input.pinnedId]);
  if (input.startedAt > 0) tags.push(['starts', String(input.startedAt)]);
  if (input.status === 'ended') tags.push(['ends', String(Math.floor(now / 1000))]);
  if (input.recipeA && RECIPE_A.test(input.recipeA)) tags.push(['a', input.recipeA]);
  if (image) {
    tags.push(['imeta', `url ${image}`]);
    tags.push(['image', image]);
  }
  const relays = [...new Set((input.relays ?? []).filter((url) => WSS_RELAY.test(url)))];
  if (relays.length) tags.push(['relays', ...relays]);
  const content = [name, '', `Watch live: ${input.watchUrl}`].join('\n');
  return { kind: 30311, created_at: Math.floor(now / 1000), content, tags };
}

const WATCH_MESSAGE_PREFIX = 'Watch live on Zap Cooking: ';
const WATCH_MESSAGE = /^Watch live on Zap Cooking: https?:\/\/\S+\/live\/s\/[0-9a-f]{32}$/;

/**
 * The chat message the host page posts once when an announced stream
 * starts (kind 1311 on the session's address), which the announcement
 * pins: other live apps show it at the top of the stream's chat, so
 * their viewers get a link to where the video plays.
 */
export function liveWatchMessageText(watchUrl: string): string {
  return `${WATCH_MESSAGE_PREFIX}${watchUrl}`;
}

/**
 * Is this the host's own "Watch live on Zap Cooking" chat message? Zap
 * Cooking's chat leaves it out: its readers are already on the watch
 * page. Only the host's message counts, so nobody else can hide a
 * comment by wording it this way.
 */
export function isLiveWatchMessage(
  event: { kind: number; pubkey: string; content: string },
  hostPubkey: string | null | undefined
): boolean {
  return (
    event.kind === 1311 &&
    !!hostPubkey &&
    event.pubkey === hostPubkey.toLowerCase() &&
    WATCH_MESSAGE.test(event.content)
  );
}
