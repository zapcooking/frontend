/**
 * NWC Wallet Backup to Nostr Relays
 *
 * Backs up NWC connection strings to Nostr using NIP-78 (kind 30078)
 * with NIP-44 encryption (falls back to NIP-04).
 *
 * Supports both NIP-07 (browser extensions) and NIP-46 (remote signers like Amber).
 */

import { browser } from '$app/environment';
import {
  hasEncryptionSupport as _hasEncryptionSupport,
  getBestEncryptionMethod,
  encrypt,
  decrypt,
  detectEncryptionMethod,
  type EncryptionMethod
} from '$lib/encryptionService';

const NWC_BACKUP_EVENT_KIND = 30078;
const NWC_BACKUP_D_TAG = 'zapcooking-nwc-backup';

// Re-export from encryption service for backwards compatibility
export const hasEncryptionSupport = _hasEncryptionSupport;

/**
 * @deprecated Use hasEncryptionSupport() from encryptionService instead
 */
export function hasNip44Support(): boolean {
  return getBestEncryptionMethod() === 'nip44';
}

/**
 * @deprecated Use hasEncryptionSupport() from encryptionService instead
 */
export function hasNip04Support(): boolean {
  const method = getBestEncryptionMethod();
  return method === 'nip04' || method === 'nip44';
}

/**
 * Backup NWC connection string to Nostr relays.
 * Uses NIP-78 (kind 30078) replaceable events with NIP-44/NIP-04 encryption.
 * Works with both NIP-07 extensions and NIP-46 remote signers.
 * @param pubkey The user's Nostr public key.
 * @param nwcConnectionString The NWC connection string to backup.
 */
export async function backupNwcToNostr(pubkey: string, nwcConnectionString: string): Promise<any> {
  if (!browser) throw new Error('Backup can only be performed in browser');

  if (!nwcConnectionString) {
    throw new Error('No NWC connection string provided');
  }

  // Check encryption support
  if (!hasEncryptionSupport()) {
    throw new Error(
      'No encryption method available. Encryption is supported when logged in with a private key (nsec), NIP-07 extension, or NIP-46 remote signer with encryption permissions.'
    );
  }

  // Create the backup event (kind 30078 - NIP-78 application-specific data)
  const { ndk, ndkReady } = await import('$lib/nostr');
  const { NDKEvent } = await import('@nostr-dev-kit/ndk');
  const { get } = await import('svelte/store');
  const { createAuthManager } = await import('$lib/authManager');

  await ndkReady;
  const ndkInstance = get(ndk);

  // For NIP-46 signers, ensure the signer is ready before attempting encryption
  if (ndkInstance.signer?.constructor?.name === 'NDKNip46Signer') {
    console.log('[NWC Backup] Ensuring NIP-46 signer is ready...');
    const authManager = createAuthManager(ndkInstance);
    const isReady = await authManager.ensureNip46SignerReady();
    if (!isReady) {
      throw new Error(
        'NIP-46 signer is not ready. Please ensure your remote signer app is open and connected.'
      );
    }
    console.log('[NWC Backup] NIP-46 signer is ready');
  }

  // Encrypt using the unified encryption service
  console.log('[NWC Backup] Encrypting connection string...');
  const { ciphertext: encryptedContent, method: encryptionMethod } = await encrypt(
    pubkey,
    nwcConnectionString
  );
  console.log('[NWC Backup] Encrypted with', encryptionMethod);

  // Create and sign using NDK (works with any signer type)
  const ndkEvent = new NDKEvent(ndkInstance);
  ndkEvent.kind = NWC_BACKUP_EVENT_KIND;
  ndkEvent.content = encryptedContent;
  ndkEvent.tags = [
    ['d', NWC_BACKUP_D_TAG],
    ['client', 'zap.cooking'],
    ['encryption', encryptionMethod || 'nip44']
  ];

  console.log('[NWC Backup] Signing backup event...');
  await ndkEvent.sign();

  console.log('[NWC Backup] Publishing backup to Nostr relays...');
  await ndkEvent.publish();

  console.log('[NWC Backup] NWC connection backed up to Nostr successfully');
  return ndkEvent.rawEvent();
}

/**
 * Restore NWC connection string from Nostr backup.
 * Fetches NIP-78 event and decrypts with NIP-44 or NIP-04.
 * @param pubkey The user's Nostr public key.
 * @returns The decrypted NWC connection string if found, null otherwise.
 */
