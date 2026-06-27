/**
 * Delete a corrupted Spark wallet backup from Nostr relays.
 *
 * Usage:
 *   node scripts/delete-spark-backup.mjs <nsec>
 *
 * The script finds every kind:30078 event with a spark-wallet-backup d-tag
 * published by the key, then overwrites each one with an empty replacement
 * (same kind + d-tag, empty content, deleted:true tag). Replaceable events
 * are deduplicated by relays, so the empty event wins once it propagates.
 */

import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';

useWebSocketImplementation(WebSocket);

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://relay.snort.social',
];

const BACKUP_EVENT_KIND = 30078;
const SPARK_D_TAG        = 'spark-wallet-backup';

// ── parse args ───────────────────────────────────────────────────────────────
const [,, nsecArg] = process.argv;
if (!nsecArg) {
  console.error('Usage: node scripts/delete-spark-backup.mjs <nsec>');
  process.exit(1);
}

let secretKey;
try {
  const decoded = nip19.decode(nsecArg);
  if (decoded.type !== 'nsec') throw new Error('Not an nsec');
  secretKey = decoded.data;
} catch {
  console.error('Invalid nsec — provide a bech32-encoded nsec1... key');
  process.exit(1);
}

const pubkey = getPublicKey(secretKey);
console.log(`\nPubkey: ${nip19.npubEncode(pubkey)}`);

// ── fetch backups ────────────────────────────────────────────────────────────
const pool = new SimplePool();

console.log('\nSearching for Spark backup events on relays...');
const events = await Promise.race([
  pool.querySync(RELAYS, { kinds: [BACKUP_EVENT_KIND], authors: [pubkey] }),
  new Promise(resolve => setTimeout(() => resolve([]), 10_000))
]);

const backups = events.filter(e =>
  e.tags.some(t => t[0] === 'd' && (t[1] === SPARK_D_TAG || t[1]?.startsWith(SPARK_D_TAG + ':')))
);

if (backups.length === 0) {
  console.log('No Spark backup events found.');
  pool.close(RELAYS);
  process.exit(0);
}

console.log(`\nFound ${backups.length} backup event(s):`);
for (const e of backups) {
  const dTag = e.tags.find(t => t[0] === 'd')?.[1] ?? '(no d-tag)';
  const ts   = new Date(e.created_at * 1000).toISOString();
  const enc  = e.tags.find(t => t[0] === 'encryption')?.[1] ?? 'unknown';
  console.log(`  d-tag: ${dTag}   created: ${ts}   encryption: ${enc}`);
}

// ── overwrite each backup with an empty replacement ──────────────────────────
console.log('\nOverwriting each backup with an empty replacement event...');

for (const e of backups) {
  const dTag = e.tags.find(t => t[0] === 'd' && (t[1] === SPARK_D_TAG || t[1]?.startsWith(SPARK_D_TAG + ':')))?.[1];
  if (!dTag) {
    console.warn('  Skipping event with no matching Spark d-tag');
    continue;
  }

  const template = {
    kind:       BACKUP_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags:       [['d', dTag], ['deleted', 'true']],
    content:    '',
  };

  const signed = finalizeEvent(template, secretKey);
  const results = await Promise.allSettled(pool.publish(RELAYS, signed));

  const ok  = results.filter(r => r.status === 'fulfilled').length;
  const err = results.filter(r => r.status === 'rejected').length;
  console.log(`  ${dTag}: published to ${ok}/${RELAYS.length} relays (${err} failed)`);
}

console.log('\nDone. Backup events replaced — they will be treated as deleted by any relay that accepts replaceable events.');
pool.close(RELAYS);
