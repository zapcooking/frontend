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
