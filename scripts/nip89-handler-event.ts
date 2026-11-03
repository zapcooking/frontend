/**
 * Prints Zap Cooking's NIP-89 handler event (kind 31990), unsigned, as
 * JSON. Sign and publish it with the ORG account's key, once, and again
 * after changing src/lib/nip89Headlight.ts. For example, with nak:
 *
 *   npx tsx scripts/nip89-handler-event.ts > handler.json
 *   nak event --sec <org key> < handler.json wss://relay.damus.io wss://nos.lol …
 *
 * No key is read here: this only builds the event.
 */
import { buildHandlerHeadlight } from '../src/lib/nip89Headlight';

console.log(JSON.stringify({ ...buildHandlerHeadlight(), created_at: Math.floor(Date.now() / 1000) }, null, 2));
