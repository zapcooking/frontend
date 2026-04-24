/**
 * Low-level NIP-46 JSON-RPC helpers.
 *
 * NDK's NDKNip46Signer only exposes a subset of NIP-46 methods through
 * idiomatic TypeScript methods (sign, encrypt/decrypt as NIP-04). For
 * methods NDK doesn't wrap — get_public_key, nip44_encrypt,
 * nip44_decrypt — and for cases where we need the real RPC response
 * (rather than NDK's synchronous stand-ins), we drive the signer's
 * already-connected RPC channel directly.
 *
 * The channel is attached to the signer as `signer.rpc` (an
 * NDKNostrRpc instance). The `remotePubkey` field is the signer
 * service pubkey, set in the NDK constructor.
 */

import type { NDKNip46Signer } from '@nostr-dev-kit/ndk';

const NIP46_KIND = 24133;
const DEFAULT_TIMEOUT_MS = 15000;

type RpcChannel = {
  sendRequest: (
    remotePubkey: string,
    method: string,
    params: string[],
    kind: number,
    callback: (response: { result?: string; error?: string }) => void
  ) => void;
};

function getChannel(signer: NDKNip46Signer): { rpc: RpcChannel; remotePubkey: string } {
  const view = signer as unknown as { rpc?: RpcChannel; remotePubkey?: string };
  if (!view.rpc || typeof view.rpc.sendRequest !== 'function') {
    throw new Error('NIP-46 signer RPC channel not available');
  }
  if (!view.remotePubkey) {
    throw new Error('NIP-46 signer remote pubkey not resolved');
  }
  return { rpc: view.rpc, remotePubkey: view.remotePubkey };
}

/**
 * Issue a NIP-46 JSON-RPC request through the signer's RPC channel and
 * resolve with the result string. Errors from the signer reject; an
 * absent response rejects after `timeoutMs`.
 *
 * An explicit empty-string `result` is a valid outcome for some methods
 * (e.g. signers that ack without echoing data), so that is passed
 * through. A missing or non-string `result` with no `error` is treated
 * as a protocol failure and rejected rather than silently resolved to
 * `''`, which would otherwise be indistinguishable from a successful
 * encryption that happened to produce empty ciphertext.
 */
export async function sendNip46Rpc(
  signer: NDKNip46Signer,
  method: string,
  params: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const { rpc, remotePubkey } = getChannel(signer);
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
    try {
      rpc.sendRequest(remotePubkey, method, params, NIP46_KIND, (response) => {
        clearTimeout(timer);
        if (response?.error) {
          reject(new Error(`${method}: ${response.error}`));
          return;
        }
        if (typeof response?.result !== 'string') {
          reject(new Error(`${method}: malformed response (missing result)`));
          return;
        }
        resolve(response.result);
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

/**
 * Resolve the user's actual pubkey by issuing a NIP-46 `get_public_key`
 * RPC. NDK's `NDKNip46Signer.user()` is synchronous and returns the
 * signer service pubkey from the constructor, not the user identity —
 * calling it to obtain the user's pubkey silently logs sessions in as
 * the signer service.
 */
export async function fetchNip46UserPubkey(
  signer: NDKNip46Signer,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const result = await sendNip46Rpc(signer, 'get_public_key', [], timeoutMs);
  const pubkey = result.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error(`get_public_key invalid response: ${result}`);
  }
  return pubkey;
}

/**
 * NIP-44 encrypt via NIP-46. NDK exposes `encrypt` only for NIP-04, so
 * NIP-44 must be driven through the raw RPC. Returns the signer's
 * ciphertext string.
 */
export async function nip44EncryptViaNip46(
  signer: NDKNip46Signer,
  recipientPubkey: string,
  plaintext: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return sendNip46Rpc(signer, 'nip44_encrypt', [recipientPubkey, plaintext], timeoutMs);
}

/**
 * NIP-44 decrypt via NIP-46. Mirror of nip44EncryptViaNip46.
 */
export async function nip44DecryptViaNip46(
  signer: NDKNip46Signer,
  senderPubkey: string,
  ciphertext: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return sendNip46Rpc(signer, 'nip44_decrypt', [senderPubkey, ciphertext], timeoutMs);
}
