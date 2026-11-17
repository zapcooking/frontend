/**
 * Relay sets for the streaming feature.
 *
 * Discovery keeps to a small cocktail the app's own relays plus one
 * live-stream specialist; receipt scans and the archive second pass use
 * relays chosen for zap coverage, matching Sidecar's lists.
 */

/** Stream announcement discovery (NIP-53 kind 30311). */
export const DISCOVERY_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

/** Zap receipt coverage for verified stream totals (kind 9735 scans). */
export const RECEIPT_RELAYS = [
  'wss://purplepag.es',
  'wss://nostr.wine',
  'wss://relay.snort.social'
];

/**
 * The one receipt relay list for Go live zap totals: the stream chat's
 * live total (StreamChat) and the metrics recorder
 * (src/lib/live/metrics.server.ts) both read receipts from exactly these,
 * so the two totals see the same receipts. The chat adds the stream's own
 * relays and the signed-in user's relay list on top.
 */
export const STREAM_RECEIPT_RELAYS: readonly string[] = Object.freeze([
  ...new Set([...DISCOVERY_RELAYS, ...RECEIPT_RELAYS, 'wss://offchain.pub'])
]);

/**
 * Where Go live chat is written and read: the same shared list, so a
 * stream's chat, its zap receipts and (later) its announcement's `relays`
 * tag all name the same relays. A session lists no relays of its own.
 */
export function goLiveChatRelays(): string[] {
  return [...STREAM_RECEIPT_RELAYS];
}

/** The chat's starting receipt set: the stream's own relays, then the shared list. */
export function chatReceiptRelays(itemRelays: readonly string[] = []): string[] {
  return [...new Set([...itemRelays, ...STREAM_RECEIPT_RELAYS])];
}

/**
 * Relays that archive many zap receipts, scanned in a second pass once the
 * stream is already playing so the first paint never waits on them.
 */
export const ZAP_ARCHIVE_RELAYS = [
  'wss://nostr21.com',
  'wss://relay.ditto.pub',
  'wss://nostr-01.yakihonne.com',
  'wss://relay.nostr.net',
  'wss://soloco.nl'
];
