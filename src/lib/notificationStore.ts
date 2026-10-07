import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type NDK from '@nostr-dev-kit/ndk';
import { NDKKind, NDKRelaySet } from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
import { mutedPubkeys } from '$lib/muteListStore';
import { isHellthread } from '$lib/notificationUtils';
import { decode as decodeBolt11 } from '@gandlaf21/bolt11-decode';
import { extractZapAmountSats } from '$lib/zapAmount';

export interface Notification {
  id: string;
  type: 'reaction' | 'zap' | 'comment' | 'mention' | 'repost';
  fromPubkey: string;
  eventId?: string; // The event to navigate to when clicked
  targetEventId?: string; // The original event being reacted to/replied to (your post)
  content?: string;
  amount?: number; // For zaps, in sats
  emoji?: string; // For reactions
  createdAt: number;
  read: boolean;
}

// v7: drop caches written before the cleanContentForPreview lookbehind fix —
// they contain mentions already mangled to a dangling "nostr: ".
const STORAGE_KEY = 'zc_notifications_v7';
const MAX_STORED_NOTIFICATIONS = 100; // Only store recent notifications for quick load

// Load from localStorage
function loadNotifications(): Notification[] {
  try {
    localStorage.removeItem('zc_notifications_v6'); // orphaned pre-v7 cache
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Notification[];
      // Sort by createdAt descending (most recent first)
      return parsed.sort((a, b) => b.createdAt - a.createdAt);
    }
  } catch {}
  return [];
}

// Save to localStorage (only recent ones for quick initial load)
function saveNotifications(notifications: Notification[]) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(notifications.slice(0, MAX_STORED_NOTIFICATIONS))
    );
  } catch {}
}

// Create the store
function createNotificationStore() {
  const { subscribe, set, update } = writable<Notification[]>(loadNotifications());

  return {
    subscribe,

    add: (notification: Notification) => {
      update((notifications) => {
        // Don't add duplicates
        if (notifications.some((n) => n.id === notification.id)) {
          return notifications;
        }
        // Add and re-sort by createdAt descending (most recent first)
        // No limit on in-memory, only localStorage is limited
        const updated = [notification, ...notifications].sort((a, b) => b.createdAt - a.createdAt);
        saveNotifications(updated);
        return updated;
      });
    },

    addBulk: (newNotifications: Notification[]): number => {
      let addedCount = 0;
      update((notifications) => {
        const existingIds = new Set(notifications.map((n) => n.id));
        const toAdd = newNotifications.filter((n) => {
          if (existingIds.has(n.id)) return false;
          existingIds.add(n.id);
          return true;
        });
        addedCount = toAdd.length;
        if (toAdd.length === 0) return notifications;

        // No limit on in-memory, only localStorage is limited
        const updated = [...notifications, ...toAdd].sort((a, b) => b.createdAt - a.createdAt);
        saveNotifications(updated);
        return updated;
      });
      return addedCount;
    },

    markAsRead: (id: string) => {
      update((notifications) => {
        const updated = notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
        saveNotifications(updated);
        return updated;
      });
    },

    markAllAsRead: () => {
      update((notifications) => {
        const updated = notifications.map((n) => ({ ...n, read: true }));
        saveNotifications(updated);
        return updated;
      });
    },

    clear: () => {
      set([]);
      localStorage.removeItem(STORAGE_KEY);
    },

    getLastTimestamp: (): number => {
      const notifications = get({ subscribe });
      if (notifications.length === 0) return Math.floor(Date.now() / 1000) - 86400; // 24 hours ago
      return Math.max(...notifications.map((n) => n.createdAt));
    }
  };
}

export const notifications = createNotificationStore();

/**
 * True while the initial subscription is fetching (pre-EOSE / pre-timeout).
 * Components should show a spinner instead of "Nothing here yet" while this is true.
 */
export const notificationsLoading = writable(false);

/**
 * Notifications with muted users excluded.
 * Components should use this for display; raw `notifications` is for persistence/dedup only.
 */
