/**
 * Unified Encryption Service
 *
 * Provides signer-agnostic encryption/decryption that works with:
 * - NIP-07 (browser extensions like Alby, nos2x)
 * - NIP-46 (remote signers like Amber)
 * - Private key signers
 *
 * The service routes encryption calls through NDK's signer interface when available,
 * falling back to window.nostr for legacy NIP-07 support.
 */

import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { NDKUser, type NDKNip46Signer } from '@nostr-dev-kit/ndk';
import { browser } from '$app/environment';
import * as nip44 from 'nostr-tools/nip44';
import * as nip04 from 'nostr-tools/nip04';
import { nip19 } from 'nostr-tools';
import { nip44EncryptViaNip46, nip44DecryptViaNip46 } from '$lib/nip46Rpc';
import { getAuthManager, type AuthState } from '$lib/authManager';

export type EncryptionMethod = 'nip44' | 'nip04' | null;

// ═══════════════════════════════════════════════════════════════
// DECRYPT CACHE & SEQUENTIAL QUEUE
// ═══════════════════════════════════════════════════════════════

/**
 * In-memory cache for decrypted content.
 * Prevents re-decrypting the same ciphertext (which hits browser signers).
 * Keyed by "method:senderPubkey:ciphertext" to avoid collisions across methods.
 */
const decryptCache = new Map<string, string>();
const DECRYPT_CACHE_MAX = 500;

/** Sentinel stored in cache when the signer denied a decrypt request. */
const DECRYPT_DENIED = '\x00__DENIED__';

// ── Circuit breaker ──────────────────────────────────────────
// After SIGNER_DENIAL_THRESHOLD consecutive user denials, stop
// sending any further decrypt requests for the rest of the session.
let signerDenialCount = 0;
let signerCircuitBroken = false;
const SIGNER_DENIAL_THRESHOLD = 2;

function getDecryptCacheKey(
  method: EncryptionMethod,
  senderPubkey: string,
  ciphertext: string
): string {
  return `${method}:${senderPubkey}:${ciphertext}`;
}

function getCachedDecrypt(
  method: EncryptionMethod,
  senderPubkey: string,
  ciphertext: string
): string | undefined {
  return decryptCache.get(getDecryptCacheKey(method, senderPubkey, ciphertext));
}

function setCachedDecrypt(
  method: EncryptionMethod,
  senderPubkey: string,
  ciphertext: string,
  plaintext: string
): void {
  if (decryptCache.size >= DECRYPT_CACHE_MAX) {
    // Evict oldest half
    const keys = Array.from(decryptCache.keys());
    for (let i = 0; i < keys.length / 2; i++) {
      decryptCache.delete(keys[i]);
    }
  }
  decryptCache.set(getDecryptCacheKey(method, senderPubkey, ciphertext), plaintext);
}

/** Clear the decrypt cache and reset the circuit breaker (call on logout). */
export function clearDecryptCache(): void {
  decryptCache.clear();
  signerDenialCount = 0;
  signerCircuitBroken = false;
  decryptQueuePromise = Promise.resolve();
}

/**
 * Sequential queue for decrypt operations.
 * Browser signers (like Nostash) can only handle one request at a time.
 * Without this, parallel decrypt calls flood the signer with popups.
 */
let decryptQueuePromise: Promise<void> = Promise.resolve();

function enqueueDecrypt<T>(fn: () => Promise<T>): Promise<T> {
  const result = decryptQueuePromise.then(fn, fn);
  // Update the chain (swallow errors so the queue doesn't stall)
  decryptQueuePromise = result.then(
    () => {},
    () => {}
  );
  return result;
}

/**
 * Detect whether a signer error is a user denial (clicked "No" / "Cancel").
 * Browser signers throw with varied messages; match common patterns.
 */
function isUserDenial(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /reject|denied|cancel|refused|declined|abort|dismissed/.test(msg);
}

