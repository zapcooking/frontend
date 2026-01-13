/**
 * Platform detection utilities for handling platform-specific features.
 * 
 * Platforms:
 * - 'ios': iOS native app via Capacitor
 * - 'android': Android native app via Capacitor  
 * - 'web': Browser (desktop or mobile web)
 */

import { browser } from '$app/environment';
import { writable, derived, get } from 'svelte/store';

export type Platform = 'ios' | 'android' | 'web';

/**
 * Svelte store for the current platform.
 * This store is updated when the platform is detected (may be async for Capacitor).
 */
export const platform = writable<Platform>('web');

/**
 * Derived store: true if running on iOS
 */
export const platformIsIOS = derived(platform, ($platform) => $platform === 'ios');

/**
 * Derived store: true if running on Android
 */
export const platformIsAndroid = derived(platform, ($platform) => $platform === 'android');

/**
 * Derived store: true if running in a native app (iOS or Android)
 */
export const platformIsNative = derived(platform, ($platform) => $platform === 'ios' || $platform === 'android');

/**
 * Derived store: true if running in web browser
 */
export const platformIsWeb = derived(platform, ($platform) => $platform === 'web');

/**
 * Detect and set the current platform.
 * This should be called on app initialization (e.g., in onMount of root layout).
 */
export function detectPlatform(): Platform {
  if (!browser) {
    return 'web';
  }

  let detectedPlatform: Platform = 'web';

  try {
    const capacitor = (window as any).Capacitor;
    if (capacitor?.isNativePlatform?.()) {
      const p = capacitor.getPlatform?.();
      if (p === 'ios') {
        detectedPlatform = 'ios';
      } else if (p === 'android') {
        detectedPlatform = 'android';
      }
    }
  } catch (e) {
    // Capacitor not available
  }

  // Update the store
  platform.set(detectedPlatform);
  
  console.log('[Platform] Detected platform:', detectedPlatform);
  
  return detectedPlatform;
}

/**
 * Get the current platform synchronously.
 * Note: Prefer using the `platform` store for reactive updates.
 * Returns 'ios', 'android', or 'web'.
 */
export function getPlatform(): Platform {
  return get(platform);
}

/**
 * Check if running on iOS native app.
 * Note: Prefer using the `platformIsIOS` store for reactive updates.
 */
export function isIOS(): boolean {
  return get(platform) === 'ios';
}

/**
 * Check if running on Android native app.
 * Note: Prefer using the `platformIsAndroid` store for reactive updates.
 */
export function isAndroid(): boolean {
  return get(platform) === 'android';
}

/**
 * Check if running in a native app (iOS or Android).
 * Note: Prefer using the `platformIsNative` store for reactive updates.
 */
export function isNative(): boolean {
  const p = get(platform);
  return p === 'ios' || p === 'android';
}

/**
 * Check if running in web browser (not native app).
 * Note: Prefer using the `platformIsWeb` store for reactive updates.
 */
export function isWeb(): boolean {
  return get(platform) === 'web';
}

/**
 * Check if NIP-07 browser extension signing is supported.
 * NIP-07 is only supported on web browsers, not on iOS or Android native apps.
 */
export function supportsNIP07(): boolean {
  // NIP-07 requires browser extensions which are not available on mobile native apps
  return isWeb();
}

/**
 * Check if NIP-46 remote signing is supported.
 * For iOS, we disable NIP-46 due to app store restrictions on cross-app communication.
 * NIP-46 is supported on web and Android.
 */
export function supportsNIP46(): boolean {
  // iOS does not support NIP-46 due to app store restrictions
  // Web and Android support NIP-46
  return !isIOS();
}

// Auto-detect platform on module load (client-side only)
if (browser) {
  detectPlatform();
}