export const visibleNotifications = derived(
  [notifications, mutedPubkeys],
  ([$notifications, $mutedPubkeys]) =>
    $mutedPubkeys.size === 0
      ? $notifications
      : $notifications.filter((n) => !n.fromPubkey || !$mutedPubkeys.has(n.fromPubkey))
);

export const unreadCount = derived(
  visibleNotifications,
  ($visible) => $visible.filter((n) => !n.read).length
);

/**
 * Record NIP-57 zap receipt data to Spark SDK.
 * Extracts the payment hash from the bolt11 invoice in the zap receipt,
 * then calls setLnurlMetadata to associate the zap request/receipt with the payment.
 * This is best-effort and non-blocking.
 */
function recordZapToSparkSdk(event: NDKEvent): void {
  try {
    const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')?.[1];
    const descTag = event.tags.find((t) => t[0] === 'description')?.[1];
    const preimageTag = event.tags.find((t) => t[0] === 'preimage')?.[1];

    if (!bolt11Tag) return;

    // Extract payment hash from bolt11
    let paymentHash: string | undefined;
    try {
      const decoded = decodeBolt11(bolt11Tag);
      const hashSection = decoded.sections.find(
        (s: { name: string; value?: unknown }) => s.name === 'payment_hash'
      );
      if (hashSection?.value) {
        paymentHash = String(hashSection.value);
      }
    } catch {
      // Failed to decode bolt11
      return;
    }

    if (!paymentHash) return;

    const zapReceiptJson = JSON.stringify(event.rawEvent());
    const zapRequestJson = descTag || '';

    // Fire-and-forget: import and call recordNip57ZapData
    import('$lib/spark').then(({ recordNip57ZapData, walletInitialized }) => {
      // Only record if Spark wallet is active
      if (!get(walletInitialized)) return;

      recordNip57ZapData(paymentHash!, zapRequestJson, zapReceiptJson, preimageTag).catch(
        () => {} // Silently ignore errors
      );
    }).catch(() => {});
  } catch {
    // Non-fatal: best-effort recording
  }
}

// Subscription manager
let activeSubscription: NDKSubscription | null = null;

// ── Own-note ids (sidecar's loadOwnNoteIds pattern) ─────────────────
// The `#p` route only catches notifications that p-tag us. Replies to our
// notes, reposts of them, and quote reposts are delivered against the note
// ID — NIP-10/NIP-18 never require a p-tag — so the subscription needs our
// recent note ids as an `#e`/`#q` filter. Per pubkey, ADD-TO rather than
// replace: a set snapshot taken before a note we just published reached the
// relays would take that note's notifications away until the next reload.
const ownNoteIds = new Map<string, Set<string>>();
const ownNoteIdsPromises = new Map<string, Promise<Set<string>>>();

function ownNoteIdsFor(pubkey: string): Set<string> {
  let ids = ownNoteIds.get(pubkey);
  if (!ids) {
    ids = new Set();
    ownNoteIds.set(pubkey, ids);
  }
  return ids;
}

/** created_at of the newest own note loaded, per pubkey (refresh cursor). */
const ownNoteNewestAt = new Map<string, number>();

/**
 * Load (first call) or refresh (later calls) the recent own-note ids. Every
 * filter rebuild calls this, so a note published this session joins the set
 * by the next rebuild. A refresh only asks for notes newer than the newest
 * one already loaded; concurrent calls share the request in flight.
 */
export async function loadOwnNoteIds(ndk: NDK, pubkey: string): Promise<Set<string>> {
  const ids = ownNoteIdsFor(pubkey);
  const existing = ownNoteIdsPromises.get(pubkey);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const newestAt = ownNoteNewestAt.get(pubkey);
      const events = await ndk.fetchEvents(
        newestAt === undefined
          ? { kinds: [1], authors: [pubkey], limit: 50 }
          : { kinds: [1], authors: [pubkey], since: newestAt, limit: 50 },
        { closeOnEose: true, groupable: false }
      );
      const sorted = [...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      let newest = newestAt ?? 0;
      for (const e of sorted.slice(0, 50)) {
        if (e.id) ids.add(e.id);
        newest = Math.max(newest, e.created_at || 0);
      }
      ownNoteNewestAt.set(pubkey, newest);
    } catch {
      // Non-fatal: the #p routes still cover the p-tagged majority.
    }
    return ids;
  })();
  ownNoteIdsPromises.set(pubkey, promise);
  promise.finally(() => ownNoteIdsPromises.delete(pubkey));
  return promise;
}

