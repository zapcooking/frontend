/**
 * Local Notifications Service for Capacitor
 * 
 * This module provides local notification support for:
 * - Timer alerts (scheduled notifications)
 * - Nostr notifications (zaps, replies, mentions, etc.) - immediate notifications
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

// Track if we've already requested permissions on app launch (to avoid repeated prompts)
const PERMISSION_REQUESTED_KEY = 'zc_notification_permission_requested';

/**
 * Check if we're running on a native platform (iOS/Android)
 * Tries multiple methods to detect Capacitor availability
 */
async function isNativePlatform(): Promise<boolean> {
  if (!browser) {
    console.log('[Notifications] isNativePlatform: Not in browser');
    return false;
  }
  
  // First, try to access Capacitor from window (it might be available globally)
  if (typeof window !== 'undefined') {
    const windowCapacitor = (window as any).Capacitor;
    if (windowCapacitor && typeof windowCapacitor.isNativePlatform === 'function') {
      const isNative = windowCapacitor.isNativePlatform();
      const platform = windowCapacitor.getPlatform();
      console.log('[Notifications] isNativePlatform: Found on window, platform =', platform, ', isNative =', isNative);
      return isNative;
    }
  }
  
  // Fallback to dynamic import
  try {
    const { Capacitor } = await import('@capacitor/core');
    const isNative = Capacitor.isNativePlatform();
    const platform = Capacitor.getPlatform();
    console.log('[Notifications] isNativePlatform: Imported successfully, platform =', platform, ', isNative =', isNative);
    return isNative;
  } catch (error) {
    console.error('[Notifications] isNativePlatform: Error importing Capacitor:', error);
    // If import fails, check if we're in a Capacitor environment by checking user agent or other indicators
    if (typeof window !== 'undefined') {
      const ua = window.navigator?.userAgent || '';
      const isCapacitorUA = ua.includes('Capacitor') || ua.includes('capacitor://');
      console.log('[Notifications] isNativePlatform: Fallback check, userAgent suggests Capacitor:', isCapacitorUA);
      return isCapacitorUA;
    }
    return false;
  }
}

/**
 * Get the LocalNotifications plugin instance
 */
async function getLocalNotifications() {
  // Try window first (might be available globally)
  if (typeof window !== 'undefined') {
    const windowLocalNotifications = (window as any).LocalNotifications;
    if (windowLocalNotifications) {
      console.log('[Notifications] Found LocalNotifications on window');
      return windowLocalNotifications;
    }
  }
  
  // Fallback to dynamic import
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  return LocalNotifications;
}

/**
 * Check current notification permissions
 */
export async function checkNotificationPermissions(): Promise<PermissionStatus> {
  if (!browser) {
    console.log('[Notifications] checkNotificationPermissions: Not in browser');
    return 'denied';
  }
  
  const isNative = await isNativePlatform();
  console.log('[Notifications] checkNotificationPermissions: isNativePlatform =', isNative);
  
  if (!isNative) {
    // On web, check the Notification API
    if ('Notification' in window) {
      const perm = Notification.permission;
      console.log('[Notifications] Web Notification.permission =', perm);
      if (perm === 'granted') return 'granted';
      if (perm === 'denied') return 'denied';
      return 'prompt';
    }
    console.log('[Notifications] Notification API not available in window');
    return 'denied';
  }
  
  try {
    const LocalNotifications = await getLocalNotifications();
    console.log('[Notifications] Checking permissions via LocalNotifications plugin...');
    const result = await LocalNotifications.checkPermissions();
    console.log('[Notifications] LocalNotifications.checkPermissions result:', result);
    
    if (result.display === 'granted') return 'granted';
    if (result.display === 'denied') return 'denied';
    return 'prompt';
  } catch (error) {
    console.error('[Notifications] Error checking permissions:', error);
    // If we're in a Capacitor environment (detected by user agent) but plugin fails,
    // assume we need to request permissions
    if (typeof window !== 'undefined') {
      const ua = window.navigator?.userAgent || '';
      if (ua.includes('Capacitor') || ua.includes('capacitor://')) {
        console.log('[Notifications] Capacitor detected via UA but plugin failed, assuming prompt');
        return 'prompt';
      }
    }
    return 'denied';
  }
}

