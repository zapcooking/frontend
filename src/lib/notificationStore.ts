import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { NDK, NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import { hellthreadThreshold } from '$lib/hellthreadFilterSettings';

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

export const unreadCount = derived(
  notifications,
  ($notifications) => $notifications.filter((n) => !n.read).length
);

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
      // Reactions to my posts
      { kinds: [7], '#p': [userPubkey], since },
      // Zaps to me
      { kinds: [9735], '#p': [userPubkey], since },
      // Replies and mentions
      { kinds: [1], '#p': [userPubkey], since },
      // Reposts of my posts
      { kinds: [6], '#p': [userPubkey], since }
    ],
    { closeOnEose: false }
  );

  activeSubscription.on('event', async (event: NDKEvent) => {
    // Debug: log all incoming notification events
    console.log(`[Notifications] Received event kind ${event.kind}:`, {
      id: event.id?.slice(0, 8),
      pubkey: event.pubkey?.slice(0, 8),
      tags: event.tags?.slice(0, 5)
    });

    // For zap receipts (9735), the pubkey is the zapper service, not the sender
    // So we should NOT filter these out based on pubkey
    if (event.kind !== 9735 && event.pubkey === userPubkey) {
      console.log('[Notifications] Ignoring own event (not a zap)');
      return;
    }

    // Filter out hellthreads (events with excessive p tags)
    if (isHellthread(event)) {
      console.log('[Notifications] Ignoring hellthread event');
      return;
    }

    const notification = parseNotification(event, userPubkey);
    if (notification) {
      console.log(`[Notifications] Parsed ${notification.type} notification:`, {
        id: notification.id?.slice(0, 8),
        from: notification.fromPubkey?.slice(0, 8),
        amount: notification.amount
      });

      // Add to store
      notifications.add(notification);

      // Send local notification if app is backgrounded and permissions are granted
      if (browser) {
        try {
          await sendLocalNotificationForNostrEvent(notification);
        } catch (error) {
          console.error('[Notifications] Error sending local notification:', error);
        }
      }
    } else {
      console.log('[Notifications] Failed to parse notification for kind', event.kind);
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
        { kinds: [6], '#p': [userPubkey], since, until }
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
  }

  // Add all new notifications in bulk (returns actual count added)
  return notifications.addBulk(newNotifications);
}

/**
 * Check if an event is a hellthread based on number of 'p' tags
 */
function isHellthread(event: NDKEvent): boolean {
  const threshold = get(hellthreadThreshold);
  if (threshold === 0) return false; // Disabled

  if (!event.tags || !Array.isArray(event.tags)) return false;

  const mentionCount = event.tags.filter((tag) => Array.isArray(tag) && tag[0] === 'p').length;
  return mentionCount >= threshold;
}

// Clean up content for preview by removing nostr: URIs and cleaning text
function cleanContentForPreview(content: string): string {
  if (!content) return '';

  let cleaned = content
    // Remove all nostr: URIs entirely (they don't add value in preview)
    .replace(/nostr:[a-z0-9]+/gi, '')
    // Also catch any standalone bech32 identifiers
    .replace(/\b(npub1|note1|nevent1|naddr1|nprofile1)[a-z0-9]+\b/gi, '')
    // Clean up multiple spaces and newlines
    .replace(/\s+/g, ' ')
    .trim();

  // If the cleaned content is too short or just punctuation, return empty
  if (cleaned.length < 3 || /^[\s\p{P}]*$/u.test(cleaned)) {
    return '';
  }

  return cleaned.slice(0, 100);
}

function parseNotification(event: NDKEvent, userPubkey: string): Notification | null {
  const baseNotification = {
    id: event.id,
    fromPubkey: event.pubkey,
    createdAt: event.created_at || Math.floor(Date.now() / 1000),
    read: false
  };

  switch (event.kind) {
    case 7: // Reaction
      const reactedEventId = event.tags.find((t) => t[0] === 'e')?.[1];
      return {
        ...baseNotification,
        type: 'reaction',
        eventId: reactedEventId,
        emoji: event.content || '❤️'
      };

    case 9735: // Zap receipt
      // The zap receipt is published by the zapper service (e.g., Alby)
      // The actual sender info is in the embedded zap request in the 'description' tag
      let zapAmount = 0;
      let zapSenderPubkey = event.pubkey; // fallback to zapper if we can't parse
      try {
        const descTag = event.tags.find((t) => t[0] === 'description')?.[1];
        if (descTag) {
          const zapRequest = JSON.parse(descTag);
          // The sender's pubkey is in the zap request
          if (zapRequest.pubkey) {
            zapSenderPubkey = zapRequest.pubkey;
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

      // Also try to get amount from bolt11 if we didn't get it from description
      if (zapAmount === 0) {
        try {
          const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11')?.[1];
          if (bolt11Tag) {
            // Parse amount from bolt11 - look for the amount prefix (e.g., lnbc100n, lnbc1000u, lnbc1m)
            const amountMatch = bolt11Tag.match(/lnbc(\d+)([munp]?)/i);
            if (amountMatch) {
              const num = parseInt(amountMatch[1], 10);
              const unit = amountMatch[2]?.toLowerCase() || '';
              // Convert to sats based on unit
              if (unit === 'm')
                zapAmount = num * 100000; // milli-bitcoin = 100,000 sats
              else if (unit === 'u')
                zapAmount = num * 100; // micro-bitcoin = 100 sats
              else if (unit === 'n')
                zapAmount = Math.floor(num / 10); // nano-bitcoin = 0.1 sats
              else if (unit === 'p')
                zapAmount = Math.floor(num / 10000); // pico-bitcoin
              else zapAmount = num; // assume sats if no unit
            }
          }
        } catch {}
      }

      const zappedEventId = event.tags.find((t) => t[0] === 'e')?.[1];
      return {
        ...baseNotification,
        fromPubkey: zapSenderPubkey,
        type: 'zap',
        eventId: zappedEventId,
        amount: zapAmount
      };

    case 1: // Reply or mention
      // Distinguish between replies and mentions:
      // - Reply: Someone is replying to a post (has 'e' tags indicating it's a reply)
      // - Mention: Someone tagged you in a standalone post (no 'e' tags)
      const eTags = event.tags.filter((t) => t[0] === 'e');

      // Check if this is a reply to something (has any e tags)
      const isReply = eTags.length > 0;

      // Get the event being replied to (prefer 'reply' marker, then 'root', then first e tag)
      let replyToEvent: string | undefined;
      const replyMarkerTag = eTags.find((t) => t[3] === 'reply');
      const rootMarkerTag = eTags.find((t) => t[3] === 'root');
      if (replyMarkerTag) {
        replyToEvent = replyMarkerTag[1];
      } else if (rootMarkerTag) {
        replyToEvent = rootMarkerTag[1];
      } else if (eTags.length > 0) {
        // No markers - use last e tag (NIP-10 deprecated positional)
        replyToEvent = eTags[eTags.length - 1][1];
      }

      // For both mentions and replies, clicking should show the note that mentions/replies
      // (the notification event itself), not just the post being replied to
      return {
        ...baseNotification,
        type: isReply ? 'comment' : 'mention',
        eventId: event.id, // The note to view (the mention/reply itself)
        targetEventId: replyToEvent, // The original post being replied to (if any)
        content: cleanContentForPreview(event.content || '')
      };

    case 6: // Repost
      const repostedEventId = event.tags.find((t) => t[0] === 'e')?.[1];
      return {
        ...baseNotification,
        type: 'repost',
        eventId: repostedEventId
      };

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