/**
 * The one place notification query filters are built (sidecar's
 * buildFilters): the subscription, the older-pages fetch and the bell's
 * refetch all ask the same routes so their behaviors can't drift. The
 * own-note id set is read at call time — a note published this session
 * is in the set by the next rebuild.
 */
function buildNotificationFilters(
  userPubkey: string,
  since: number,
  until?: number
): NDKFilter[] {
  const bound: NDKFilter = until ? { since, until } : { since };
  const filters: NDKFilter[] = [
    // Reactions to my posts (NIP-25)
    { kinds: [7], '#p': [userPubkey], ...bound },
    // Zap receipts (NIP-57)
    { kinds: [9735], '#p': [userPubkey], ...bound },
    // Replies and mentions (NIP-10)
    { kinds: [1], '#p': [userPubkey], ...bound },
    // Reposts of kind 1 notes (NIP-18)
    { kinds: [6], '#p': [userPubkey], ...bound },
    // Generic reposts — recipes, etc. (NIP-18 kind 16)
    { kinds: [16], '#p': [userPubkey], ...bound },
    // NIP-22 comments on my recipes (uppercase P = root event author)
    { kinds: [1111 as NDKKind], '#P': [userPubkey], ...bound },
    // NIP-22 replies to my comments (lowercase p = parent comment author)
    { kinds: [1111 as NDKKind], '#p': [userPubkey], ...bound }
  ];
  const ids = [...ownNoteIdsFor(userPubkey)];
  if (ids.length > 0) {
    // Replies to my notes matched by id — catches the clients that don't
    // p-tag the parent author. handleEvent re-checks threading so a note
    // that merely cites my note deep in its e-tags doesn't notify.
    filters.push({ kinds: [1], '#e': ids, ...bound });
    // Reposts of my notes by id (kind 6's #p route above already covers
    // the clients that p-tag; this is the ones that don't).
    filters.push({ kinds: [6], '#e': ids, ...bound });
    // Quote reposts (NIP-18 `q` tag) of my notes — there is no #p for a
    // pure quote, so without this route quotes are invisible.
    filters.push({ kinds: [1], '#q': ids, ...bound });
  }
  return filters;
}

/**
 * Kind-1 events from the id-matched (`#e`/`#q`) routes need a relevance
 * check the relay filter can't express: `#e` matches ANY e tag, so a note
 * that cites one of mine deep in a thread but replies to someone else
 * would otherwise notify. A p-tag of me is always relevant (that's a
 * mention); otherwise the reply target (marker or last e tag) or the q
 * tag must actually be one of my notes.
 */
function isRelevantKind1(event: NDKEvent, userPubkey: string): boolean {
  if (event.tags.some((t) => t[0] === 'p' && t[1] === userPubkey)) return true;
  const ids = ownNoteIdsFor(userPubkey);
  if (ids.size === 0) return false;
  if (event.tags.some((t) => t[0] === 'q' && t[1] && ids.has(t[1]))) return true;
  const eTags = event.tags.filter((t) => t[0] === 'e');
  const replyMarker = eTags.find((t) => t[3] === 'reply') || eTags.find((t) => t[3] === 'root');
  const replyTarget = replyMarker ? replyMarker[1] : eTags.length > 0 ? eTags[eTags.length - 1][1] : undefined;
  return !!replyTarget && ids.has(replyTarget);
}

/**
 * Subscribe on the account's NIP-65 inbox relays when they resolve in
 * time (that's where zap receipts and client notifications are
 * delivered), unioned with the relays the pool already reached. Falls
 * back to the pool untouched when no inbox list is available, so
 * coverage never shrinks below the old behavior.
 */