/**
 * Request notification permissions
 */
export async function requestNotificationPermissions(): Promise<PermissionStatus> {
  console.log('[Notifications] requestNotificationPermissions called');
  
  if (!browser) {
    console.log('[Notifications] Not in browser, returning denied');
    return 'denied';
  }
  
  const isNative = await isNativePlatform();
  console.log('[Notifications] isNativePlatform =', isNative);
  
  if (!isNative) {
    // On web, use the Notification API
    if ('Notification' in window) {
      try {
        console.log('[Notifications] Requesting web Notification permission...');
        const result = await Notification.requestPermission();
        console.log('[Notifications] Web Notification.requestPermission result:', result);
        if (result === 'granted') return 'granted';
        if (result === 'denied') return 'denied';
        return 'prompt';
      } catch (error) {
        console.error('[Notifications] Error requesting web Notification permission:', error);
        return 'denied';
      }
    }
    console.log('[Notifications] Notification API not available');
    return 'denied';
  }
  
  try {
    const LocalNotifications = await getLocalNotifications();
    console.log('[Notifications] Requesting permissions via LocalNotifications plugin...');
    const result = await LocalNotifications.requestPermissions();
    console.log('[Notifications] LocalNotifications.requestPermissions result:', result);
    
    if (result.display === 'granted') return 'granted';
    if (result.display === 'denied') return 'denied';
    return 'prompt';
  } catch (error) {
    console.error('[Notifications] Error requesting permissions:', error);
    console.error('[Notifications] Error details:', error);
    // If we're in a Capacitor environment but plugin fails, log the error but don't assume denied
    // The error might be that the plugin isn't properly registered
    if (typeof window !== 'undefined') {
      const ua = window.navigator?.userAgent || '';
      if (ua.includes('Capacitor') || ua.includes('capacitor://')) {
        console.error('[Notifications] Capacitor detected but LocalNotifications plugin failed to load. Make sure plugin is synced: npx cap sync');
      }
    }
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
  console.log('[Notifications] ensureNotificationPermission called, skipIfAlreadyRequested =', skipIfAlreadyRequested);
  
  const current = await checkNotificationPermissions();
  console.log('[Notifications] Current permission status:', current);
  
  // If already granted, return immediately
  if (current === 'granted') {
    console.log('[Notifications] Already granted, returning granted');
    return 'granted';
  }
  
  // If already denied, do NOT re-prompt (Apple App Review requirement)
  if (current === 'denied') {
    console.log('[Notifications] Already denied, returning denied (no re-prompt)');
    return 'denied';
  }
  
  // If skipIfAlreadyRequested is true, check if we've already requested
  if (skipIfAlreadyRequested && browser) {
    const alreadyRequested = localStorage.getItem(PERMISSION_REQUESTED_KEY) === 'true';
    if (alreadyRequested) {
      console.log('[Notifications] Already requested permissions before, skipping');
      return 'denied';
    }
  }
  
  // Permission status is 'prompt', so request (first time only)
  console.log('[Notifications] Status is prompt, requesting permissions...');
  const result = await requestNotificationPermissions();
  console.log('[Notifications] Request result:', result);
  
  // Mark that we've requested permissions
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
  console.log('[Notifications] requestPermissionsOnAppLaunch called');
  
  if (!browser) {
    console.log('[Notifications] Not in browser, returning denied');
    return 'denied';
  }
  
  // Check if we've already requested
  const alreadyRequested = localStorage.getItem(PERMISSION_REQUESTED_KEY) === 'true';
  console.log('[Notifications] Already requested?', alreadyRequested);
  
  if (alreadyRequested) {
    // Just check current status, don't re-prompt
    const status = await checkNotificationPermissions();
    console.log('[Notifications] Already requested, current status:', status);
    return status;
  }
  
  // Check current status
  const current = await checkNotificationPermissions();
  console.log('[Notifications] Current permission status:', current);
  
  // If already granted or denied, mark as requested and return
  if (current === 'granted' || current === 'denied') {
    console.log('[Notifications] Status is', current, '- marking as requested and returning');
    localStorage.setItem(PERMISSION_REQUESTED_KEY, 'true');
    return current;
  }
  
  // Status is 'prompt', so request permissions
  console.log('[Notifications] Status is prompt, requesting permissions...');
  const result = await requestNotificationPermissions();
  console.log('[Notifications] Permission request result:', result);
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
  console.log('Browser:', browser);
  
  if (clearStorage && browser) {
    localStorage.removeItem(PERMISSION_REQUESTED_KEY);
    console.log('Cleared localStorage PERMISSION_REQUESTED_KEY');
  }
  
  if (!browser) {
    console.log('Not in browser environment');
    return;
  }
  
  // Check window.Capacitor first
  if (typeof window !== 'undefined') {
    const windowCapacitor = (window as any).Capacitor;
    console.log('window.Capacitor exists:', !!windowCapacitor);
    if (windowCapacitor) {
      console.log('window.Capacitor.getPlatform():', windowCapacitor.getPlatform?.());
      console.log('window.Capacitor.isNativePlatform():', windowCapacitor.isNativePlatform?.());
    }
  }
  
  try {
    const { Capacitor } = await import('@capacitor/core');
    console.log('Capacitor imported successfully');
    console.log('Platform:', Capacitor.getPlatform());
    console.log('Is native:', Capacitor.isNativePlatform());
  } catch (error) {
    console.error('Error importing Capacitor:', error);
  }
  
  const isNative = await isNativePlatform();
  console.log('isNativePlatform() result:', isNative);
  
  if (isNative) {
    try {
      const LocalNotifications = await getLocalNotifications();
      console.log('LocalNotifications plugin loaded successfully');
      
      const checkResult = await LocalNotifications.checkPermissions();
      console.log('checkPermissions() result:', checkResult);
      
      console.log('Attempting to request permissions...');
      const requestResult = await LocalNotifications.requestPermissions();
      console.log('requestPermissions() result:', requestResult);
    } catch (error) {
      console.error('Error with LocalNotifications plugin:', error);
      console.error('Error details:', error);
    }
  } else {
    if ('Notification' in window) {
      console.log('Using web Notification API');
      console.log('Notification.permission:', Notification.permission);
      if (Notification.permission === 'default') {
        console.log('Requesting permission...');
        const result = await Notification.requestPermission();
        console.log('requestPermission() result:', result);
      }
    } else {
      console.log('Notification API not available');
    }
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
 * Send an immediate local notification (for Nostr notifications like zaps, replies, etc.)
 * This notification fires immediately, not at a scheduled time.
 * 
 * @param title - Notification title
 * @param body - Notification body text
 * @param extra - Optional extra data to attach to the notification
 * @returns true if notification was sent successfully
 */
export async function sendImmediateNotification(
  title: string,
  body: string,
  extra?: Record<string, any>
): Promise<boolean> {
  if (!browser) return false;
  
  const isNative = await isNativePlatform();
  if (!isNative) {
    // On web, try to use the Notification API if available
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body });
        return true;
      } catch (error) {
        console.error('[Notifications] Error sending web notification:', error);
        return false;
      }
    }
    return false;
  }
  
  // Check permissions first
  const permission = await checkNotificationPermissions();
  if (permission !== 'granted') {
    console.log('[Notifications] Permission not granted, skipping notification');
    return false;
  }
  
  try {
    const LocalNotifications = await getLocalNotifications();
    
    // Generate a unique ID based on timestamp and random number
    // Use negative IDs for immediate notifications to avoid conflicts with timer IDs (positive)
    const id = -(Date.now() % 2147483647); // Use negative timestamp as ID
    
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          sound: 'default',
          extra: extra || {},
        },
      ],
    });
    
    console.log('[Notifications] Sent immediate notification:', title);
    return true;
  } catch (error) {
    console.error('[Notifications] Error sending immediate notification:', error);
    return false;
  }
}