// NDK exposes `encrypt(recipient, value)` / `decrypt(sender, value)` on
// NDKNip46Signer, and these issue nip04_encrypt / nip04_decrypt RPCs
// under the hood. NDK does NOT expose NIP-44 methods — those must be
// driven through the raw RPC helper in $lib/nip46Rpc.
type SignerWithEncryption = {
  encrypt?: (recipient: NDKUser, plaintext: string) => Promise<string>;
  decrypt?: (sender: NDKUser, ciphertext: string) => Promise<string>;
};

/**
 * Which kind of signer the session uses, taken from authManager's
 * authMethod. Never from the signer's class name: minification mangles
 * constructor names in production (NDKPrivateKeySigner ships as e.g. "e"),
 * so name checks silently fail there while passing in dev and tests.
 *
 * null = unknown (no auth manager yet, signed out, or anonymous). Callers
 * fall back to duck-typed checks for encrypt/decrypt, but anything that
 * must be sure of the identity (backup creation) treats it as a block.
 */
type SignerKind = 'local' | 'nip07' | 'nip46' | null;

function getAuthMethod(): AuthState['authMethod'] {
  return getAuthManager()?.getState().authMethod ?? null;
}

function getSignerKind(): SignerKind {
  switch (getAuthMethod()) {
    case 'privateKey':
    case 'passkey':
      return 'local';
    case 'nip07':
      return 'nip07';
    case 'nip46':
      return 'nip46';
    default:
      return null;
  }
}

/**
 * Wait out an anonymous-post signer swap (authManager.postAnonymously puts
 * a throwaway key on ndk.signer for one publish). Every key and signer read
 * below goes through ndk.signer, so encrypt/decrypt must not start mid-swap.
 */
async function signerSettled(): Promise<void> {
  await getAuthManager()?.waitForSignerSwap?.();
}

function hasNip07Encrypt(): boolean {
  const nostr = (window as any).nostr;
  return !!(nostr?.nip44?.encrypt || nostr?.nip04?.encrypt);
}

/**
 * Get the session private key: in-memory signer first, localStorage second.
 *
 * Passkey-vault sessions keep the nsec ONLY in the NDK signer — nothing in
 * localStorage — so the signer must be consulted first. Detection is
 * duck-typed on the value (a 64-hex `privateKey` property, which in NDK 2.10
 * only NDKPrivateKeySigner and its subclasses expose): class-name checks are
 * mangled by minification in production, and NDKNip46Signer has no such
 * getter so a bunker session can never leak its ephemeral client key here.
 *
 * The localStorage copy belongs to nsec sessions only. Under any other known
 * auth method (passkey, NIP-07, NIP-46) a stored key is a leftover from an
 * earlier session and would encrypt under the wrong identity, so it is
 * ignored. With no auth method yet (pre-hydration, legacy) it is trusted as
 * before. NIP-07 and NIP-46 sessions have no local key at all, so the signer
 * isn't consulted either (a key there is a temporary swap, never theirs).
 */
function getPrivateKey(): string | null {
  if (!browser) return null;

  const kind = getSignerKind();
  if (kind === 'nip07' || kind === 'nip46') return null;

  try {
    const signer = get(ndk).signer as { privateKey?: string } | null | undefined;
    const hex = signer?.privateKey;
    if (typeof hex === 'string' && /^[0-9a-fA-F]{64}$/.test(hex)) {
      return hex.toLowerCase();
    }
  } catch {
    /* fall through to stored key */
  }

  const method = getAuthMethod();
  if (method !== null && method !== 'privateKey') return null;

  const stored = localStorage.getItem('nostrcooking_privateKey');
  if (!stored) return null;

  // Handle nsec1 format - decode to hex
  if (stored.startsWith('nsec1')) {
    try {
      const decoded = nip19.decode(stored);
      if (decoded.type !== 'nsec') return null;
      const bytes = decoded.data as Uint8Array;
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return null;
    }
  }

  // Already hex format
  return stored;
}

