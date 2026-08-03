import NDK, {
  NDKRelaySet,
  NDKSubscriptionCacheUsage,
  type NDKEvent,
  type NDKRelay
} from '@nostr-dev-kit/ndk';
import { extractZapAmountSats } from './zapAmount';

const DETAIL_CACHE_TTL = 2 * 60 * 1000;
const DETAIL_FETCH_TIMEOUT = 4500;
const ZAP_AGGREGATOR_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net'];

export interface ReactionDetailGroup {
  emoji: string;
  pubkeys: string[];
}

export interface ZapDetail {
  id: string;
  pubkey: string;
  amount: number;
  timestamp: number;
  comment?: string;
}

export interface PostEngagementDetails {
  reactions: ReactionDetailGroup[];
  zaps: ZapDetail[];
  reposts: string[];
  relays: string[];
}

interface CachedDetails {
  details: PostEngagementDetails;
  timestamp: number;
}

const detailCache = new Map<string, CachedDetails>();

function normalizeRelayUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

function reactionEmoji(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed || trimmed === '+') return '❤️';
  if (trimmed === '-') return '👎';
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) return null;
  return trimmed;
}

function parseZapDetail(event: NDKEvent): ZapDetail | null {
  const { sats } = extractZapAmountSats(event);
  if (sats <= 0) return null;

  let pubkey = event.pubkey;
  let comment: string | undefined;

  try {
    const description = event.tags.find((tag) => tag[0] === 'description')?.[1];
    if (description) {
      const request = JSON.parse(description);
      if (typeof request.pubkey === 'string' && request.pubkey.length > 0) {
        pubkey = request.pubkey;
      }
      if (typeof request.content === 'string' && request.content.trim().length > 0) {
        comment = request.content.trim();
      }
    }
  } catch {
    // A malformed description should not hide an otherwise valid receipt.
  }

  return {
    id: event.id,
    pubkey,
    amount: sats,
    timestamp: event.created_at || 0,
    comment
  };
}

export function aggregatePostEngagementEvents(
  events: Iterable<NDKEvent>,
  relayUrls: Iterable<string> = []
): PostEngagementDetails {
  const reactions = new Map<string, Set<string>>();
  const reposts = new Set<string>();
  const zaps = new Map<string, ZapDetail>();

  for (const event of events) {
    if (!event.id) continue;

    if (event.kind === 7) {
      const emoji = reactionEmoji(event.content);
      if (!emoji) continue;
      const pubkeys = reactions.get(emoji) ?? new Set<string>();
      pubkeys.add(event.pubkey);
      reactions.set(emoji, pubkeys);
    } else if (event.kind === 6 || event.kind === 16) {
      reposts.add(event.pubkey);
    } else if (event.kind === 9735) {
      const zap = parseZapDetail(event);
      if (zap) zaps.set(event.id, zap);
    }
  }

  return {
    reactions: Array.from(reactions, ([emoji, pubkeys]) => ({
      emoji,
      pubkeys: Array.from(pubkeys)
    })).sort((a, b) => b.pubkeys.length - a.pubkeys.length || a.emoji.localeCompare(b.emoji)),
    zaps: Array.from(zaps.values()).sort(
      (a, b) => b.amount - a.amount || b.timestamp - a.timestamp
    ),
    reposts: Array.from(reposts),
    relays: Array.from(new Set(Array.from(relayUrls, normalizeRelayUrl).filter(Boolean))).sort(
      (a, b) => a.localeCompare(b)
    )
  };
}

function eventRelayUrls(event: NDKEvent): string[] {
  try {
    return event.onRelays.map((relay) => relay.url).filter(Boolean);
  } catch {
    return event.relay?.url ? [event.relay.url] : [];
  }
}

function mergeCurrentRelays(
  details: PostEngagementDetails,
  event: NDKEvent
): PostEngagementDetails {
  return {
    ...details,
    relays: Array.from(
      new Set([...details.relays, ...eventRelayUrls(event)].map(normalizeRelayUrl).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b))
  };
}

export async function loadPostEngagementDetails(
  ndk: NDK,
  targetEvent: NDKEvent,
  onUpdate?: (details: PostEngagementDetails) => void
): Promise<PostEngagementDetails> {
  const cached = detailCache.get(targetEvent.id);
  if (cached && Date.now() - cached.timestamp < DETAIL_CACHE_TTL) {
    const details = mergeCurrentRelays(cached.details, targetEvent);
    onUpdate?.(details);
    return details;
  }

  const events = new Map<string, NDKEvent>();
  const relays = new Set(eventRelayUrls(targetEvent).map(normalizeRelayUrl));

  // Temporary relays connect asynchronously. If the subscription starts first,
  // its initial REQ can miss the aggregator carrying a zap receipt and then cache
  // that incomplete result. Match the main engagement cache by connecting these
  // relays before building the close-on-EOSE subscription.
  await Promise.all(
    ZAP_AGGREGATOR_RELAYS.map(async (url) => {
      try {
        const relay = ndk.pool.getRelay(url, true, true);
        if (relay.connectivity?.status !== 1) await relay.connect();
      } catch {
        // Other connected relays can still satisfy the request.
      }
    })
  );

  const relayUrls = new Set([
    ...ndk.pool.connectedRelays().map((relay) => relay.url),
    ...(ndk.explicitRelayUrls ?? []),
    ...eventRelayUrls(targetEvent),
    ...ZAP_AGGREGATOR_RELAYS
  ]);

  const emitUpdate = () => {
    const details = aggregatePostEngagementEvents(events.values(), relays);
    onUpdate?.(details);
    return details;
  };

  emitUpdate();

  const relaySet = NDKRelaySet.fromRelayUrls(Array.from(relayUrls), ndk, true);
  const filters = [{ ids: [targetEvent.id] }, { kinds: [7, 6, 16, 9735], '#e': [targetEvent.id] }];

  return new Promise<PostEngagementDetails>((resolve) => {
    const sub = ndk.subscribe(
      filters,
      {
        closeOnEose: true,
        cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
        groupable: false
      },
      relaySet
    );
    let finished = false;
    let timeout: ReturnType<typeof setTimeout>;

    const recordRelay = (relay: NDKRelay | undefined) => {
      if (relay?.url) relays.add(normalizeRelayUrl(relay.url));
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      sub.stop();
      const details = emitUpdate();
      detailCache.set(targetEvent.id, { details, timestamp: Date.now() });
      resolve(details);
    };

    sub.on('event', (event, relay) => {
      if (event.id === targetEvent.id) {
        recordRelay(relay);
      } else if (event.id) {
        events.set(event.id, event);
      }
      emitUpdate();
    });

    sub.on('event:dup', (eventId, relay) => {
      if (eventId === targetEvent.id) {
        recordRelay(relay);
        emitUpdate();
      }
    });

    sub.on('eose', finish);
    sub.on('close', finish);

    timeout = setTimeout(finish, DETAIL_FETCH_TIMEOUT);
  });
}

export function clearPostEngagementDetailsCache(): void {
  detailCache.clear();
}