async function buildSubscriptionRelaySet(
  ndk: NDK,
  userPubkey: string
): Promise<NDKRelaySet | null> {
  try {
    const { getInboxRelays } = await import('$lib/relayListCache');
    const lookup = getInboxRelays(userPubkey).catch(() => [] as string[]);
    const inbox = await Promise.race([
      lookup,
      new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 2500))
    ]);
    if (!inbox || inbox.length === 0) return null;
    const urls = new Set<string>();
    for (const url of inbox.slice(0, 6)) urls.add(url);
    for (const relay of ndk.pool?.relays?.values() || []) {
      if (urls.size >= 12) break;
      if (relay.url) urls.add(relay.url);
    }
    if (urls.size === 0) return null;
    // true = open temporary connections for inbox relays the pool hasn't
    // reached yet; without that a correct-but-unconnected inbox list
    // would silently deliver nothing.
    return NDKRelaySet.fromRelayUrls([...urls], ndk, true);
  } catch {
    return null;
  }
}

export async function subscribeToNotifications(
  ndk: NDK,
  userPubkey: string,
  forceFullRefresh = false
) {
  if (activeSubscription) {
    activeSubscription.stop();
  }

  notificationsLoading.set(true);

  // Use a longer lookback window (7 days) for better notification coverage
  // On force refresh, go back 7 days regardless of existing notifications
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const lastTimestamp = notifications.getLastTimestamp();

  // Use the earlier of: 7 days ago OR last notification timestamp
  // This ensures we don't miss notifications even if we have recent ones
  const since = forceFullRefresh ? sevenDaysAgo : Math.min(sevenDaysAgo, lastTimestamp);

  console.log(
    '[Notifications] Subscribing for:',
    userPubkey,
    'since:',
    new Date(since * 1000),
    forceFullRefresh ? '(forced refresh)' : ''
  );

  // Load our recent note ids BEFORE subscribing (bounded — sidecar caps
  // the same loaders at 5s so a slow relay can't stall notifications) so
  // the #e/#q routes are in the very first REQ rather than arriving a
  // reload later.
  await Promise.race([
    loadOwnNoteIds(ndk, userPubkey),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);

  const filters = buildNotificationFilters(userPubkey, since);
  const relaySet = await buildSubscriptionRelaySet(ndk, userPubkey);

  // Subscribe to reactions, zaps, replies, mentions, and reposts —
  // routes shared with the older-pages fetch and the bell refetch via
  // buildNotificationFilters. The relay set targets the NIP-65 inbox
  // when known (undefined = NDK's default pool behavior).
  activeSubscription = ndk.subscribe(
    filters,
    { closeOnEose: false },
    relaySet ?? undefined
  );

  // Buffer events received before EOSE so we can insert them in one
  // addBulk() call (one sort + one localStorage write) instead of doing
  // a full sort + localStorage write for every individual event.
  let eoseReceived = false;
  const preEoseBuffer: NDKEvent[] = [];

  // Realtime (post-EOSE) events also arrive in bursts — a popular post
  // gets zapped/replied to repeatedly within the same second, and each
  // individual add() pays a full sort plus a synchronous localStorage
  // write. Buffer them briefly and insert in one addBulk(); local
  // system notifications still fire immediately per event.
  const REALTIME_FLUSH_MS = 1000;
  const realtimeBuffer: Notification[] = [];
  let realtimeFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushRealtimeBuffer() {
    realtimeFlushTimer = null;
    if (realtimeBuffer.length === 0) return;
    const batch = realtimeBuffer.splice(0, realtimeBuffer.length);
    notifications.addBulk(batch);
  }

  function flushPreEoseBuffer() {
    if (preEoseBuffer.length === 0) return;
    const parsed: Notification[] = [];
    const seenIds = new Set<string>();
    for (const event of preEoseBuffer) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      const notification = parseNotification(event, userPubkey);
      if (notification) {
        parsed.push(notification);
        if (event.kind === 9735) recordZapToSparkSdk(event);
      }
    }
    preEoseBuffer.length = 0;
    if (parsed.length > 0) notifications.addBulk(parsed);
  }

  function handleEvent(event: NDKEvent, isRealtime: boolean) {
    // For zap receipts (9735), the pubkey is the zapper service, not the sender.
    // Self-zap filtering happens in parseNotification after extracting the real sender.
    if (event.kind !== 9735 && event.pubkey === userPubkey) return;
    if (isHellthread(event)) return;
    // The id-matched routes (`#e`/`#q` on our note ids) match ANY e/q tag
    // at the relay — a kind-1 note that merely cites one of our notes deep
    // in a thread must not notify unless it actually replies to, quotes,
    // or mentions us.
    if (event.kind === 1 && !isRelevantKind1(event, userPubkey)) return;

    const notification = parseNotification(event, userPubkey);
    if (!notification) return;

    if (!isRealtime) {
      // Pre-EOSE: buffer for bulk insert
      preEoseBuffer.push(event);
      return;
    }

    // Post-EOSE realtime event: buffer briefly (bursts of activity on a
    // popular post otherwise pay a sort + localStorage write each)
    realtimeBuffer.push(notification);
    if (realtimeFlushTimer === null) {
      realtimeFlushTimer = setTimeout(flushRealtimeBuffer, REALTIME_FLUSH_MS);
    }

    if (event.kind === 9735) recordZapToSparkSdk(event);

    if (browser) {
      sendLocalNotificationForNostrEvent(notification).catch((error) => {
        console.error('[Notifications] Error sending local notification:', error);
      });
    }
  }

  activeSubscription.on('event', (event: NDKEvent) => {
    handleEvent(event, eoseReceived);
  });

  const thisSubscription = activeSubscription;

  activeSubscription.on('eose', () => {
    if (activeSubscription !== thisSubscription) return;
    clearTimeout(eoseTimer);
    eoseReceived = true;
    flushPreEoseBuffer();
    notificationsLoading.set(false);
  });

  // Safety valve: some relays never send EOSE (or send it very late).
  // After 10 s, flush whatever accumulated so history is always persisted
  // to localStorage and shown in the UI — even if EOSE never arrives.
  // Guard against stale timers firing for a replaced subscription.
  const eoseTimer = setTimeout(() => {
    if (activeSubscription !== thisSubscription) return;
    if (!eoseReceived) {
      eoseReceived = true;
      flushPreEoseBuffer();
    }
    notificationsLoading.set(false);
  }, 10000);

  return activeSubscription;
}