/**
 * Whether decrypt() can run without user interaction. True only when a
 * local private key is available (nsec login, or a passkey vault whose
 * NDK signer holds the key). With NIP-07 every decrypt call pops the
 * extension's permission dialog, so background/passive checks that would
 * compare encrypted backups must test this first and skip the comparison
 * rather than surprise the user with a prompt.
 */
export function canDecryptSilently(): boolean {
  return browser && !!getPrivateKey();
}

/**
 * Check if encryption is supported (synchronous, for UI state)
 * For NIP-46 signers, we can't check synchronously, so we return true
 * and let the actual encryption call handle the error gracefully
 */
export function hasEncryptionSupport(): boolean {
  if (!browser) return false;

  const ndkInstance = get(ndk);
  const signer = ndkInstance.signer as SignerWithEncryption | null | undefined;

  switch (getSignerKind()) {
    // NIP-07 signers use window.nostr for encryption
    case 'nip07':
      return hasNip07Encrypt();
    // For private key signers, we can use nostr-tools directly
    case 'local':
      return !!getPrivateKey();
    // For NIP-46 signers, encryption support depends on remote signer permissions
    // We can't check this synchronously, so we return true and let encrypt() handle it
    case 'nip46':
      return true;
  }

  // Unknown auth method — duck-typed fallbacks.
  if (signer) {
    // Direct encryption method available on signer (NDK exposes
    // encrypt() / decrypt() — nip04/44 prefixed variants do not exist).
    if (typeof signer.encrypt === 'function') {
      return true;
    }

    // Unknown signer type - check window.nostr as fallback
    const nostr = (window as any).nostr;
    if (nostr?.nip44?.encrypt || nostr?.nip04?.encrypt) {
      return true;
    }

    // Last resort for private key signer: check localStorage directly
    if (getPrivateKey()) {
      return true;
    }

    return false;
  }

  // No signer - check if we have a private key stored
  if (getPrivateKey()) {
    return true;
  }

  // Fallback check for window.nostr (NIP-07 without NDK signer set)
  const nostr = (window as any).nostr;
  return !!(nostr?.nip44?.encrypt || nostr?.nip04?.encrypt);
}

/**
 * Get the best available encryption method
 */
export async function getEncryptionMethod(): Promise<EncryptionMethod> {
  if (!browser) return null;

  const ndkInstance = get(ndk);
  const signer = ndkInstance.signer as SignerWithEncryption | null | undefined;

  const kind = getSignerKind();

  // NIP-46 signers: prefer NIP-44 (encrypt() in the service falls
  // through to NIP-04 at runtime if the signer rejects nip44).
  if (kind === 'nip46') return 'nip44';

  // For private key signers, we can use nostr-tools directly
  if (kind === 'local' && getPrivateKey()) return 'nip44';

  // Unknown signer type: NDK exposes encrypt/decrypt on its signer
  // interface — use NIP-04 for signers that only advertise this legacy
  // support. NIP-07 sessions skip this and use window.nostr below.
  if (kind === null && signer && typeof signer.encrypt === 'function') {
    return 'nip04';
  }

  // Check if we have a private key stored (for direct encryption)
  if (getPrivateKey()) {
    return 'nip44';
  }

  // Fallback to window.nostr check (NIP-07 without NDK signer set)
  const nostr = (window as any).nostr;
  if (nostr?.nip44?.encrypt) return 'nip44';
  if (nostr?.nip04?.encrypt) return 'nip04';

  return null;
}

/**
 * Get the best encryption method synchronously (for UI)
 */
