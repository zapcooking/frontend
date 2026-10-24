/**
 * Delete a corrupted Spark wallet backup from Nostr relays.
 *
 * Usage:
 *   node scripts/delete-spark-backup.mjs          (prompts for the nsec)
 *   node scripts/delete-spark-backup.mjs <nsec>   (discouraged — see below)
 *
 * The script finds every kind:30078 event with a spark-wallet-backup d-tag
 * published by the key, then overwrites each one with an empty replacement
 * (same kind + d-tag, empty content, deleted:true tag). Replaceable events
 * are deduplicated by relays, so the empty event wins once it propagates.
 */

import { createInterface } from 'node:readline';
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';

useWebSocketImplementation(WebSocket);

const RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://relay.snort.social',
];

const BACKUP_EVENT_KIND = 30078;
const SPARK_D_TAG        = 'spark-wallet-backup';

// ── obtain the key ───────────────────────────────────────────────────────────
//
// Prefer an interactive prompt with echo suppressed. Passing an nsec as an
// argv leaves it in shell history (~/.zsh_history), in `ps` output for the
// lifetime of the process, and in any shell-integration transcript — all
// places a private key should never be.

/** Read a line from stdin without echoing it back to the terminal. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo: the readline 'output' write hook drops everything but
    // the prompt itself, so the typed key never appears on screen.
    let muted = false;
    const originalWrite = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (str) => {
      if (!muted && originalWrite) originalWrite(str);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true;
    rl.on('error', reject);
  });
}

const [, , nsecArg] = process.argv;
if (nsecArg) {
  console.warn(
    '\n⚠️  Passing the nsec as an argument leaves it in your shell history\n' +
      '   and in `ps` output. Prefer running this with no arguments.\n'
  );
}

const nsecInput = nsecArg || (await promptHidden('Enter your nsec (input hidden): '));
if (!nsecInput) {
  console.error('No nsec provided.');
  process.exit(1);
}

let secretKey;
try {
  const decoded = nip19.decode(nsecInput);
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