export function unsubscribeFromNotifications() {
  if (activeSubscription) {
    activeSubscription.stop();
    activeSubscription = null;
  }
}

// ── Bell refetch (sidecar's cache.refetch pattern) ──────────────────
// The live subscription only covers what arrives while it runs: on
// mobile the app backgrounding kills the socket, and a relay that
// dropped and rejoined mid-session leaves a gap. Opening the bell
// runs ONE bounded re-query through the same processing path as the
// backfill (dedupe by id via addBulk), so the alert screen catches up
// without a reload. Single-flight: overlapping opens share the run in
// flight instead of resetting each other.
let refetchRun: Promise<number> | null = null;

export function refetchNotifications(ndk: NDK, userPubkey: string): Promise<number> {
  if (refetchRun) return refetchRun;
  const run = (async () => {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const since = Math.min(sevenDaysAgo, notifications.getLastTimestamp());

    // Fresh own-note ids: a note published this session is in the set by
    // this rebuild, so its replies/quotes/reposts are asked for too.
    await Promise.race([
      loadOwnNoteIds(ndk, userPubkey),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);

    const storeEmpty = get(notifications).length === 0;
    if (storeEmpty) notificationsLoading.set(true);

    try {
      const relaySet = await buildSubscriptionRelaySet(ndk, userPubkey);
      const collected: NDKEvent[] = [];
      return await new Promise<number>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          try {
            sub.stop();
          } catch {}
          const count = processCollectedEvents(collected, userPubkey);
          resolve(count);
        };
        const sub = ndk.subscribe(
          buildNotificationFilters(userPubkey, since),
          { closeOnEose: true },
          relaySet ?? undefined
        );
        sub.on('event', (event: NDKEvent) => {
          if (event.kind !== 9735 && event.pubkey === userPubkey) return;
          if (isHellthread(event)) return;
          if (event.kind === 1 && !isRelevantKind1(event, userPubkey)) return;
          collected.push(event);
        });
        sub.on('eose', finish);
        // Capped: a relay that never sends EOSE must not leave the run open.
        setTimeout(finish, 6000);
      });
    } finally {
      if (storeEmpty) notificationsLoading.set(false);
    }
  })();
  refetchRun = run;
  run.finally(() => {
    if (refetchRun === run) refetchRun = null;
  });
  return run;
}

