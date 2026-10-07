import type { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';

/**
 * Outbox-rule relay set for `event.publish(...)` — see
 * nip65Routing.outboxRelaySet. Loaded on first publish (it pulls in the
 * relay-list cache), so the many modules that publish lists don't load it
 * up front. `undefined` (NDK's default pool) if anything fails.
 */
export async function outboxRelaySet(
  event: NDKEvent,
  kind: 'list' | 'engagement'
): Promise<NDKRelaySet | undefined> {
  try {
    const m = await import('$lib/nip65Routing');
    return await m.outboxRelaySet(event, kind);
  } catch (e) {
    console.warn('[outboxPublish] using the pool:', e);
    return undefined;
  }
}
