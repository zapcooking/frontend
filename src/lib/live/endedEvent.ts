/**
 * Go live — the pre-signed "ended" announcement: the rules the host page
 * and the server share.
 *
 * Only the host can sign the kind 30311 that says a stream has ended,
 * and the host page is often gone when it does (tab closed, connection
 * lost, the time limit). So each time the page signs a live announcement
 * it also signs its ended twin and leaves it with the server, which
 * publishes it when the session ends by any path
 * (endedEvent.server.ts). The server never builds or signs an event.
 */

export const LIVE_ANNOUNCEMENT_KIND = 30311;
/** Largest held event, as JSON. A Go live announcement is about 1 KB. */
export const ENDED_EVENT_MAX_BYTES = 8 * 1024;
/** How many of the host's own relays the server will also publish to. */
export const ENDED_HOST_RELAYS_MAX = 8;
/** How far ahead of the server's clock a held event's created_at may be (seconds). */
export const ENDED_EVENT_FUTURE_SKEW_S = 60;

// A type, not an interface, so it fits the raw publisher's open event shape.
export type SignedEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export interface EventTemplateLike {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
}

/**
 * The ended twin of a live announcement, unsigned: the same tags with
 * status "ended" and an `ends` tag, one second after the live one so it
 * replaces it on every relay. A later live refresh is newer again and
 * replaces this in turn, so a twin can only ever end the stream as of
 * the live event it was signed with.
 *
 * `ends` is that same second: the best the page can say ahead of time.
 * When the server publishes the twin, the end shown in other apps is the
 * time of the last refresh, up to 30 minutes before the real end.
 */
export function endedTwinTemplate(live: EventTemplateLike): EventTemplateLike {
  const createdAt = live.created_at + 1;
  const tags = live.tags
    .filter((tag) => tag[0] !== 'ends')
    .map((tag) => (tag[0] === 'status' ? ['status', 'ended'] : [...tag]));
  tags.push(['ends', String(createdAt)]);
  return { kind: LIVE_ANNOUNCEMENT_KIND, created_at: createdAt, content: live.content, tags };
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/** The shape of a signed event, nothing about what it says. Unknown fields are dropped by `pickEvent`. */
export function isSignedEventShape(value: unknown): value is SignedEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    HEX64.test(e.id) &&
    typeof e.pubkey === 'string' &&
    HEX64.test(e.pubkey) &&
    typeof e.sig === 'string' &&
    HEX128.test(e.sig) &&
    Number.isSafeInteger(e.created_at) &&
    (e.created_at as number) > 0 &&
    Number.isSafeInteger(e.kind) &&
    typeof e.content === 'string' &&
    Array.isArray(e.tags) &&
    e.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'))
  );
}

/** Exactly the seven signed fields, in a fixed order. */
export function pickEvent(e: SignedEvent): SignedEvent {
  return {
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    kind: e.kind,
    tags: e.tags.map((tag) => [...tag]),
    content: e.content,
    sig: e.sig
  };
}

export type EndedEventProblem =
  | 'shape'
  | 'kind'
  | 'pubkey'
  | 'd'
  | 'status'
  | 'too_old'
  | 'future'
  | 'too_large';

/**
 * Is this the ended announcement of this session, by this host? Checks
 * everything but the signature (the server verifies that separately).
 * Returns null when it is, or the first thing wrong with it.
 */
export function endedEventProblem(
  value: unknown,
  session: { id: string; hostPubkey: string; createdAt: number },
  nowS: number
): EndedEventProblem | null {
  if (!isSignedEventShape(value)) return 'shape';
  if (value.kind !== LIVE_ANNOUNCEMENT_KIND) return 'kind';
  if (value.pubkey !== session.hostPubkey) return 'pubkey';
  const d = value.tags.filter((tag) => tag[0] === 'd');
  if (d.length !== 1 || d[0][1] !== session.id) return 'd';
  const status = value.tags.filter((tag) => tag[0] === 'status');
  if (status.length !== 1 || status[0][1] !== 'ended') return 'status';
  if (value.created_at < session.createdAt) return 'too_old';
  if (value.created_at > nowS + ENDED_EVENT_FUTURE_SKEW_S) return 'future';
  if (new TextEncoder().encode(JSON.stringify(pickEvent(value))).length > ENDED_EVENT_MAX_BYTES)
    return 'too_large';
  return null;
}

const PRIVATE_SUFFIXES = [
  '.local',
  '.localhost',
  '.localdomain',
  '.internal',
  '.intranet',
  '.private',
  '.corp',
  '.home',
  '.lan',
  '.home.arpa',
  '.test',
  '.example',
  '.invalid',
  '.onion',
  '.i2p'
];

/**
 * May the server open a connection to this relay on a host's say-so?
 * wss:// only, a public hostname (no IP literal of either family, no
 * localhost, nothing that names a private network, at least one dot), no
 * credentials, at most 200 characters.
 */
export function isPublicRelayUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 200 || /\s/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'wss:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.startsWith('[') || host.includes(':')) return false; // IPv6 literal
  // IPv4 in any spelling the URL parser accepts (it normalises 0x7f.1,
  // 2130706433 and the like to dotted decimals): no all-numeric last label.
  const labels = host.split('.');
  if (labels.length < 2) return false; // localhost, single-label names
  if (/^(\d+|0x[0-9a-f]*)$/.test(labels[labels.length - 1])) return false;
  if (!labels.every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label))) return false;
  if (PRIVATE_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix)))
    return false;
  return true;
}

/**
 * Relays in most hosts' lists that never keep a live announcement:
 * purplepag.es holds profiles and relay lists only. Never sent, stored
 * or published to as a host relay.
 */
export const ENDED_HOST_RELAYS_NEVER: readonly string[] = ['wss://purplepag.es'];

/**
 * The host's own relays the server will use: valid ones, deduplicated,
 * capped, without `exclude` (the fixed list, which is used anyway) and
 * without ENDED_HOST_RELAYS_NEVER.
 */
export function pickHostRelays(value: unknown, exclude: readonly string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  const norm = (url: string) => url.replace(/\/+$/, '').toLowerCase();
  const seen = new Set([...exclude, ...ENDED_HOST_RELAYS_NEVER].map(norm));
  const out: string[] = [];
  for (const url of value) {
    if (out.length >= ENDED_HOST_RELAYS_MAX) break;
    if (!isPublicRelayUrl(url) || seen.has(norm(url))) continue;
    seen.add(norm(url));
    out.push(url);
  }
  return out;
}