/**
 * Fetch older notifications before a given timestamp
 * Returns the number of new notifications found
 */
export async function fetchOlderNotifications(
  ndk: NDK,
  userPubkey: string,
  beforeTimestamp: number
): Promise<number> {
  // Fetch 7 days before the given timestamp
  const until = beforeTimestamp;
  const since = beforeTimestamp - 7 * 24 * 60 * 60;

  console.log(
    '[Notifications] Fetching older notifications from',
    new Date(since * 1000),
    'to',
    new Date(until * 1000)
  );

  let newCount = 0;
  const collectedEvents: NDKEvent[] = [];

  // Own-note ids read at call time so the id-matched routes cover notes
  // published since the session subscription started.
  await Promise.race([
    loadOwnNoteIds(ndk, userPubkey),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);

  return new Promise((resolve) => {
    const TIMEOUT_MS = 8000; // 8 second timeout
    let resolved = false;

    const sub = ndk.subscribe(
      buildNotificationFilters(userPubkey, since),
      { closeOnEose: true }
    );

    sub.on('event', (event: NDKEvent) => {
      collectedEvents.push(event);
    });

    sub.on('eose', () => {
      if (resolved) return;
      resolved = true;
      sub.stop();
      newCount = processCollectedEvents(collectedEvents, userPubkey);
      console.log('[Notifications] Found', newCount, 'older notifications (EOSE)');
      resolve(newCount);
    });

    // Timeout fallback
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      sub.stop();
      newCount = processCollectedEvents(collectedEvents, userPubkey);
      console.log('[Notifications] Found', newCount, 'older notifications (timeout)');
      resolve(newCount);
    }, TIMEOUT_MS);
  });
}

function processCollectedEvents(events: NDKEvent[], userPubkey: string): number {
  const newNotifications: Notification[] = [];
  const seenIds = new Set<string>();

  for (const event of events) {
    // Skip duplicates within this batch
    if (seenIds.has(event.id)) {
      continue;
    }
    seenIds.add(event.id);

    // Skip own events (except zaps)
    if (event.kind !== 9735 && event.pubkey === userPubkey) {
      continue;
    }

    // Filter out hellthreads
    if (isHellthread(event)) {
      continue;
    }

    // Same relevance gate as the live path — the older-pages fetch uses
    // the shared filters, including the id-matched routes.
    if (event.kind === 1 && !isRelevantKind1(event, userPubkey)) {
      continue;
    }

    const notification = parseNotification(event, userPubkey);
    if (notification) {
      newNotifications.push(notification);
    }

    // Record NIP-57 zap data to Spark SDK for received zaps
    if (event.kind === 9735) {
      recordZapToSparkSdk(event);
    }
  }

  // Add all new notifications in bulk (returns actual count added)
  return notifications.addBulk(newNotifications);
}

