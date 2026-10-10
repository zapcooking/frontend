/**
 * Fetch an event by id via REPOSTS of it (NIP-18 kind 6/16), whose
 * content embeds the full original event JSON.
 *
 * Year-old or thinly-relayed events are often gone from every pool relay
 * even though a repost of them is easy to find. The reconstructed event
 * carries the original id/kind/pubkey/tags, so thread walks, replies,
 * and commenting all work from it. Only an embed whose id matches the
 * requested one exactly is accepted — that's the same serialized JSON
 * the author signed.
 *
 * Bounded: on dead relays fetchEvents can sit silent past EOSE forever,
 * so the lookup returns null after `timeoutMs` rather than hanging the
 * caller in a loading state.
 */
import { NDKEvent, type NDK } from '@nostr-dev-kit/ndk';

export const REPOST_EMBED_TIMEOUT_MS = 8000;

export async function fetchEventViaRepostEmbed(
  ndk: NDK,
  eventId: string,
  timeoutMs = REPOST_EMBED_TIMEOUT_MS
): Promise<NDKEvent | null> {
  if (!ndk || !eventId) return null;
  try {
    const lookup = ndk.fetchEvents(
      { kinds: [6, 16], '#e': [eventId], limit: 20 },
      { closeOnEose: true, groupable: false }
    );
    const reposts = await Promise.race([
      lookup,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
    for (const repost of reposts ?? []) {
      try {
        const inner = JSON.parse(repost.content);
        if (inner?.id !== eventId) continue;
        return new NDKEvent(ndk, inner);
      } catch {
        // Truncated or foreign embed — try the next repost.
        continue;
      }
    }
  } catch {
    // Relay fetch failed — fall through to null.
  }
  return null;
}