export async function restoreNwcFromNostr(pubkey: string): Promise<string | null> {
  if (!browser) return null;

  console.log('[NWC Restore] Starting restore for pubkey:', pubkey.slice(0, 8) + '...');

  // Check that we have decryption support
  if (!hasEncryptionSupport()) {
    throw new Error(
      'No decryption method available. Please ensure you are logged in with a signer.'
    );
  }

  // Fetch backup event from relays using NDK
  const { ndk, ndkReady } = await import('$lib/nostr');
  const { get } = await import('svelte/store');

  console.log('[NWC Restore] Waiting for NDK ready...');
  await ndkReady;
  const ndkInstance = get(ndk);
  console.log('[NWC Restore] NDK ready, connected relays:', ndkInstance.pool?.relays?.size || 0);

  // Query for the backup event
  const filter = {
    kinds: [NWC_BACKUP_EVENT_KIND],
    authors: [pubkey],
    '#d': [NWC_BACKUP_D_TAG]
  };
  console.log('[NWC Restore] Fetching with filter:', JSON.stringify(filter));

  // Fetch with timeout
  const fetchStart = Date.now();
  const events = await ndkInstance.fetchEvents(filter, { closeOnEose: true });
  console.log(
    '[NWC Restore] Fetch completed in',
    Date.now() - fetchStart,
    'ms, found',
    events?.size || 0,
    'events'
  );

  if (!events || events.size === 0) {
    console.log('[NWC Restore] No backup found on Nostr relays');
    return null;
  }

  // Get the most recent backup
  let latestEvent: any = null;
  for (const event of events) {
    if (!latestEvent || event.created_at! > latestEvent.created_at!) {
      latestEvent = event;
    }
  }

  console.log('[NWC Restore] Latest event:', {
    id: latestEvent?.id?.slice(0, 8),
    created_at: latestEvent?.created_at,
    contentLength: latestEvent?.content?.length,
    tags: latestEvent?.tags
  });

  if (!latestEvent || !latestEvent.content) {
    console.warn('[NWC Restore] Backup event found but has no content');
    return null;
  }

  // Determine encryption method from event tags, or detect from ciphertext format
  const encryptionTag = latestEvent.tags?.find((t: string[]) => t[0] === 'encryption');
  let encryptionMethod: EncryptionMethod;
  if (encryptionTag?.[1] === 'nip04' || encryptionTag?.[1] === 'nip44') {
    encryptionMethod = encryptionTag[1] as EncryptionMethod;
  } else {
    encryptionMethod = detectEncryptionMethod(latestEvent.content);
  }
  console.log('[NWC Restore] Encryption method:', encryptionMethod);

  // Helper to add timeout to decrypt operations
  const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))
    ]);
  };

  // Decrypt the connection string using unified encryption service
  const DECRYPT_TIMEOUT = 15000;

  console.log('[NWC Restore] Starting decryption with', encryptionMethod, '...');
  const decryptStart = Date.now();

  const connectionString = await withTimeout(
    decrypt(pubkey, latestEvent.content, encryptionMethod),
    DECRYPT_TIMEOUT,
    'Decryption timed out. Please approve the request in your signer app.'
  );

  console.log('[NWC Restore] Decryption completed in', Date.now() - decryptStart, 'ms');
  console.log('[NWC Restore] Decrypted string length:', connectionString?.length);

  if (!connectionString) {
    throw new Error('Failed to decrypt backup. Make sure you are using the same Nostr key.');
  }

  // Validate it looks like an NWC connection string
  const isValidNwc =
    connectionString.includes('nostr+walletconnect') ||
    connectionString.includes('nostrwalletconnect');
  console.log('[NWC Restore] Is valid NWC URL:', isValidNwc);

  if (!isValidNwc) {
    console.error('[NWC Restore] Invalid content preview:', connectionString.slice(0, 50));
    throw new Error('Decrypted data does not appear to be a valid NWC connection string.');
  }

  console.log('[NWC Restore] Successfully restored NWC connection from Nostr backup');
  return connectionString;
}

export async function hasNwcBackupInNostr(pubkey: string): Promise<boolean> {
  if (!browser) return false;

  try {
    const { ndk, ndkReady } = await import('$lib/nostr');
    const { get } = await import('svelte/store');

    await ndkReady;
    const ndkInstance = get(ndk);

    const filter = {
      kinds: [NWC_BACKUP_EVENT_KIND],
      authors: [pubkey],
      '#d': [NWC_BACKUP_D_TAG]
    };

    const events = await ndkInstance.fetchEvents(filter, { closeOnEose: true });
    return !!events && events.size > 0;
  } catch (error) {
    console.warn('[NWC Backup] Failed to check backup status:', error);
    return false;
  }
}

/**
 * Check if an NWC backup exists on Nostr relays.
 * @param pubkey The user's Nostr public key.
 * @returns True if a backup exists, false otherwise.
 */
