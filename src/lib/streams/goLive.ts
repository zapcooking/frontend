/**
 * Go live sessions in the Live directory and on the shared stream page.
 *
 * A Go live session lives on Zap Cooking's own server, not on Nostr relays,
 * so it is read from /api/live and mapped to the same `StreamItem` the
 * NIP-53 code uses (`source: 'zapcooking'`). The directory, the stream page
 * and the dock then treat both kinds alike; only the video engine and the
 * stream page's side panels look at `source`.
 */
import { naddrEncode, streamAddress } from './parse';
import type { StreamItem } from './types';
import { liveStreamName } from '$lib/live/streamName';

/** The public shape of a session, as GET /api/live and /api/live/<id> return it. */
export interface GoLiveSession {
  id: string;
  status: 'created' | 'live' | 'ended';
  title: string;
  recipe_a: string | null;
  host_pubkey: string;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

/** What the directory and the recipe panel show about an attached recipe. */
export interface RecipeCard {
  title: string;
  image: string | null;
}

const SESSION_ID = /^[0-9a-f]{32}$/;

export function isGoLiveSession(value: unknown): value is GoLiveSession {
  const v = value as Partial<GoLiveSession> | null;
  return (
    !!v &&
    typeof v.id === 'string' &&
    SESSION_ID.test(v.id) &&
    (v.status === 'created' || v.status === 'live' || v.status === 'ended') &&
    typeof v.title === 'string' &&
    typeof v.host_pubkey === 'string' &&
    typeof v.created_at === 'number'
  );
}

export function isGoLiveItem(item: Pick<StreamItem, 'source'> | null | undefined): boolean {
  return item?.source === 'zapcooking';
}

/**
 * The `StreamItem` for a session, with its recipe's title and photo when
 * known. Its title is the stream's name (see $lib/live/streamName): pass the
 * host's real name, when known, for "<host> is cooking <recipe>".
 */
export function sessionToStreamItem(
  session: GoLiveSession,
  recipe?: RecipeCard | null,
  hostName?: string | null
): StreamItem {
  // A session the host has created but not yet published to reads as live:
  // the player waits ("Connecting…") until the broadcast starts.
  const status = session.status === 'ended' ? 'ended' : 'live';
  return {
    key: `zc:${session.id}`,
    id: session.id,
    updated: session.ended_at ?? session.started_at ?? session.created_at,
    title: liveStreamName({
      title: session.title,
      hasRecipe: !!session.recipe_a,
      recipeTitle: recipe?.title,
      hostName
    }),
    url: null,
    recording: null,
    status,
    image: recipe?.image ?? null,
    thumb: null,
    summary: recipe?.title ? `Cooking ${recipe.title}, live on Zap Cooking.` : '',
    starts: session.started_at,
    ends: session.ended_at,
    categories: [],
    live: status === 'live',
    // No viewer counts for Go live: nothing about viewers is kept.
    viewers: null,
    relays: [],
    host: session.host_pubkey,
    source: 'zapcooking',
    sessionId: session.id,
    recipeA: session.recipe_a
  };
}

/** The page a stream opens on: `/live/s/<id>` for Go live, `/live/<naddr>` for NIP-53. */
export function streamPath(item: StreamItem): string | null {
  if (isGoLiveItem(item)) return item.sessionId ? `/live/s/${item.sessionId}` : null;
  const address = streamAddress(item);
  if (!address) return null;
  try {
    return `/live/${naddrEncode(address)}`;
  } catch {
    return null;
  }
}

/** Live sessions for the directory. Empty when the server cannot be reached. */
export async function fetchLiveSessions(fetchFn: typeof fetch = fetch): Promise<GoLiveSession[]> {
  try {
    const res = await fetchFn('/api/live');
    if (!res.ok) return [];
    const data = (await res.json()) as { sessions?: unknown };
    return Array.isArray(data.sessions) ? data.sessions.filter(isGoLiveSession) : [];
  } catch {
    return [];
  }
}

/**
 * One session. `null` when it does not exist, `undefined` when it could not
 * be read right now (keep showing what is on screen).
 */
export async function fetchSession(
  id: string,
  fetchFn: typeof fetch = fetch
): Promise<GoLiveSession | null | undefined> {
  if (!SESSION_ID.test(id)) return null;
  try {
    const res = await fetchFn(`/api/live/${id}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) return undefined;
    const data = await res.json();
    return isGoLiveSession(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sessions first, then NIP-53 streams: the Live now tab's order. Zap
 * Cooking's own broadcasts lead, newest first.
 */
export function mergeLiveItems(goLive: StreamItem[], nostr: StreamItem[]): StreamItem[] {
  const ours = [...goLive].sort((a, b) => (b.starts ?? b.updated) - (a.starts ?? a.updated));
  return [...ours, ...nostr];
}
