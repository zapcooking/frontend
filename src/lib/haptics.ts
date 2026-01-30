/**
 * Haptic feedback for success/confirm actions.
 * Uses navigator.vibrate (works on Android; no-op where unsupported, e.g. iOS Safari).
 * Avoids @capacitor/haptics so web dev/build never resolves Capacitor-only modules.
 */

import { browser } from '$app/environment';

export function hapticSuccess(): void {
	if (!browser) return;
	if ('vibrate' in navigator) {
		navigator.vibrate([40, 50, 40]);
	}
}
