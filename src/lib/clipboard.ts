import { browser } from '$app/environment';
import { showToast } from '$lib/toast';

/**
 * Copy text and say so. Returns whether the write actually landed: a caller
 * that gates a step on a successful copy needs that answer — a rejected
 * clipboard write must not count as a saved key. "Copied" rather than "Link
 * copied": callers copy a pairing URI, an npub, and an nsec, and only one is
 * a link. manualHint names the way out when the clipboard refuses, and it
 * differs by screen (a key field you can select vs. a QR code with no text),
 * so the caller supplies it.
 */
export async function copyToClipboard(
  text: string,
  manualHint = 'select the text and copy it manually'
): Promise<boolean> {
  if (!browser) return false;
  try {
    await navigator.clipboard.writeText(text);
    showToast('success', 'Copied');
    return true;
  } catch {
    showToast('error', `Could not copy — ${manualHint}`);
    return false;
  }
}
