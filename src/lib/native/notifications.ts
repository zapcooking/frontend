/**
 * Local Notifications Service for Capacitor
 * 
 * This module provides local notification support for timer alerts.
 * 
 * WHY NOTIFICATIONS INSTEAD OF BACKGROUND JS TIMERS:
 * - JavaScript timers (setInterval/setTimeout) are unreliable when the app is backgrounded
 * - iOS and Android suspend JS execution to save battery when apps aren't in foreground
 * - Local notifications are scheduled with the OS and fire reliably even when app is suspended
 * - This ensures timer alerts work correctly whether the user is actively using the app or not
 */

import { browser } from '$app/environment';

// Types
export interface NotificationOptions {
  id: number;
  title: string;
  body: string;
  fireAt: Date;
}

export type PermissionStatus = 'granted' | 'denied' | 'prompt';

/**
 * Check if we're running on a native platform (iOS/Android)
 */
async function isNativePlatform(): Promise<boolean> {
  if (!browser) return false;
  
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Get the LocalNotifications plugin instance
 */
async function getLocalNotifications() {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  return LocalNotifications;
}

/**
 * Check current notification permissions
 */
export async function checkNotificationPermissions(): Promise<PermissionStatus> {
  if (!browser) return 'denied';
  
  const isNative = await isNativePlatform();
  if (!isNative) {
    // On web, check the Notification API
    if ('Notification' in window) {
      const perm = Notification.permission;
      if (perm === 'granted') return 'granted';
      if (perm === 'denied') return 'denied';
      return 'prompt';
    }
    return 'denied';
  }
  
  try {
    const LocalNotifications = await getLocalNotifications();
    const result = await LocalNotifications.checkPermissions();
    
    if (result.display === 'granted') return 'granted';
    if (result.display === 'denied') return 'denied';
    return 'prompt';
  } catch (error) {
    console.error('[Notifications] Error checking permissions:', error);
    return 'denied';
  }
}

/**
 * Request notification permissions
 */
export async function requestNotificationPermissions(): Promise<PermissionStatus> {
  if (!browser) return 'denied';
  
  const isNative = await isNativePlatform();
  if (!isNative) {
    // On web, use the Notification API
    if ('Notification' in window) {
      try {
        const result = await Notification.requestPermission();
        if (result === 'granted') return 'granted';
        if (result === 'denied') return 'denied';
        return 'prompt';
      } catch {
        return 'denied';
      }
    }
    return 'denied';
  }
  
  try {
    const LocalNotifications = await getLocalNotifications();
    const result = await LocalNotifications.requestPermissions();
    
    if (result.display === 'granted') return 'granted';
    if (result.display === 'denied') return 'denied';
    return 'prompt';
  } catch (error) {
    console.error('[Notifications] Error requesting permissions:', error);
    return 'denied';
  }
}

/**
 * Ensure notification permissions are granted
 * Checks current status and requests if needed
 * @returns true if permissions are granted
 */
export async function ensureNotifPerms(): Promise<boolean> {
  const current = await checkNotificationPermissions();
  
  if (current === 'granted') return true;
  if (current === 'denied') return false;
  
  // Permission status is 'prompt', so request
  const result = await requestNotificationPermissions();
  return result === 'granted';
}

/**
 * Schedule a local notification for a timer
 */
export async function scheduleTimerNotification(options: NotificationOptions): Promise<boolean> {
  if (!browser) return false;
  
  const isNative = await isNativePlatform();
  
  if (!isNative) {
    // On web, we can't schedule future notifications reliably
    // Just log and return - the UI will handle alerting when foregrounded
    console.log('[Notifications] Web platform - notification will only work in foreground');
    return false;
  }
  
  try {
    const LocalNotifications = await getLocalNotifications();
    
    await LocalNotifications.schedule({
      notifications: [
        {
          id: options.id,
          title: options.title,
          body: options.body,
          schedule: {
            at: options.fireAt,
            allowWhileIdle: true,
          },
          sound: 'default',
          // iOS-specific options for better UX
          actionTypeId: '',
          extra: {
            timerId: options.id,
          },
        },
      ],
    });
    
    console.log('[Notifications] Scheduled notification:', options.id, 'for', options.fireAt);
    return true;
  } catch (error) {
    console.error('[Notifications] Error scheduling notification:', error);
    return false;
  }
}

/**
 * Cancel a scheduled notification by ID
 */
export async function cancelTimerNotification(id: number): Promise<boolean> {
  if (!browser) return false;
  
  const isNative = await isNativePlatform();
  if (!isNative) return true; // Nothing to cancel on web
  
  try {
    const LocalNotifications = await getLocalNotifications();
    
    await LocalNotifications.cancel({
      notifications: [{ id }],
    });
    
    console.log('[Notifications] Cancelled notification:', id);
    return true;
  } catch (error) {
    console.error('[Notifications] Error cancelling notification:', error);
    return false;
  }
}

/**
 * Cancel multiple scheduled notifications
 */
export async function cancelMultipleNotifications(ids: number[]): Promise<boolean> {
  if (!browser || ids.length === 0) return true;
  
  const isNative = await isNativePlatform();
  if (!isNative) return true;
  
  try {
    const LocalNotifications = await getLocalNotifications();
    
    await LocalNotifications.cancel({
      notifications: ids.map(id => ({ id })),
    });
    
    console.log('[Notifications] Cancelled notifications:', ids);
    return true;
  } catch (error) {
    console.error('[Notifications] Error cancelling notifications:', error);
    return false;
  }
}

/**
 * Get all pending (scheduled) notifications
 */
export async function getPendingNotifications(): Promise<number[]> {
  if (!browser) return [];
  
  const isNative = await isNativePlatform();
  if (!isNative) return [];
  
  try {
    const LocalNotifications = await getLocalNotifications();
    const pending = await LocalNotifications.getPending();
    return pending.notifications.map(n => n.id);
  } catch (error) {
    console.error('[Notifications] Error getting pending notifications:', error);
    return [];
  }
}