// Clean up content for preview — preserve nostr: references for display-layer resolution
function cleanContentForPreview(content: string): string {
  if (!content) return '';

  let cleaned = content
    // Remove image URLs (they don't render in text previews)
    .replace(/https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|svg|bmp|avif)(?:\?[^\s]*)?/gi, '')
    .replace(/https?:\/\/(?:i\.)?(?:nostr\.build|imgur\.com|primal\.b-cdn\.net|image\.nostr\.build|void\.cat|m\.primal\.net|cdn\.satellite\.earth)[^\s]*/gi, '')
    // Remove standalone bech32 identifiers (without nostr: prefix) — display layer only resolves nostr: URIs.
    // The consumed-and-re-emitted nostr: prefix keeps `nostr:npub1…` mentions intact; without it
    // the bech32 gets stripped out of the URI, leaving a dangling literal "nostr: " that the
    // display layer can no longer resolve to a name. (No lookbehind: parse-time
    // SyntaxError on iOS Safari < 16.4.)
    .replace(/(nostr:)?\b(?:note1|nevent1|naddr1|npub1|nprofile1)[023456789ac-hj-np-z]{20,}\b/gi, (match, nostrPrefix) => (nostrPrefix ? match : ' '))
    // Clean up multiple spaces and newlines
    .replace(/\s+/g, ' ')
    .trim();

  // If the cleaned content is too short or just punctuation, return empty
  if (cleaned.length < 3 || /^[\s\p{P}]*$/u.test(cleaned)) {
    return '';
  }

  return cleaned.slice(0, 300);
}

function parseNotification(event: NDKEvent, userPubkey: string): Notification | null {
  const baseNotification = {
    id: event.id,
    fromPubkey: event.pubkey,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
    read: false
  };

  switch (event.kind) {
    case 7: { // Reaction
      // NIP-25: "the target event id should be last of the e tags"
      const eTags7 = event.tags.filter((t) => t[0] === 'e');
      const reactedEventId = eTags7.length > 0 ? eTags7[eTags7.length - 1][1] : undefined;
      // NIP-25: content "+" or empty means like/upvote → normalize to ❤️
      const rawEmoji = event.content;
      const emoji = rawEmoji && rawEmoji !== '+' ? rawEmoji : '❤️';
      return {
        ...baseNotification,
        type: 'reaction',
        eventId: reactedEventId,
        emoji
      };
    }

    case 9735: { // Zap receipt
      // The zap receipt is published by the zapper service (e.g., Alby)
      // The actual sender info is in the embedded zap request in the 'description' tag
      let zapSenderPubkey = event.pubkey; // fallback to zapper if we can't parse
      let zapComment = '';
      try {
        const descTag = event.tags.find((t) => t[0] === 'description')?.[1];
        if (descTag) {
          const zapRequest = JSON.parse(descTag);
          if (zapRequest.pubkey) {
            zapSenderPubkey = zapRequest.pubkey;
          }
          // NIP-57: zap request content is an optional message from the sender
          if (zapRequest.content) {
            zapComment = cleanContentForPreview(zapRequest.content);
          }
        }
      } catch (e) {
        console.error('[Notifications] Error parsing zap:', e);
      }

      // Skip self-zaps (user zapping their own content or someone else)
      if (zapSenderPubkey === userPubkey) return null;

      const zapAmount = extractZapAmountSats(event).sats;

      const zappedEventId = event.tags.find((t) => t[0] === 'e')?.[1];
      return {
        ...baseNotification,
        fromPubkey: zapSenderPubkey,
        type: 'zap',
        eventId: zappedEventId,
        amount: zapAmount,
        content: zapComment || undefined
      };
    }

    case 1: { // Reply, mention, or quote repost
      // NIP-10: events with e-tags are replies in a thread; events without are standalone notes.
      // Both types p-tag the user — "mention" here means no thread context, "comment" means
      // there is one. The Mentions UI tab shows both types (any note that tagged you).
      const eTags = event.tags.filter((t) => t[0] === 'e');
      const isReply = eTags.length > 0;

      // NIP-18 quote repost: a `q` tag naming one of our notes with no
      // thread e-tags. The `#q` subscription route is what makes these
      // arrive at all — without it a pure quote never notifies.
      const qTag = event.tags.find((t) => t[0] === 'q' && t[1]);
      if (!isReply && qTag && ownNoteIdsFor(userPubkey).has(qTag[1])) {
        return {
          ...baseNotification,
          type: 'repost',
          eventId: qTag[1]
        };
      }

      // Get the event being replied to (prefer 'reply' marker, then 'root', then last e tag per NIP-10)
      let replyToEvent: string | undefined;
      const replyMarkerTag = eTags.find((t) => t[3] === 'reply');
      const rootMarkerTag = eTags.find((t) => t[3] === 'root');
      if (replyMarkerTag) {
        replyToEvent = replyMarkerTag[1];
      } else if (rootMarkerTag) {
        replyToEvent = rootMarkerTag[1];
      } else if (eTags.length > 0) {
        // No markers — deprecated positional: last e tag is reply target
        replyToEvent = eTags[eTags.length - 1][1];
      }

      return {
        ...baseNotification,
        type: isReply ? 'comment' : 'mention',
        eventId: event.id,
        targetEventId: replyToEvent,
        content: cleanContentForPreview(event.content || '')
      };
    }

    case 1111: { // NIP-22 comment on a recipe or reply to a comment
      // lowercase 'e' tag = parent comment id (present when replying to a comment)
      const parentETag = event.tags.find((t) => t[0] === 'e');
      return {
        ...baseNotification,
        type: 'comment',
        eventId: event.id,
        targetEventId: parentETag?.[1],
        content: cleanContentForPreview(event.content || '')
      };
    }

    case 6: // Repost (kind 1 notes)
    case 16: { // Generic repost (recipes, etc. per NIP-18)
      const repostedEventId = event.tags.find((t) => t[0] === 'e')?.[1];
      return {
        ...baseNotification,
        type: 'repost',
        eventId: repostedEventId
      };
    }

    default:
      return null;
  }
}

