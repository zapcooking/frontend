/**
 * Nourish Event Publisher (Server-side only)
 *
 * Signs and publishes Nourish analysis events (kind 30078) using
 * nostr-tools directly (not NDK). NDK's WebSocket handling doesn't
 * work reliably on Cloudflare Workers — direct WebSocket publish does.
 */

import { nip19, finalizeEvent } from 'nostr-tools';
import {
  NOURISH_CACHE_VERSION,
  NOURISH_PROMPT_VERSION,
  type NourishScores,
  type IngredientSignal
} from './types';
import { buildNourishDTag } from './nourishRelay';

const PUBLISH_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net'];
const PUBLISH_TIMEOUT_MS = 5000;

/**
 * Resolve the private key from env var (supports both hex and nsec format).
 * Returns a Uint8Array for nostr-tools.
 */
function resolvePrivateKey(raw: string): Uint8Array {
  if (raw.startsWith('nsec1')) {
    const decoded = nip19.decode(raw);
    return decoded.data as Uint8Array;
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Uint8Array.from(raw.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  }
  throw new Error('Invalid private key format — must be 64 hex chars or nsec');
}

/**
 * Publish an event to a single relay via raw WebSocket.
 * Returns true if the relay accepted the event.
 */
function publishToRelay(relayUrl: string, event: any): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const WebSocket = globalThis.WebSocket;
      const ws = new WebSocket(relayUrl);
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) { settled = true; ws.close(); resolve(false); }
      }, PUBLISH_TIMEOUT_MS);

      ws.onopen = () => {
        if (settled) return;
        try {
          ws.send(JSON.stringify(['EVENT', event]));
        } catch {
          if (!settled) { settled = true; clearTimeout(timer); ws.close(); resolve(false); }
        }
      };

      ws.onmessage = (msg: MessageEvent) => {
        try {
          const data = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
          if (data[0] === 'OK') {
            const accepted = data[2] === true;
            if (!settled) { settled = true; clearTimeout(timer); ws.close(); resolve(accepted); }
          }
        } catch {}
      };

      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} resolve(false); }
      };

      ws.onclose = () => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(false); }
      };
    } catch {
      resolve(false);
    }
  });
}

/**
 * Publish a Nourish analysis event to relays.
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
    const privKeyBytes = resolvePrivateKey(privateKey);
    const dTag = buildNourishDTag(recipePubkey, recipeDTag);
    const createdAt = Math.floor(Date.now() / 1000);

    // Build and sign event using nostr-tools (works on CF Workers)
    const event = finalizeEvent({
      kind: 30078,
      created_at: createdAt,
      tags: [
        ['d', dTag],
        ['client', 'zap.cooking'],
        ['a', `30023:${recipePubkey}:${recipeDTag}`],
        ['p', recipePubkey],
        ['nourish_version', NOURISH_CACHE_VERSION],
        ['content_hash', contentHash],
        ['prompt_version', NOURISH_PROMPT_VERSION],
        ['nourish_overall', String(scores.overall.score)],
        ['nourish_gut', String(scores.gut.score)],
        ['nourish_protein', String(scores.protein.score)],
        ['nourish_realfood', String(scores.realFood.score)]
      ],
      content: JSON.stringify({
        gut: scores.gut,
        protein: scores.protein,
        realFood: scores.realFood,
        overall: scores.overall,
        summary: scores.summary,
        improvements,
        ingredient_signals: ingredientSignals,
        cacheVersion: scores.cacheVersion,
        // Mirror identity fields into content so the payload is self-
        // describing (tags already carry them; content duplication lets
        // downstream consumers read either location).
        promptVersion: NOURISH_PROMPT_VERSION,
        contentHash,
        createdAt
      })
    }, privKeyBytes);

    // Publish to all relays in parallel
    const results = await Promise.all(
      PUBLISH_RELAYS.map((relay) => publishToRelay(relay, event))
    );

    const successCount = results.filter(Boolean).length;
    console.log(`[Nourish Publisher] Published to ${successCount}/${PUBLISH_RELAYS.length} relays for ${recipeDTag}`);

    return successCount > 0;
  } catch (err) {
    console.error('[Nourish Publisher] Failed:', err);
    return false;
  }
}