export function getBestEncryptionMethod(): EncryptionMethod {
  if (!browser) return null;

  const ndkInstance = get(ndk);

  // NDK signers support both, prefer NIP-44
  if (ndkInstance.signer) return 'nip44';

  // Check if we have a private key stored (for direct encryption)
  if (getPrivateKey()) {
    return 'nip44';
  }

  // Fallback to window.nostr
  const nostr = (window as any).nostr;
  if (nostr?.nip44?.encrypt) return 'nip44';
  if (nostr?.nip04?.encrypt) return 'nip04';

  return null;
}

/**
 * Why the current session can't create a Nostr-relay-stored encrypted
 * backup (wallet seed, NWC connection string, etc.), or null if it can.
 *
 * Some NIP-46 remote signers may encrypt under their session/auth
 * key rather than the user's real identity key. When that happens
 * the resulting ciphertext can't be decrypted later by any client
 * that calls spec-compliant nip44.decrypt with the real user pubkey
 * — including future zap.cooking sessions, even on the same account.
 * Since we can't tell from the outside which remote signers behave
 * this way, the conservative default is to disable backup *creation*
 * for all NIP-46 users until the failure mode is better characterised.
 *
 * Existing backups remain visible in the restore list and we still
 * attempt to decrypt them — only new writes are blocked.
 *
 * Decided from authManager's authMethod, never the signer's class name
 * (mangled in production). nsec and passkey sessions encrypt locally
 * with the in-memory key; NIP-07 encrypts with the user's real key via
 * the extension.
 */
export type NostrBackupBlocker =
  'nip46' | 'no-local-key' | 'no-extension-encryption' | 'signed-out';

export function getNostrBackupBlocker(): NostrBackupBlocker | null {
  if (!browser) return 'signed-out';

  switch (getSignerKind()) {
    case 'nip46':
      return 'nip46';
    case 'local':
      return getPrivateKey() ? null : 'no-local-key';
    case 'nip07':
      return hasNip07Encrypt() ? null : 'no-extension-encryption';
    default:
      return 'signed-out';
  }
}

export function canCreateNostrBackup(): boolean {
  return getNostrBackupBlocker() === null;
}

/**
 * User-facing explanation for a backup blocker. `manualAlternative` is
 * the caller's fallback advice, e.g. "Save your recovery phrase manually".
 */