/**
 * Send a local notification for a Nostr event (zap, reply, etc.)
 * Only sends if app is backgrounded and permissions are granted
 */
async function sendLocalNotificationForNostrEvent(notification: Notification): Promise<void> {
  if (!browser) return;

  // Check if app is in foreground - if so, don't send notification (user is already seeing it)
  let isAppActive = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { App } = await import('@capacitor/app');
      const state = await App.getState();
      isAppActive = state.isActive;
    } else {
      // On web, assume active if document is visible
      isAppActive = !document.hidden;
    }
  } catch (error) {
    // If we can't check app state, assume active (safer)
    isAppActive = !document.hidden;
  }

  // Only send notification if app is backgrounded
  if (isAppActive) {
    return;
  }

  // Check permissions
  try {
    const { checkNotificationPermissions, sendImmediateNotification } = await import(
      '$lib/native/notifications'
    );
    const permission = await checkNotificationPermissions();

    if (permission !== 'granted') {
      return;
    }

    // Format notification message based on type
    let title = 'Zap Cooking';
    let body = '';

    switch (notification.type) {
      case 'zap':
        body = `⚡ You received ${notification.amount?.toLocaleString() || 'a'} zap${notification.amount ? ' sats' : ''}`;
        if (notification.content) {
          body += `: ${notification.content.slice(0, 50)}${notification.content.length > 50 ? '...' : ''}`;
        }
        break;
      case 'comment':
        body = '💬 Someone replied to your post';
        if (notification.content) {
          body += `: ${notification.content.slice(0, 50)}${notification.content.length > 50 ? '...' : ''}`;
        }
        break;
      case 'mention':
        body = '📣 Someone mentioned you';
        if (notification.content) {
          body += `: ${notification.content.slice(0, 50)}${notification.content.length > 50 ? '...' : ''}`;
        }
        break;
      case 'reaction':
        body = `❤️ Someone reacted ${notification.emoji || '❤️'}`;
        break;
      case 'repost':
        body = '🔁 Someone reposted your note';
        break;
      default:
        body = '🔔 You have a new notification';
    }

    // Send the notification
    await sendImmediateNotification(title, body, {
      notificationId: notification.id,
      type: notification.type,
      eventId: notification.eventId
    });
  } catch (error) {
    console.error('[Notifications] Error sending local notification for Nostr event:', error);
  }
}
