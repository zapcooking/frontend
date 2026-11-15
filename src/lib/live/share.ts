/**
 * Sharing a live stream: which share path a device gets, and the text a
 * "Share on Nostr" post starts with. Pure, for tests.
 *
 *   phone    the native share sheet (navigator.share), when the device has
 *            one and a touch-first pointer
 *   desktop  a small menu: Copy link, Share on Nostr (the post composer
 *            opens with the text below; the link shows its preview card)
 */

export interface ShareEnvironment {
  /** navigator.share exists. */
  hasNativeShare: boolean;
  /** `(pointer: coarse)` matches: a touch-first device. */
  coarsePointer: boolean;
}

/**
 * Phones get the native sheet. Desktop browsers that also have
 * navigator.share (Safari, Chrome on macOS/Windows) get the menu instead,
 * so Copy link and Share on Nostr are one click away.
 */
export function prefersNativeShare(env: ShareEnvironment): boolean {
  return env.hasNativeShare && env.coarsePointer;
}

/** The text a "Share on Nostr" post starts with. */
export function liveShareText(title: string, url: string): string {
  const name = title.trim() || 'a live cook-along';
  return `🔴 Live on Zap Cooking: ${name}\n${url}`;
}

/**
 * Put share text into the composer without losing an unsent draft: a
 * draft keeps its text and gets the share text after a blank line.
 */
export function appendPrefill(existing: string, prefill: string): string {
  const draft = existing.replace(/\s+$/, '');
  return draft ? `${draft}\n\n${prefill}` : prefill;
}
