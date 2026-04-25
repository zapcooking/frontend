/**
 * NIP-44-aware local signer for NIP-46 RPC channels.
 *
 * Background — why this wrapper exists:
 *
 * NIP-46 mandates that the JSON-RPC `content` carried by kind:24133
 * events is NIP-44 encrypted. NDK 2.10.0's `NDKPrivateKeySigner` (the
 * default local signer used by `NDKNip46Signer`) implements
 * `encrypt`/`decrypt` with `nostr-tools/nip04` only. Every RPC NDK sends
 * via `signer.rpc.sendRequest` is therefore NIP-04 on the wire, and
 * every incoming response is fed back through the same NIP-04 decrypt
 * inside `NDKNostrRpc.parseEvent`.
 *
 * Modern signers (Primal, current Amber, nsec.app) follow the spec and
 * respond NIP-44, so NDK silently fails to decrypt their responses —
 * `response-${id}` never emits, the `sendRequest` callback never fires,
 * and our `blockUntilReady` / `fetchNip46UserPubkey` hang for their
 * full timeout window. Symptom: QR pairing stalls on "Waiting for
 * approval…" even though the signer reports a successful connection.
 *
 * This wrapper substitutes `nip44.v2` on the encrypt path and tries
 * `nip44.v2` first / `nip04` fallback on the decrypt path. NIP-04
 * fallback preserves compatibility with older signers that haven't
 * migrated yet.
 *
 * Pass an instance of this class as the `localSigner` argument to
 * `NDKNip46Signer` — never as a user-facing signer for events the
 * client publishes (the user's own events are not NIP-46 RPCs).
 */

import { NDKPrivateKeySigner, type NDKUser } from '@nostr-dev-kit/ndk';
import * as nip44 from 'nostr-tools/nip44';
import * as nip04 from 'nostr-tools/nip04';
import { hexToBytes } from '@noble/hashes/utils.js';

export class Nip44LocalSigner extends NDKPrivateKeySigner {
  async encrypt(recipient: NDKUser, value: string): Promise<string> {
    const hex = this.privateKey;
    if (!hex) {
      throw new Error('Nip44LocalSigner: private key not available');
    }
    const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(hex), recipient.pubkey);
    return nip44.v2.encrypt(value, conversationKey);
  }

  async decrypt(sender: NDKUser, value: string): Promise<string> {
    const hex = this.privateKey;
    if (!hex) {
      throw new Error('Nip44LocalSigner: private key not available');
    }

    // Try NIP-44 first (current spec). Fall through to NIP-04 only if
    // NIP-44 throws — older signers may still emit NIP-04 ciphertexts
    // and we don't want to break compat by forcing the new format.
    try {
      const conversationKey = nip44.v2.utils.getConversationKey(hexToBytes(hex), sender.pubkey);
      return nip44.v2.decrypt(value, conversationKey);
    } catch (nip44Error) {
      try {
        return await nip04.decrypt(hex, sender.pubkey, value);
      } catch {
        // Surface the original NIP-44 error — that's the spec-mandated
        // path, and the fallback failure is rarely what the caller
        // needs to debug.
        throw nip44Error;
      }
    }
  }
}
