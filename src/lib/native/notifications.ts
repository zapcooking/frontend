/**
 * Notifications Service (web)
 *
 * Thin wrapper around the browser Notification API for:
 * - Timer alerts
 * - Nostr notifications (zaps, replies, mentions, etc.) - immediate notifications
 *
 * The native Capacitor shell was retired; the native apps now live in their
 * own repositories. The exported surface is kept stable so callers
 * (timerStore, notificationStore, +layout) need no changes.
 *
 * NOTE: the web platform cannot schedule a future notification reliably.
 * scheduleTimerNotification() therefore returns false and the timer UI
 * handles alerting in the foreground.
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

// Track if we've already requested permissions on app launch (to avoid repeated prompts)
const PERMISSION_REQUESTED_KEY = 'zc_notification_permission_requested';

function hasNotificationApi(): boolean {
  return browser && typeof window !== 'undefined' && 'Notification' in window;
}

function toStatus(perm: NotificationPermission): PermissionStatus {
  if (perm === 'granted') return 'granted';
  if (perm === 'denied') return 'denied';
  return 'prompt';
}

/**
 * Check current notification permissions
 */
export async function checkNotificationPermissions(): Promise<PermissionStatus> {
  if (!hasNotificationApi()) return 'denied';
  return toStatus(Notification.permission);
}

/**
 * Request notification permissions
 */
export async function requestNotificationPermissions(): Promise<PermissionStatus> {
  if (!hasNotificationApi()) return 'denied';
  try {
    const result = await Notification.requestPermission();
    return toStatus(result);
  } catch (error) {
    console.error('[Notifications] Error requesting Notification permission:', error);
    return 'denied';
  }
}

/**
 * Ensure notification permissions are granted
 * Checks current status and requests if needed (only if status is 'prompt')
 *
 * IMPORTANT: This function will NOT re-prompt if permissions were previously denied.
 * It only requests when the status is 'prompt' (user hasn't been asked yet).
 *
 * @param skipIfAlreadyRequested - If true, skip request if we've already asked before (for app launch)
 * @returns 'granted' if permissions are granted, 'denied' otherwise
 */
export async function ensureNotificationPermission(
  skipIfAlreadyRequested = false
): Promise<'granted' | 'denied'> {
  const current = await checkNotificationPermissions();

  if (current === 'granted') return 'granted';
  if (current === 'denied') return 'denied';

  if (skipIfAlreadyRequested && browser) {
    const alreadyRequested = localStorage.getItem(PERMISSION_REQUESTED_KEY) === 'true';
    if (alreadyRequested) return 'denied';
  }

  const result = await requestNotificationPermissions();

  if (browser && skipIfAlreadyRequested) {
    localStorage.setItem(PERMISSION_REQUESTED_KEY, 'true');
  }

  return result === 'granted' ? 'granted' : 'denied';
}

/**
 * Request notification permissions on app launch (first time only)
 * This is for general app notifications (zaps, replies, etc.)
 *
 * NOTE: Timer notifications have their own permission flow (requested when starting a timer)
 */
export async function requestPermissionsOnAppLaunch(): Promise<PermissionStatus> {
  if (!browser) return 'denied';

  const alreadyRequested = localStorage.getItem(PERMISSION_REQUESTED_KEY) === 'true';
  if (alreadyRequested) {
    return checkNotificationPermissions();
  }

  const current = await checkNotificationPermissions();
  if (current === 'granted' || current === 'denied') {
    localStorage.setItem(PERMISSION_REQUESTED_KEY, 'true');
    return current;
  }

  const result = await requestNotificationPermissions();
  localStorage.setItem(PERMISSION_REQUESTED_KEY, 'true');
  return result;
}

/**
 * @deprecated Use ensureNotificationPermission() instead
 * Legacy function name for backwards compatibility
 */
export async function ensureNotifPerms(): Promise<boolean> {
  const result = await ensureNotificationPermission();
  return result === 'granted';
}

/**
 * Schedule a local notification for a timer.
 * The web platform cannot schedule future notifications reliably, so this is
 * a no-op that returns false; the timer UI alerts in the foreground instead.
 */
export async function scheduleTimerNotification(_options: NotificationOptions): Promise<boolean> {
  return false;
}

/**
 * Cancel a scheduled notification by ID (nothing to cancel on web)
 */
export async function cancelTimerNotification(_id: number): Promise<boolean> {
  return true;
}

/**
 * Cancel multiple scheduled notifications (nothing to cancel on web)
 */
export async function cancelMultipleNotifications(_ids: number[]): Promise<boolean> {
  return true;
}

/**
 * Get all pending (scheduled) notifications (none on web)
 */
export async function getPendingNotifications(): Promise<number[]> {
  return [];
}

/**
 * Debug function to test notification permissions
 * Call this from the browser console: window.testNotificationPermissions()
 *
 * Options:
 * - window.testNotificationPermissions() - just test
 * - window.testNotificationPermissions(true) - clear localStorage and test
 */
export async function debugNotificationPermissions(clearStorage = false): Promise<void> {
  console.log('=== NOTIFICATION PERMISSIONS DEBUG ===');
  if (!browser) {
    console.log('Not in browser environment');
    return;
  }
  if (clearStorage) {
    localStorage.removeItem(PERMISSION_REQUESTED_KEY);
    console.log('Cleared localStorage PERMISSION_REQUESTED_KEY');
  }
  if (hasNotificationApi()) {
    console.log('Notification.permission:', Notification.permission);
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      console.log('requestPermission() result:', result);
    }
  } else {
    console.log('Notification API not available');
  }
  console.log('localStorage PERMISSION_REQUESTED_KEY:', localStorage.getItem(PERMISSION_REQUESTED_KEY));
  console.log('=== END DEBUG ===');
}

// Expose debug function to window for console access
if (browser && typeof window !== 'undefined') {
  (window as any).testNotificationPermissions = debugNotificationPermissions;
  (window as any).debugNotificationPermissions = debugNotificationPermissions;
}

/**
 * Send an immediate notification (for Nostr notifications like zaps, replies, etc.)
 *
 * @param title - Notification title
 * @param body - Notification body text
 * @param _extra - Accepted for API compatibility; the web Notification API has no extra payload
 * @returns true if notification was sent successfully
 */
export async function sendImmediateNotification(
  title: string,
  body: string,
  _extra?: Record<string, any>
): Promise<boolean> {
  if (!hasNotificationApi() || Notification.permission !== 'granted') return false;
  try {
    new Notification(title, { body });
    return true;
  } catch (error) {
    console.error('[Notifications] Error sending web notification:', error);
    return false;
  }
}
