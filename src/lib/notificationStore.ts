import { writable, derived, get } from 'svelte/store';
import type { NDK, NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';

export interface Notification {
  id: string;
  type: 'reaction' | 'zap' | 'comment' | 'mention' | 'repost';
  fromPubkey: string;
  eventId?: string;
  content?: string;
  amount?: number;  // For zaps, in sats
  emoji?: string;   // For reactions
  createdAt: number;
  read: boolean;
}

const STORAGE_KEY = 'zc_notifications_v2'; // Bumped to clear old cached notifications with raw nostr: URIs
const MAX_NOTIFICATIONS = 100;

// Load from localStorage
function loadNotifications(): Notification[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {}
  return [];
}

// Save to localStorage
function saveNotifications(notifications: Notification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
  } catch {}
}

// Create the store
function createNotificationStore() {
  const { subscribe, set, update } = writable<Notification[]>(loadNotifications());
  
  return {
    subscribe,
    
    add: (notification: Notification) => {
      update(notifications => {
        // Don't add duplicates
        if (notifications.some(n => n.id === notification.id)) {
          return notifications;
        }
        const updated = [notification, ...notifications].slice(0, MAX_NOTIFICATIONS);
        saveNotifications(updated);
        return updated;
      });
    },
    
    markAsRead: (id: string) => {
      update(notifications => {
        const updated = notifications.map(n => 
          n.id === id ? { ...n, read: true } : n
        );
        saveNotifications(updated);
        return updated;
      });
    },
    
    markAllAsRead: () => {
      update(notifications => {
        const updated = notifications.map(n => ({ ...n, read: true }));
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
      return Math.max(...notifications.map(n => n.createdAt));
    }
  };
}

export const notifications = createNotificationStore();

export const unreadCount = derived(notifications, $notifications => 
  $notifications.filter(n => !n.read).length
);

// Subscription manager
let activeSubscription: NDKSubscription | null = null;

export function subscribeToNotifications(ndk: NDK, userPubkey: string) {
  if (activeSubscription) {
    activeSubscription.stop();
  }
  
  const since = notifications.getLastTimestamp();
  
  console.log('[Notifications] Subscribing for:', userPubkey, 'since:', new Date(since * 1000));
  
  // Subscribe to reactions, zaps, replies, mentions, and reposts
  activeSubscription = ndk.subscribe([
    // Reactions to my posts
    { kinds: [7], '#p': [userPubkey], since },
    // Zaps to me
    { kinds: [9735], '#p': [userPubkey], since },
    // Replies and mentions
    { kinds: [1], '#p': [userPubkey], since },
    // Reposts of my posts
    { kinds: [6], '#p': [userPubkey], since }
  ], { closeOnEose: false });
  
  activeSubscription.on('event', (event: NDKEvent) => {
    // Ignore my own events
    if (event.pubkey === userPubkey) return;
    
    const notification = parseNotification(event, userPubkey);
    if (notification) {
      notifications.add(notification);
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
      const reactedEventId = event.tags.find(t => t[0] === 'e')?.[1];
      return {
        ...baseNotification,
        type: 'reaction',
        eventId: reactedEventId,
        emoji: event.content || '❤️'
      };
      
    case 9735: // Zap
      let amount = 0;
      try {
        const bolt11 = event.tags.find(t => t[0] === 'bolt11')?.[1];
        const descTag = event.tags.find(t => t[0] === 'description')?.[1];
        if (descTag) {
          const desc = JSON.parse(descTag);
          amount = Math.floor((desc.amount || 0) / 1000); // msats to sats
        }
      } catch {}
      const zappedEventId = event.tags.find(t => t[0] === 'e')?.[1];
      return {
        ...baseNotification,
        type: 'zap',
        eventId: zappedEventId,
        amount
      };
      
    case 1: // Reply or mention
      // Collect all 'e' tags to better distinguish replies from mentions.
      // NIP-10 uses a marker at index [3] ('root' | 'reply' | 'mention'),
      // but not all clients set this consistently. As a heuristic:
      // - if there is a 'reply' marker OR
      // - if there are multiple 'e' tags (typical root + reply),
      // then treat as a reply (comment); otherwise treat as a mention.
      const eTags = event.tags.filter(t => t[0] === 'e');
      const replyToEvent = eTags[0]?.[1];
      const hasReplyMarker = eTags.some(t => t[3] === 'reply');
      const hasMultipleETags = eTags.length > 1;
      const isMention = !replyToEvent || (!hasReplyMarker && !hasMultipleETags);
      return {
        ...baseNotification,
        type: isMention ? 'mention' : 'comment',
        eventId: replyToEvent,
        content: cleanContentForPreview(event.content || '')
      };
      
    case 6: // Repost
      const repostedEventId = event.tags.find(t => t[0] === 'e')?.[1];
      return {
        ...baseNotification,
        type: 'repost',
        eventId: repostedEventId
      };
      
    default:
      return null;
  }
}