export function describeNostrBackupBlocker(
  blocker: NostrBackupBlocker,
  manualAlternative: string
): string {
  switch (blocker) {
    case 'nip46':
      return (
        'Nostr-relay backup is unavailable when using a remote signer (NIP-46). ' +
        `${manualAlternative}, or sign in with a private key (nsec) ` +
        'or a NIP-07 browser extension to enable cloud backup.'
      );
    case 'no-local-key':
      return (
        "Nostr-relay backup is unavailable because this session's private key isn't loaded. " +
        `Sign out and back in to enable cloud backup, or ${lowerFirst(manualAlternative)}.`
      );
    case 'no-extension-encryption':
      return (
        'Nostr-relay backup is unavailable because your browser extension does not support encryption. ' +
        `Use an extension that supports NIP-44 or NIP-04 encryption, or ${lowerFirst(manualAlternative)}.`
      );
    case 'signed-out':
      return `Sign in to enable Nostr-relay backup, or ${lowerFirst(manualAlternative)}.`;
  }
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Encrypt data using the best available method
 */
export async function encrypt(
  recipientPubkey: string,
  plaintext: string,
  preferredMethod?: EncryptionMethod
): Promise<{ ciphertext: string; method: EncryptionMethod }> {
  if (!browser) {
    throw new Error('Encryption not available on server');
  }

  await signerSettled();

  const ndkInstance = get(ndk);
  const signer = ndkInstance.signer as SignerWithEncryption | null | undefined;
  const kind = getSignerKind();

  // For NIP-07 signers, go directly to window.nostr (NDKNip07Signer delegates to it anyway)
  if (kind === 'nip07') {
    const nostr = (window as any).nostr;

    if (nostr?.nip44?.encrypt && (!preferredMethod || preferredMethod === 'nip44')) {
      try {
        const ciphertext = await nostr.nip44.encrypt(recipientPubkey, plaintext);
        return { ciphertext, method: 'nip44' };
      } catch (e) {
        console.warn('[Encryption] window.nostr.nip44.encrypt failed:', e);
        // Fall through to try nip04
      }
    }
    if (nostr?.nip04?.encrypt) {
      try {
        const ciphertext = await nostr.nip04.encrypt(recipientPubkey, plaintext);
        return { ciphertext, method: 'nip04' };
      } catch (e) {
        console.error('[Encryption] window.nostr.nip04.encrypt failed:', e);
        throw new Error(
          'NIP-07 extension encryption failed. Please ensure your extension supports encryption.'
        );
      }
    }

    // Check what's available on window.nostr for debugging
    console.error('[Encryption] window.nostr encryption not available:', {
      hasNostr: !!nostr,
      hasNip44: !!nostr?.nip44,
      hasNip44Encrypt: !!nostr?.nip44?.encrypt,
      hasNip04: !!nostr?.nip04,
      hasNip04Encrypt: !!nostr?.nip04?.encrypt
    });
    throw new Error(
      'Your browser extension does not support encryption. Please use an extension like Alby or nos2x that supports NIP-04 or NIP-44 encryption.'
    );
  }

  // For NIP-46 signers: NIP-44 goes through the raw RPC (NDK has no
  // built-in for it); NIP-04 uses NDK's encrypt() which issues a
  // nip04_encrypt RPC under the hood. Prefer NIP-44 and fall through
  // to NIP-04 if the signer rejects NIP-44 (e.g. older signer that
  // only grants nip04 permissions).
  if (kind === 'nip46' && signer) {
    const recipient = new NDKUser({ pubkey: recipientPubkey });
    const nip46Signer = signer as unknown as NDKNip46Signer;

    if (!preferredMethod || preferredMethod === 'nip44') {
      try {
        const ciphertext = await nip44EncryptViaNip46(nip46Signer, recipientPubkey, plaintext);
        return { ciphertext, method: 'nip44' };
      } catch (e) {
        console.warn('[Encryption] NIP-46 nip44_encrypt failed, falling back to nip04:', e);
      }
    }
    if (typeof signer.encrypt === 'function') {
      try {
        const ciphertext = await signer.encrypt(recipient, plaintext);
        return { ciphertext, method: 'nip04' };
      } catch (e) {
        console.error('[Encryption] NIP-46 nip04_encrypt failed:', e);
      }
    }

    throw new Error(
      'Your remote signer does not support encryption or has not granted encryption permissions. ' +
        'Please check your remote signer app (e.g., Amber) settings and ensure encryption permissions are enabled. ' +
        'You may need to reconnect and grant encryption permissions.'
    );
  }

  // For private key signers, use nostr-tools directly
  if (kind === 'local') {
    const privateKey = getPrivateKey();
    if (!privateKey) {
      throw new Error('Private key not found. Please log in again with your private key.');
    }

    const method = preferredMethod || 'nip44';
    try {
      if (method === 'nip44') {
        const privateKeyBytes = new Uint8Array(
          privateKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
        );
        const conversationKey = nip44.v2.utils.getConversationKey(privateKeyBytes, recipientPubkey);
        const ciphertext = nip44.v2.encrypt(plaintext, conversationKey);
        return { ciphertext, method: 'nip44' };
      } else {
        const ciphertext = await nip04.encrypt(privateKey, recipientPubkey, plaintext);
        return { ciphertext, method: 'nip04' };
      }
    } catch (e) {
      console.error('[Encryption] Direct encryption failed:', e);
      // Try fallback method
      if (method === 'nip44') {
        try {
          const ciphertext = await nip04.encrypt(privateKey, recipientPubkey, plaintext);
          return { ciphertext, method: 'nip04' };
        } catch (e2) {
          throw new Error('Encryption failed. Please ensure your private key is valid.');
        }
      }
      throw new Error('Encryption failed. Please ensure your private key is valid.');
    }
  }

  // Try direct encryption with private key if available (for cases where signer isn't set but key is stored)
  const privateKey = getPrivateKey();
  if (privateKey) {
    const method = preferredMethod || 'nip44';
    try {
      if (method === 'nip44') {
        const privateKeyBytes = new Uint8Array(
          privateKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
        );
        const conversationKey = nip44.v2.utils.getConversationKey(privateKeyBytes, recipientPubkey);
        const ciphertext = nip44.v2.encrypt(plaintext, conversationKey);
        return { ciphertext, method: 'nip44' };
      } else {
        const ciphertext = await nip04.encrypt(privateKey, recipientPubkey, plaintext);
        return { ciphertext, method: 'nip04' };
      }
    } catch (e) {
      console.error('[Encryption] Direct encryption with stored key failed:', e);
      // Continue to try window.nostr
    }
  }

  // Last resort: Try window.nostr directly (for cases where signer type is unknown)
  const nostr = (window as any).nostr;
  if (nostr?.nip44?.encrypt && (!preferredMethod || preferredMethod === 'nip44')) {
    const ciphertext = await nostr.nip44.encrypt(recipientPubkey, plaintext);
    return { ciphertext, method: 'nip44' };
  }
  if (nostr?.nip04?.encrypt) {
    const ciphertext = await nostr.nip04.encrypt(recipientPubkey, plaintext);
    return { ciphertext, method: 'nip04' };
  }

  console.error('[Encryption] No encryption method available:', {
    signerKind: kind,
    hasPrivateKey: !!privateKey,
    hasWindowNostr: !!(window as any).nostr
  });
  throw new Error(
    'No encryption method available. Encryption is supported when logged in with a private key (nsec), NIP-07 extension, or NIP-46 remote signer with encryption permissions.'
  );
}

/**
 * Decrypt data using the specified method, with fallback to alternative method.
 * Prioritizes window.nostr for NIP-07 extensions (more reliable across signers),
 * then falls back to NDK signer methods.
 *
 * Uses an in-memory cache so the same ciphertext is never sent to the signer twice,
 * and a sequential queue so browser signers only see one request at a time.
 */
export async function decrypt(
  senderPubkey: string,
  ciphertext: string,
  method: EncryptionMethod
): Promise<string> {
  if (!browser) {
    throw new Error('Decryption not available on server');
  }

  if (!method) {
    throw new Error('Encryption method not specified');
  }

  // Check cache first — avoids hitting the signer entirely
  const cached = getCachedDecrypt(method, senderPubkey, ciphertext);
  if (cached !== undefined) {
    if (cached === DECRYPT_DENIED) {
      throw new Error('Decryption was previously denied by signer');
    }
    return cached;
  }

  await signerSettled();

  // Private-key decryption is local (no signer popup), skip the queue
  const privateKey = getPrivateKey();
  if (privateKey) {
    const result = await decryptWithPrivateKey(privateKey, senderPubkey, ciphertext, method);
    if (result !== null) {
      setCachedDecrypt(method, senderPubkey, ciphertext, result);
      return result;
    }
  }

  // Circuit breaker: stop sending requests after repeated user denials
  if (signerCircuitBroken) {
    throw new Error('Signer decrypt requests disabled after repeated denials');
  }

  // For signer-based decryption, queue sequentially to avoid flooding
  return enqueueDecrypt(async () => {
    // Re-check cache (another queued call may have populated it)
    const cached2 = getCachedDecrypt(method, senderPubkey, ciphertext);
    if (cached2 !== undefined) {
      if (cached2 === DECRYPT_DENIED) {
        throw new Error('Decryption was previously denied by signer');
      }
      return cached2;
    }

    // Re-check circuit breaker (may have tripped while waiting in queue)
    if (signerCircuitBroken) {
      throw new Error('Signer decrypt requests disabled after repeated denials');
    }

    try {
      const result = await decryptViaSigner(senderPubkey, ciphertext, method);
      // Success resets the denial counter
      signerDenialCount = 0;
      setCachedDecrypt(method, senderPubkey, ciphertext, result);
      return result;
    } catch (e) {
      if (isUserDenial(e)) {
        // Cache the denial so this ciphertext is never retried
        setCachedDecrypt(method, senderPubkey, ciphertext, DECRYPT_DENIED);
        // Increment circuit breaker counter
        signerDenialCount++;
        if (signerDenialCount >= SIGNER_DENIAL_THRESHOLD) {
          signerCircuitBroken = true;
          console.warn(
            '[Encryption] Circuit breaker tripped: signer denied',
            signerDenialCount,
            'consecutive decrypt requests. No further decrypt popups this session.'
          );
        }
      }
      throw e;
    }
  });
}

/**
 * Try decrypting with local private key (no signer interaction).
 * Returns null if private key decryption isn't possible/fails.
 */
async function decryptWithPrivateKey(
  privateKey: string,
  senderPubkey: string,
  ciphertext: string,
  method: EncryptionMethod
): Promise<string | null> {
  const methods: EncryptionMethod[] = method === 'nip44' ? ['nip44', 'nip04'] : ['nip04', 'nip44'];

  for (const tryMethod of methods) {
    try {
      if (tryMethod === 'nip44') {
        const privateKeyBytes = new Uint8Array(
          privateKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
        );
        const conversationKey = nip44.v2.utils.getConversationKey(privateKeyBytes, senderPubkey);
        const result = nip44.v2.decrypt(ciphertext, conversationKey);
        if (result !== null && result !== undefined) return result;
      } else if (tryMethod === 'nip04') {
        const result = await nip04.decrypt(privateKey, senderPubkey, ciphertext);
        if (result !== null && result !== undefined) return result;
      }
    } catch (e) {
      console.warn(
        `[Encryption] Direct ${tryMethod} decryption failed:`,
        (e as Error)?.message || e
      );
    }
  }
  return null;
}

/**
 * Some mobile NIP-07 signers (iOS WKWebView bridges in particular) return
 * the plaintext wrapped in an object instead of as a bare string. Accept
 * `{ plaintext }`, `{ result }`, `{ data }`, or `{ content }` so the
 * caller doesn't end up `JSON.stringify`-ing an object further downstream.
 */
function coerceDecryptResult(value: unknown, methodLabel: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const candidate = obj.plaintext ?? obj.result ?? obj.data ?? obj.content;
    if (typeof candidate === 'string') return candidate;
  }
  throw new Error(
    `Signer returned an unexpected ${methodLabel} decrypt result (type: ${typeof value}). ` +
      `If you are using a mobile signer, please ensure it implements NIP-07 nip44.decrypt ` +
      `and returns the plaintext as a string.`
  );
}

