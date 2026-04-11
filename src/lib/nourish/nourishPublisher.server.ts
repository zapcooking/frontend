/**
 * Nourish Event Publisher (Server-side only)
 *
 * Signs and publishes Nourish analysis events (kind 30078) to the pantry relay
 * using the Zap Cooking service account. This makes the analysis available to
 * all future viewers without a fresh GPT call.
 *
 * Mirrors the pattern in membershipNotificationService.ts for server-side signing.
 */

import NDK, { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import {
  NOURISH_CACHE_VERSION,
  NOURISH_PROMPT_VERSION,
  type NourishScores,
  type IngredientSignal
} from './types';
import { buildNourishDTag } from './nourishRelay';

const PANTRY_RELAY = 'wss://pantry.zap.cooking';
const PUBLISH_RELAYS = [PANTRY_RELAY, 'wss://relay.damus.io', 'wss://nos.lol'];
const CONNECT_TIMEOUT_MS = 5000;
const PUBLISH_TIMEOUT_MS = 5000;

/**
 * Resolve the private key from env var (supports both hex and nsec format).
 */
function resolvePrivateKey(raw: string): string {
  if (raw.startsWith('nsec1')) {
    const decoded = nip19.decode(raw);
    const dataArray = Array.from(decoded.data as Uint8Array);
    return dataArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return raw;
  }
  throw new Error('Invalid private key format — must be 64 hex chars or nsec');
}

/**
 * Publish a Nourish analysis event to the pantry relay.
 *
 * This is fire-and-forget from the API route's perspective — publish failures
 * don't block the response. The next viewer will trigger a fresh analysis if
 * no event is found on the relay.
 */
export async function publishNourishEvent(opts: {
  privateKey: string;
  recipePubkey: string;
  recipeDTag: string;
  contentHash: string;
  scores: NourishScores;
  improvements: string[];
  ingredientSignals: IngredientSignal[];
}): Promise<boolean> {
  const { privateKey, recipePubkey, recipeDTag, contentHash, scores, improvements, ingredientSignals } = opts;

  try {
    const hexKey = resolvePrivateKey(privateKey);
    const signer = new NDKPrivateKeySigner(hexKey);

    const ndk = new NDK({ explicitRelayUrls: PUBLISH_RELAYS });
    ndk.signer = signer;
    await ndk.connect();

    // Wait for at least one relay to connect
    const connected = await waitForConnection(ndk);
    if (!connected) {
      console.error('[Nourish Publisher] No relays connected after timeout');
      return false;
    }

    const dTag = buildNourishDTag(recipePubkey, recipeDTag);

    // Build the event
    const event = new NDKEvent(ndk);
    event.kind = 30078;
    event.content = JSON.stringify({
      gut: scores.gut,
      protein: scores.protein,
      realFood: scores.realFood,
      overall: scores.overall,
      summary: scores.summary,
      improvements,
      ingredient_signals: ingredientSignals,
      version: scores.version
    });
    event.tags = [
      // Identity
      ['d', dTag],
      ['client', 'zap.cooking'],

      // Recipe reference
      ['a', `30023:${recipePubkey}:${recipeDTag}`],
      ['p', recipePubkey],

      // Versioning
      ['nourish_version', NOURISH_CACHE_VERSION],
      ['content_hash', contentHash],
      ['prompt_version', NOURISH_PROMPT_VERSION],

      // Indexable scores (for future relay-side filtering)
      ['nourish_overall', String(scores.overall.score)],
      ['nourish_gut', String(scores.gut.score)],
      ['nourish_protein', String(scores.protein.score)],
      ['nourish_realfood', String(scores.realFood.score)]
    ];
    event.created_at = Math.floor(Date.now() / 1000);

    await event.sign(signer);

    // Publish with timeout
    const publishPromise = event.publish();
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Publish timeout')), PUBLISH_TIMEOUT_MS)
    );

    await Promise.race([publishPromise, timeoutPromise]);
    console.log(`[Nourish Publisher] Published analysis for ${recipeDTag} (${dTag})`);
    return true;
  } catch (err) {
    console.error('[Nourish Publisher] Failed to publish:', err);
    return false;
  }
}

async function waitForConnection(ndk: NDK): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < CONNECT_TIMEOUT_MS) {
    const connected = Array.from(ndk.pool.relays.values()).filter(
      (r) => r.status === 1
    );
    if (connected.length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