export async function hasNwcBackupOnNostr(pubkey: string): Promise<boolean> {
  if (!browser) return false;

  try {
    const { ndk, ndkReady } = await import('$lib/nostr');
    const { get } = await import('svelte/store');

    await ndkReady;
    const ndkInstance = get(ndk);

    const filter = {
      kinds: [NWC_BACKUP_EVENT_KIND],
      authors: [pubkey],
      '#d': [NWC_BACKUP_D_TAG]
    };

    const events = await ndkInstance.fetchEvents(filter, { closeOnEose: true });
    return events && events.size > 0;
  } catch (e) {
    console.error('[NWC Backup] Error checking for backup:', e);
    return false;
  }
}

/**
 * Relay backup status result
 */
export interface RelayBackupStatus {
  relay: string;
  hasBackup: boolean;
  timestamp?: number;
  error?: string;
}

/**
 * Check which relays have a backup of the NWC connection.
 * Queries each relay individually to determine backup status.
 * @param pubkey The user's Nostr public key.
 * @returns Array of relay backup statuses.
 */
export async function checkRelayBackups(pubkey: string): Promise<RelayBackupStatus[]> {
  if (!browser) return [];

  const { ndk, ndkReady, relays } = await import('$lib/nostr');
  const { standardRelays } = await import('$lib/consts');
  const { get } = await import('svelte/store');
  const { NDKRelaySet } = await import('@nostr-dev-kit/ndk');

  await ndkReady;
  const ndkInstance = get(ndk);

  // Use the user's explicitly configured relays (from localStorage or defaults)
  const relaysToCheck: string[] = Array.isArray(relays)
    ? relays.filter((r: unknown): r is string => typeof r === 'string')
    : standardRelays;

  if (relaysToCheck.length === 0) {
    console.warn('[NWC Backup] No relays configured');
    return [];
  }

  console.log(`[NWC Backup] Checking backup status on ${relaysToCheck.length} relays...`);

  // Query each relay individually in parallel
  const checkPromises = relaysToCheck.map(async (relayUrl): Promise<RelayBackupStatus> => {
    try {
      // Create a filter for the backup event
      const filter = {
        kinds: [NWC_BACKUP_EVENT_KIND],
        authors: [pubkey],
        '#d': [NWC_BACKUP_D_TAG]
      };

      // Create a relay set for this specific relay
      const relaySet = NDKRelaySet.fromRelayUrls([relayUrl], ndkInstance, true);

      // Fetch from this specific relay with timeout
      const events = await Promise.race([
        ndkInstance.fetchEvents(filter, { closeOnEose: true }, relaySet),
        new Promise<Set<any>>((resolve) => setTimeout(() => resolve(new Set()), 8000))
      ]);

      if (events && events.size > 0) {
        // Get the most recent event
        let latestEvent: any = null;
        for (const event of events) {
          if (!latestEvent || event.created_at! > latestEvent.created_at!) {
            latestEvent = event;
          }
        }

        return {
          relay: relayUrl,
          hasBackup: true,
          timestamp: latestEvent?.created_at ? latestEvent.created_at * 1000 : undefined
        };
      } else {
        return {
          relay: relayUrl,
          hasBackup: false
        };
      }
    } catch (error) {
      console.warn(`[NWC Backup] Failed to check backup on ${relayUrl}: ${String(error)}`);
      return {
        relay: relayUrl,
        hasBackup: false,
        error: 'Connection failed'
      };
    }
  });

  const results = await Promise.all(checkPromises);
  const backupCount = results.filter((r) => r.hasBackup).length;
  console.log(`[NWC Backup] Found backups on ${backupCount} of ${results.length} relays`);

  return results;
}

/**
 * Delete NWC wallet backup from Nostr relays.
 * Publishes an empty replaceable event to overwrite the backup (more reliable than NIP-09).
 * @param pubkey The user's Nostr public key.
 */
export async function deleteBackupFromNostr(pubkey: string): Promise<void> {
  if (!browser) throw new Error('Backup deletion can only be performed in browser');

  const { ndk, ndkReady } = await import('$lib/nostr');
  const { NDKEvent } = await import('@nostr-dev-kit/ndk');
  const { get } = await import('svelte/store');

  await ndkReady;
  const ndkInstance = get(ndk);

  console.log('[NWC Backup] Deleting backup by publishing empty replacement...');

  // Create an empty replaceable event with the same d-tag to overwrite the backup
  // This is more reliable than NIP-09 deletion since relays must replace the old event
  const ndkEvent = new NDKEvent(ndkInstance);
  ndkEvent.kind = NWC_BACKUP_EVENT_KIND;
  ndkEvent.content = ''; // Empty content - no backup data
  ndkEvent.tags = [
    ['d', NWC_BACKUP_D_TAG],
    ['deleted', 'true']
  ];

  // Sign using NDK (works with any signer type)
  console.log('[NWC Backup] Signing empty backup event...');
  await ndkEvent.sign();

  console.log('[NWC Backup] Publishing empty backup to overwrite existing...');
  await ndkEvent.publish();

  console.log('[NWC Backup] Backup deleted (replaced with empty event)');
}
