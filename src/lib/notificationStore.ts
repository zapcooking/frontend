import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import { mutedPubkeys } from '$lib/muteListStore';
import { isHellthread } from '$lib/notificationUtils';
import { decode as decodeBolt11 } from '@gandlaf21/bolt11-decode';

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

const STORAGE_KEY = 'zc_notifications_v6'; // Cursor-based pagination
const MAX_STORED_NOTIFICATIONS = 100; // Only store recent notifications for quick load

// Load from localStorage
function loadNotifications(): Notification[] {
  try {
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

export function subscribeToNotifications(ndk: NDK, userPubkey: string, forceFullRefresh = false) {
  if (activeSubscription) {
    activeSubscription.stop();
  }

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

  // Subscribe to reactions, zaps, replies, mentions, and reposts
  activeSubscription = ndk.subscribe(
    [
      // Reactions to my posts (NIP-25)
      { kinds: [7], '#p': [userPubkey], since },
      // Zap receipts (NIP-57)
      { kinds: [9735], '#p': [userPubkey], since },
      // Replies and mentions (NIP-10)
      { kinds: [1], '#p': [userPubkey], since },
      // Reposts of kind 1 notes (NIP-18)
      { kinds: [6], '#p': [userPubkey], since },
      // Generic reposts — recipes, etc. (NIP-18 kind 16)
      { kinds: [16], '#p': [userPubkey], since }
    ],
    { closeOnEose: false }
  );

  activeSubscription.on('event', async (event: NDKEvent) => {
    // For zap receipts (9735), the pubkey is the zapper service, not the sender.
    // Self-zap filtering happens in parseNotification after extracting the real sender.
    if (event.kind !== 9735 && event.pubkey === userPubkey) {
      return;
    }

    // Filter out hellthreads (events with excessive p tags)
    if (isHellthread(event)) {
      return;
    }

    const notification = parseNotification(event, userPubkey);
    if (notification) {
      // Add to store
      notifications.add(notification);

      // Record NIP-57 zap data to Spark SDK for received zaps
      if (event.kind === 9735) {
        recordZapToSparkSdk(event);
      }

      // Send local notification if app is backgrounded and permissions are granted
      if (browser) {
        try {
          await sendLocalNotificationForNostrEvent(notification);
        } catch (error) {
          console.error('[Notifications] Error sending local notification:', error);
        }
      }
    }
  });

  return activeSubscription;
}

export function unsubscribeFromNotifications() {
  if (activeSubscription) {
    activeSubscription.stop();
    activeSubscription = null;
  }
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

  return new Promise((resolve) => {
    const TIMEOUT_MS = 8000; // 8 second timeout
    let resolved = false;

    const sub = ndk.subscribe(
      [
        { kinds: [7], '#p': [userPubkey], since, until },
        { kinds: [9735], '#p': [userPubkey], since, until },
        { kinds: [1], '#p': [userPubkey], since, until },
        { kinds: [6], '#p': [userPubkey], since, until },
        { kinds: [16], '#p': [userPubkey], since, until }
      ],
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
    // Remove standalone bech32 identifiers (without nostr: prefix) — display layer only resolves nostr: URIs
    // Negative lookbehind prevents stripping bech32 inside nostr: URIs
    .replace(/(?<!nostr:)(?:note1|nevent1|naddr1|npub1|nprofile1)[023456789ac-hj-np-z]{20,}/gi, ' ')
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
      let zapAmount = 0;
      let zapSenderPubkey = event.pubkey; // fallback to zapper if we can't parse
      let zapComment = '';
      try {
        const descTag = event.tags.find((t) => t[0] === 'description')?.[1];
        if (descTag) {
          const zapRequest = JSON.parse(descTag);
          // The sender's pubkey is in the zap request
          if (zapRequest.pubkey) {
            zapSenderPubkey = zapRequest.pubkey;
          }
          // NIP-57: zap request content is an optional message from the sender
          if (zapRequest.content) {
            zapComment = cleanContentForPreview(zapRequest.content);
          }
          // Amount is in the zap request tags as 'amount' (in millisats)
          const amountTag = zapRequest.tags?.find((t: string[]) => t[0] === 'amount');
          if (amountTag && amountTag[1]) {
            zapAmount = Math.floor(parseInt(amountTag[1], 10) / 1000); // msats to sats
          }
        }
      } catch (e) {
        console.error('[Notifications] Error parsing zap:', e);
      }

      // Skip self-zaps (user zapping their own content or someone else)
      if (zapSenderPubkey === userPubkey) return null;

      // Fallback: extract amount from bolt11 using the decoder library
      if (zapAmount === 0) {
        try {
          const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')?.[1];
          if (bolt11Tag) {
            const decoded = decodeBolt11(bolt11Tag);
            const amountSection = decoded.sections.find(
              (s: { name: string; value?: unknown }) => s.name === 'amount'
            );
            if (amountSection?.value) {
              const decodedAmount = Number(amountSection.value);
              if (Number.isFinite(decodedAmount)) {
                zapAmount = Math.floor(decodedAmount);
              }
            }
          }
        } catch {
          // bolt11 decode failed — amount stays 0
        }
      }

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

    case 1: { // Reply or mention
      // NIP-10: Distinguish replies from mentions.
      // A reply has e tags with 'reply'/'root' markers or uses deprecated positional e tags.
      // A mention is a standalone post that p-tags the user but has no e tags (not in a thread).
      const eTags = event.tags.filter((t) => t[0] === 'e');
      const isReply = eTags.length > 0;

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
