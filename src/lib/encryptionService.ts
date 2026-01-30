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
import { NDKUser } from '@nostr-dev-kit/ndk';
import { browser } from '$app/environment';
import * as nip44 from 'nostr-tools/nip44';
import * as nip04 from 'nostr-tools/nip04';
import { nip19 } from 'nostr-tools';

export type EncryptionMethod = 'nip44' | 'nip04' | null;

/**
 * Get private key from localStorage if available
 */
function getPrivateKey(): string | null {
  if (!browser) return null;
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
 * Check if encryption is supported (synchronous, for UI state)
 * For NIP-46 signers, we can't check synchronously, so we return true
 * and let the actual encryption call handle the error gracefully
 */
export function hasEncryptionSupport(): boolean {
  if (!browser) return false;

  const ndkInstance = get(ndk);
  const signer = ndkInstance.signer;
  const signerName = signer?.constructor?.name || '';

  // Check by signer type (use includes() to handle minified class names like _NDKPrivateKeySigner)
  if (signer) {
    // NIP-07 signers use window.nostr for encryption
    if (signerName.includes('Nip07Signer')) {
      const nostr = (window as any).nostr;
      return !!(nostr?.nip44?.encrypt || nostr?.nip04?.encrypt);
    }

    // For private key signers, we can use nostr-tools directly
    if (signerName.includes('PrivateKeySigner')) {
      return !!getPrivateKey();
    }

    // For NIP-46 signers, encryption support depends on remote signer permissions
    // We can't check this synchronously, so we return true and let encrypt() handle it
    if (signerName.includes('Nip46Signer')) {
      return true;
    }

    // Direct encryption methods available on signer
    if (typeof signer.nip44Encrypt === 'function' || typeof signer.nip04Encrypt === 'function') {
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
  const signer = ndkInstance.signer;

  // If we have an NDK signer, it supports encryption via its interface
  if (signer) {
    // NDK signers support both methods, prefer NIP-44
    if (typeof signer.nip44Encrypt === 'function') return 'nip44';
    if (typeof signer.nip04Encrypt === 'function') return 'nip04';

    // For private key signers, we can use nostr-tools directly
    // Use includes() to handle minified class names
    if ((signer.constructor?.name || '').includes('PrivateKeySigner') && getPrivateKey()) {
      return 'nip44'; // Prefer NIP-44 for private key signers
    }
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
  if (ndkInstance.signer) {
    // For private key signers, we can use nostr-tools directly
    // Use includes() to handle minified class names
    if ((ndkInstance.signer.constructor?.name || '').includes('PrivateKeySigner') && getPrivateKey()) {
      return 'nip44';
    }
    return 'nip44';
  }

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

  const ndkInstance = get(ndk);
  const signer = ndkInstance.signer;
  const signerName = signer?.constructor?.name || '';

  console.log('[Encryption] Starting encryption, signer type:', signerName);

  // For NIP-07 signers, go directly to window.nostr (NDKNip07Signer delegates to it anyway)
  // Use includes() to handle minified class names like _NDKNip07Signer
  if (signerName.includes('Nip07Signer')) {
    console.log('[Encryption] NIP-07 signer detected, using window.nostr directly');
    const nostr = (window as any).nostr;

    if (nostr?.nip44?.encrypt && (!preferredMethod || preferredMethod === 'nip44')) {
      try {
        console.log('[Encryption] Trying window.nostr.nip44.encrypt...');
        const ciphertext = await nostr.nip44.encrypt(recipientPubkey, plaintext);
        return { ciphertext, method: 'nip44' };
      } catch (e) {
        console.warn('[Encryption] window.nostr.nip44.encrypt failed:', e);
        // Fall through to try nip04
      }
    }
    if (nostr?.nip04?.encrypt) {
      try {
        console.log('[Encryption] Trying window.nostr.nip04.encrypt...');
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

  // For NIP-46 signers, use the signer's encryption methods
  if (signerName.includes('Nip46Signer') && signer) {
    console.log('[Encryption] NIP-46 signer detected, checking for encryption methods...');
    const recipient = new NDKUser({ pubkey: recipientPubkey });

    if (
      typeof signer.nip44Encrypt === 'function' &&
      (!preferredMethod || preferredMethod === 'nip44')
    ) {
      try {
        console.log('[Encryption] Trying signer.nip44Encrypt...');
        const ciphertext = await signer.nip44Encrypt(recipient, plaintext);
        return { ciphertext, method: 'nip44' };
      } catch (e) {
        console.warn('[Encryption] signer.nip44Encrypt failed:', e);
        // Fall through to try nip04
      }
    }
    if (typeof signer.nip04Encrypt === 'function') {
      try {
        console.log('[Encryption] Trying signer.nip04Encrypt...');
        const ciphertext = await signer.nip04Encrypt(recipient, plaintext);
        return { ciphertext, method: 'nip04' };
      } catch (e) {
        console.error('[Encryption] signer.nip04Encrypt failed:', e);
      }
    }

    throw new Error(
      'Your remote signer does not support encryption or has not granted encryption permissions. ' +
        'Please check your remote signer app (e.g., Amber) settings and ensure encryption permissions are enabled. ' +
        'You may need to reconnect and grant encryption permissions.'
    );
  }

  // For private key signers, use nostr-tools directly
  if (signerName.includes('PrivateKeySigner')) {
    const privateKey = getPrivateKey();
    if (!privateKey) {
      throw new Error('Private key not found. Please log in again with your private key.');
    }

    console.log('[Encryption] Private key signer detected, using nostr-tools directly');
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
    console.log('[Encryption] No signer but private key found, using nostr-tools directly');
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
    console.log('[Encryption] Fallback: Trying window.nostr.nip44.encrypt...');
    const ciphertext = await nostr.nip44.encrypt(recipientPubkey, plaintext);
    return { ciphertext, method: 'nip44' };
  }
  if (nostr?.nip04?.encrypt) {
    console.log('[Encryption] Fallback: Trying window.nostr.nip04.encrypt...');
    const ciphertext = await nostr.nip04.encrypt(recipientPubkey, plaintext);
    return { ciphertext, method: 'nip04' };
  }

  console.error('[Encryption] No encryption method available:', {
    signerName,
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

  // Try primary method first, then fallback to alternative
  const methods: EncryptionMethod[] = method === 'nip44' ? ['nip44', 'nip04'] : ['nip04', 'nip44'];
  let lastError: Error | null = null;

  for (const tryMethod of methods) {
    try {
      // First try window.nostr (NIP-07) - this is the original working method
      const nostr = (window as any).nostr;
      if (tryMethod === 'nip44' && nostr?.nip44?.decrypt) {
        console.log('[Encryption] Trying window.nostr.nip44.decrypt...');
        const result = await nostr.nip44.decrypt(senderPubkey, ciphertext);
        if (result) return result;
      }
      if (tryMethod === 'nip04' && nostr?.nip04?.decrypt) {
        console.log('[Encryption] Trying window.nostr.nip04.decrypt...');
        const result = await nostr.nip04.decrypt(senderPubkey, ciphertext);
        if (result) return result;
      }

      // Try direct decryption with private key if available
      const privateKey = getPrivateKey();
      if (privateKey) {
        try {
          if (tryMethod === 'nip44') {
            console.log('[Encryption] Trying direct nip44 decryption with private key...');
            // Convert hex private key to Uint8Array for NIP-44
            const privateKeyBytes = new Uint8Array(
              privateKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
            );
            const conversationKey = nip44.v2.utils.getConversationKey(
              privateKeyBytes,
              senderPubkey
            );
            const result = nip44.v2.decrypt(ciphertext, conversationKey);
            if (result) return result;
          } else if (tryMethod === 'nip04') {
            console.log('[Encryption] Trying direct nip04 decryption with private key...');
            const result = await nip04.decrypt(privateKey, senderPubkey, ciphertext);
            if (result) return result;
          }
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          const errorStack = e instanceof Error ? e.stack : undefined;
          console.warn(`[Encryption] Direct ${tryMethod} decryption failed:`, {
            message: errorMsg,
            stack: errorStack,
            error: e
          });
          // Continue to try NDK signer
        }
      }

      // Fallback to NDK signer (for NIP-46 remote signers, etc.)
      const ndkInstance = get(ndk);
      const signer = ndkInstance.signer;
      if (signer) {
        const sender = new NDKUser({ pubkey: senderPubkey });

        if (tryMethod === 'nip44' && typeof signer.nip44Decrypt === 'function') {
          console.log('[Encryption] Trying NDK signer.nip44Decrypt...');
          const result = await signer.nip44Decrypt(sender, ciphertext);
          if (result) return result;
        } else if (tryMethod === 'nip04' && typeof signer.nip04Decrypt === 'function') {
          console.log('[Encryption] Trying NDK signer.nip04Decrypt...');
          const result = await signer.nip04Decrypt(sender, ciphertext);
          if (result) return result;
        }
      }
    } catch (e) {
      console.warn(`[Encryption] ${tryMethod} decryption failed, trying next method...`, e);
      lastError = e instanceof Error ? e : new Error(String(e));
      // Continue to next method
    }
  }

  throw lastError || new Error(`Cannot decrypt: no supported decryption method available`);
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
