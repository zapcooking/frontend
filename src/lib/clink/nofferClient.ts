/**
 * CLINK noffer kind-21001 RPC client.
 *
 * Spec: https://github.com/shocknet/CLINK/blob/main/specs/clink-offers.md
 *
 * Flow (payer side):
 *   1. Build a JSON request payload with the offer id and (when needed)
 *      the amount in sats.
 *   2. NIP-44 encrypt the payload to the offer's service pubkey.
 *   3. Sign and publish a kind-21001 ephemeral event tagged
 *      `["p", servicePubkey]` and `["clink_version","1"]` on the relay
 *      carried in the noffer's TLV 1.
 *   4. Subscribe to kind-21001 on the same relay, filtered to events
 *      tagged for us (`["p", myPubkey]`). Decrypt the first response and
 *      parse it as either `{bolt11}` (success) or `{error,code,...}`
 *      (typed failure surfaced as `NofferError`).
 *
 * The caller is responsible for actually paying the returned bolt11 via
 * `walletManager.sendPayment()` or the external BC modal.
 */

import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { NDKEvent, NDKRelaySet, type NDKKind } from '@nostr-dev-kit/ndk';
import { encrypt, decrypt } from '$lib/encryptionService';
import { NofferError, type NofferData, type NofferRequest, type NofferResponse } from './types';

// NDKKind's enum doesn't have 21001 yet — cast explicitly.
const KIND_CLINK = 21001 as NDKKind;
const DEFAULT_TIMEOUT_MS = 30000;

export interface RequestInvoiceOptions {
  /** Amount in sats. Required for Spontaneous offers; optional override
   * for Fixed/Variable. Services may ignore for Fixed offers. */
  amountSats?: number;
  /** Free-text description for the payment (the service may include it
   * in the invoice description). */
  description?: string;
  /** NIP-XX payer_data passthrough (rarely used). */
  payerData?: Record<string, unknown>;
  /** How long the invoice should be valid for, in seconds (hint to the
   * service — not all services honor it). */
  expiresInSeconds?: number;
  /** How long to wait for a response before giving up. Default 30s. */
  timeoutMs?: number;
}

/**
 * Send a CLINK offer request and await the service's invoice response.
 *
 * @returns `{ bolt11 }` on success.
 * @throws `NofferError` when the service returns a typed error payload.
 * @throws plain `Error` on timeout / signer-missing / network failure.
 */
export async function requestInvoice(
  noffer: NofferData,
  options: RequestInvoiceOptions = {}
): Promise<{ bolt11: string }> {
  const ndkInstance = get(ndk);
  if (!ndkInstance) throw new Error('NDK not initialised');
  if (!ndkInstance.signer) {
    throw new Error('Sign in to pay an offer');
  }

  const me = await ndkInstance.signer.user();
  const myPubkey = me.pubkey;
  if (!myPubkey) throw new Error('Could not resolve signer pubkey');

  // Build the request payload. Pricing rules:
  // - Fixed: amount baked into the offer; we still pass amountSats when
  //   present in case the service double-checks.
  // - Variable / Spontaneous: amountSats is required.
  const requestPayload: NofferRequest = { offer: noffer.offerId };
  if (options.amountSats != null && options.amountSats > 0) {
    requestPayload.amount_sats = Math.floor(options.amountSats);
  }
  if (options.description) requestPayload.description = options.description;
  if (options.payerData) requestPayload.payer_data = options.payerData;
  if (options.expiresInSeconds) requestPayload.expires_in_seconds = options.expiresInSeconds;

  const plaintext = JSON.stringify(requestPayload);
  const { ciphertext } = await encrypt(noffer.pubkey, plaintext, 'nip44');

  // Make sure the relay is in NDK's pool so the subscription + publish
  // both target it. NDKRelaySet.fromRelayUrls with `true` autoconnects.
  try {
    ndkInstance.addExplicitRelay(noffer.relay);
  } catch (e) {
    console.warn('[noffer] Could not add relay to NDK pool:', noffer.relay, e);
  }
  const relaySet = NDKRelaySet.fromRelayUrls([noffer.relay], ndkInstance, true);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Subscribe BEFORE publishing so we don't race a fast response.
  const responsePromise = new Promise<{ bolt11: string }>((resolve, reject) => {
    const sub = ndkInstance.subscribe(
      {
        kinds: [KIND_CLINK],
        '#p': [myPubkey],
        authors: [noffer.pubkey],
        // 5s grace for slight clock skew between us and the service.
        since: Math.floor(Date.now() / 1000) - 5
      },
      { closeOnEose: false },
      relaySet
    );

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.stop();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error('Offer request timed out')));
    }, timeoutMs);

    sub.on('event', async (responseEvent: NDKEvent) => {
      if (settled) return;
      // The `authors` filter already guards this server-side, but defend
      // against relays that ignore filters.
      if (responseEvent.pubkey !== noffer.pubkey) return;
      try {
        const decryptedJson = await decrypt(noffer.pubkey, responseEvent.content, 'nip44');
        const parsed = JSON.parse(decryptedJson) as NofferResponse;
        if (parsed.bolt11) {
          finish(() => resolve({ bolt11: parsed.bolt11 as string }));
          return;
        }
        if (parsed.code != null || parsed.error) {
          finish(() =>
            reject(
              new NofferError(
                parsed.code ?? 0,
                parsed.error ?? 'Unknown error',
                parsed.range,
                parsed.latest
              )
            )
          );
          return;
        }
        // Unrecognised payload — keep listening; maybe a stale event.
      } catch (e) {
        console.warn('[noffer] Failed to parse response event, ignoring:', e);
      }
    });
  });

  // Build, sign, publish.
  const evt = new NDKEvent(ndkInstance);
  evt.kind = KIND_CLINK;
  evt.content = ciphertext;
  evt.tags = [
    ['p', noffer.pubkey],
    ['clink_version', '1']
  ];
  await evt.sign();
  await evt.publish(relaySet);

  return responsePromise;
}
