import type { Notification } from './notificationStore';

export type NotificationDisplayItem =
  | { kind: 'single'; notification: Notification }
  | {
      kind: 'grouped-reactions';
      key: string;
      targetEventId: string;
      notifications: Notification[];
      latestTimestamp: number;
      read: boolean;
    }
  | {
      kind: 'grouped-zaps';
      key: string;
      targetEventId: string;
      notifications: Notification[];
      totalAmount: number;
      latestTimestamp: number;
      read: boolean;
    };

const SMALL_ZAP_THRESHOLD = 100;

export function buildDisplayItems(notifications: Notification[]): NotificationDisplayItem[] {
  const reactionGroups = new Map<string, Notification[]>();
  const smallZapGroups = new Map<string, Notification[]>();
  const singles: Notification[] = [];

  for (const n of notifications) {
    if (n.type === 'reaction' && n.eventId) {
      const group = reactionGroups.get(n.eventId);
      if (group) {
        group.push(n);
      } else {
        reactionGroups.set(n.eventId, [n]);
      }
    } else if (n.type === 'zap' && n.eventId && (n.amount || 0) < SMALL_ZAP_THRESHOLD) {
      const group = smallZapGroups.get(n.eventId);
      if (group) {
        group.push(n);
      } else {
        smallZapGroups.set(n.eventId, [n]);
      }
    } else {
      singles.push(n);
    }
  }

  const items: NotificationDisplayItem[] = [];

  // Flatten reaction groups — groups of 1 become singles
  for (const [eventId, group] of reactionGroups) {
    if (group.length === 1) {
      singles.push(group[0]);
    } else {
      items.push({
        kind: 'grouped-reactions',
        key: `reactions-${eventId}`,
        targetEventId: eventId,
        notifications: group.sort((a, b) => b.createdAt - a.createdAt),
        latestTimestamp: Math.max(...group.map((n) => n.createdAt)),
        read: group.every((n) => n.read)
      });
    }
  }

  // Flatten small zap groups — groups of 1 become singles
  for (const [eventId, group] of smallZapGroups) {
    if (group.length === 1) {
      singles.push(group[0]);
    } else {
      items.push({
        kind: 'grouped-zaps',
        key: `zaps-${eventId}`,
        targetEventId: eventId,
        notifications: group.sort((a, b) => b.createdAt - a.createdAt),
        totalAmount: group.reduce((sum, n) => sum + (n.amount || 0), 0),
        latestTimestamp: Math.max(...group.map((n) => n.createdAt)),
        read: group.every((n) => n.read)
      });
    }
  }

  // Add singles
  for (const n of singles) {
    items.push({ kind: 'single', notification: n });
  }

  // Sort by effective timestamp descending
  items.sort((a, b) => {
    const tsA = a.kind === 'single' ? a.notification.createdAt : a.latestTimestamp;
    const tsB = b.kind === 'single' ? b.notification.createdAt : b.latestTimestamp;
    return tsB - tsA;
  });

  return items;
}