/**
 * Decrypt via the session's signer, chosen by auth method: NIP-46 remote
 * signer, NIP-07 extension (window.nostr), or nothing for local-key sessions
 * (decrypt() already tried the key).
 * Called inside the sequential queue so only one request hits the signer at a time.
 *
 * Honors the caller-supplied `method` exactly — we do NOT silently fall back
 * to the other method, because:
 *   - For wallet relay backups the method is pinned by the event's `encryption`
 *     tag, so the "fallback" would just feed nip44 ciphertext into a nip04
 *     decrypt and surface a misleading base64/iv error.
 *   - Some mobile NIP-07 signers expose only one of the two methods; silently
 *     skipping the missing one and calling the other guarantees a wrong-method
 *     call that produces an unrelated failure.
 */
async function decryptViaSigner(
  senderPubkey: string,
  ciphertext: string,
  method: EncryptionMethod
): Promise<string> {
  if (!method) {
    throw new Error('Encryption method not specified');
  }

  // Queued calls can start long after decrypt() checked; re-check.
  await signerSettled();

  const nostr = (window as any).nostr;
  const ndkInstance = get(ndk);
  const signer = ndkInstance.signer as SignerWithEncryption | null | undefined;
  const kind = getSignerKind();

  // NIP-46 remote signer path: NIP-44 via raw RPC, NIP-04 via NDK's decrypt().
  // Chosen by auth method, never window.nostr-first: an installed extension
  // holds whatever key it was set up with, not necessarily this account's.
  if (kind === 'nip46') {
    if (signer) {
      const sender = new NDKUser({ pubkey: senderPubkey });
      const nip46Signer = signer as unknown as NDKNip46Signer;
      if (method === 'nip44') {
        const raw = await nip44DecryptViaNip46(nip46Signer, senderPubkey, ciphertext);
        return coerceDecryptResult(raw, 'nip44');
      }
      if (method === 'nip04' && typeof signer.decrypt === 'function') {
        const raw = await signer.decrypt(sender, ciphertext);
        return coerceDecryptResult(raw, 'nip04');
      }
    }
  } else if (kind === 'local') {
    // decrypt() already tried the session key; asking an extension would
    // decrypt under a different identity (or prompt for nothing).
    throw new Error(
      'Could not decrypt with your private key. This content may have been encrypted for a different key.'
    );
  } else {
    // NIP-07 (or auth method not known yet): drive through window.nostr when
    // the requested method is actually exposed. NIP-44 and NIP-04 are
    // optional in NIP-07; an extension can expose one, both, or neither.
    // Missing-method is treated as "fall through to the error below", not as
    // a silent skip-then-try-the-wrong-method.
    if (method === 'nip44' && typeof nostr?.nip44?.decrypt === 'function') {
      const raw = await nostr.nip44.decrypt(senderPubkey, ciphertext);
      return coerceDecryptResult(raw, 'nip44');
    }
    if (method === 'nip04' && typeof nostr?.nip04?.decrypt === 'function') {
      const raw = await nostr.nip04.decrypt(senderPubkey, ciphertext);
      return coerceDecryptResult(raw, 'nip04');
    }
  }

  // Surface a precise, user-facing reason — and explicitly say which
  // capability is missing — instead of falling through to the other method
  // and producing a misleading base64/iv error.
  const methodLabel = method === 'nip44' ? 'NIP-44' : 'NIP-04';
  throw new Error(
    `Your signer does not support ${methodLabel} decryption. ` +
      `This content was encrypted with ${methodLabel}, which requires a signer that exposes window.nostr.${method}.decrypt. ` +
      `If you are restoring a wallet, you can use your recovery phrase instead.`
  );
}

/**
 * Detect which encryption method was used for a ciphertext
 * NIP-04 ciphertexts contain "?iv=" while NIP-44 uses a different format
 */
export function detectEncryptionMethod(ciphertext: string): EncryptionMethod {
  if (ciphertext.includes('?iv=')) {
    return 'nip04';
  }
  // NIP-44 ciphertexts are typically base64 without the ?iv= suffix
  return 'nip44';
}

/**
 * Helper to create encryption/decryption functions for use in backup flows
 */
export function createEncryptFn(
  method?: EncryptionMethod
): (plaintext: string, recipientPubkey: string) => Promise<string> {
  return async (plaintext: string, recipientPubkey: string): Promise<string> => {
    const result = await encrypt(recipientPubkey, plaintext, method);
    return result.ciphertext;
  };
}

export function createDecryptFn(
  method: EncryptionMethod
): (ciphertext: string, senderPubkey: string) => Promise<string> {
  return async (ciphertext: string, senderPubkey: string): Promise<string> => {
    return await decrypt(senderPubkey, ciphertext, method);
  };
}
