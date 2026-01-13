/**
 * Profile Backup Service
 *
 * Implements encrypted profile backup/restore using NIP-78 (Application-specific Data)
 * with NIP-04 encryption to the user's own pubkey.
 *
 * Uses kind:30078 (addressable event) with rotating d-tags to keep last 3 backups:
 * - zapcooking:profile-backup:0
 * - zapcooking:profile-backup:1
 * - zapcooking:profile-backup:2
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { get } from 'svelte/store';
import { ndk } from './nostr';
import {
  hasEncryptionSupport,
  encrypt,
  decrypt,
  type EncryptionMethod
} from './encryptionService';

// NIP-78 event kind for application-specific data
const APP_DATA_KIND = 30078;

// D-tag base identifier for profile backups (rotating slots)
const D_TAG_BASE = 'zapcooking:profile-backup';

// Legacy d-tag (for backwards compatibility)
const D_TAG_LEGACY = 'zapcooking:profile-backup';

// Number of backup slots to rotate through
const MAX_BACKUP_SLOTS = 3;

// Generate d-tag for a specific slot
function getSlotDTag(slot: number): string {
  return `${D_TAG_BASE}:${slot}`;
}

// Get all d-tags to search (includes legacy)
function getAllDTags(): string[] {
  const tags = Array.from({ length: MAX_BACKUP_SLOTS }, (_, i) => getSlotDTag(i));
  tags.push(D_TAG_LEGACY); // Include legacy for backwards compatibility
  return tags;
}

/**
 * Profile backup data structure
 */
export interface ProfileBackupData {
  version: number;
  timestamp: number;
  profile: Record<string, any>;
  eventId?: string;
}

/**
 * Check if encryption is available (for backwards compatibility)
 * @deprecated Use hasEncryptionSupport() from encryptionService instead
 */
export function hasNip04Support(): boolean {
  return hasEncryptionSupport();
}

/**
 * Encrypt data using the unified encryption service (encrypt to own pubkey)
 */
async function encryptData(data: ProfileBackupData, userPubkey: string): Promise<{ content: string; method: EncryptionMethod }> {
  if (!hasEncryptionSupport()) {
    throw new Error('No encryption method available. Encryption is supported when logged in with a private key (nsec), NIP-07 extension, or NIP-46 remote signer with encryption permissions.');
  }

  const jsonString = JSON.stringify(data);
  const result = await encrypt(userPubkey, jsonString, 'nip04'); // Profile backups use NIP-04 for compatibility
  return { content: result.ciphertext, method: result.method };
}

/**
 * Decrypt data using the unified encryption service
 */
async function decryptData(encryptedContent: string, authorPubkey: string, method: EncryptionMethod = 'nip04'): Promise<ProfileBackupData> {
  if (!hasEncryptionSupport()) {
    throw new Error('No decryption method available. Please ensure you are logged in with a signer.');
  }

  const decrypted = await decrypt(authorPubkey, encryptedContent, method);
  return JSON.parse(decrypted) as ProfileBackupData;
}

/**
 * Find the best slot to use for the next backup
 * Returns the oldest slot, or first empty slot if available
 */
async function findNextBackupSlot(
  ndkInstance: NDK,
  pubkey: string
): Promise<number> {
  const slotTimestamps: Array<{ slot: number; timestamp: number }> = [];

  // Fetch all slots
  const dTags = Array.from({ length: MAX_BACKUP_SLOTS }, (_, i) => getSlotDTag(i));

  const events = await ndkInstance.fetchEvents({
    kinds: [APP_DATA_KIND],
    authors: [pubkey],
    '#d': dTags
  });

  // Track which slots have data
  const usedSlots = new Set<number>();

  for (const event of events) {
    const dTag = event.tags.find(t => t[0] === 'd')?.[1];
    if (!dTag) continue;

    // Extract slot number from d-tag
    const slotMatch = dTag.match(/:(\d+)$/);
    if (!slotMatch) continue;

    const slot = parseInt(slotMatch[1], 10);
    usedSlots.add(slot);
    slotTimestamps.push({
      slot,
      timestamp: event.created_at || 0
    });
  }

  // If there's an empty slot, use it
  for (let i = 0; i < MAX_BACKUP_SLOTS; i++) {
    if (!usedSlots.has(i)) {
      console.log('[ProfileBackup] Using empty slot:', i);
      return i;
    }
  }

  // All slots used, find the oldest
  slotTimestamps.sort((a, b) => a.timestamp - b.timestamp);
  const oldestSlot = slotTimestamps[0]?.slot ?? 0;
  console.log('[ProfileBackup] Overwriting oldest slot:', oldestSlot);
  return oldestSlot;
}

/**
 * Backup current profile to relay storage (encrypted)
 * Uses rotating slots to keep last 3 backups
 *
 * @param ndkInstance - NDK instance to use
 * @param pubkey - User's public key
 * @param profileContent - Current profile content (kind:0 content as object)
 * @returns true if backup was successful
 */
export async function backupProfile(
  ndkInstance: NDK,
  pubkey: string,
  profileContent: Record<string, any>
): Promise<boolean> {
  console.log('[ProfileBackup] Creating backup for pubkey:', pubkey.slice(0, 8) + '...');

  try {
    // Find the best slot to use
    const slot = await findNextBackupSlot(ndkInstance, pubkey);
    const dTag = getSlotDTag(slot);

    // Create backup data
    const backupData: ProfileBackupData = {
      version: 1,
      timestamp: Date.now(),
      profile: profileContent
    };

    // Encrypt the backup data
    let content: string;
    let isEncrypted = false;
    let encryptionMethod: EncryptionMethod = null;

    if (hasEncryptionSupport()) {
      const result = await encryptData(backupData, pubkey);
      content = result.content;
      encryptionMethod = result.method;
      isEncrypted = true;
      console.log('[ProfileBackup] Data encrypted successfully with', encryptionMethod);
    } else {
      // Fallback: store unencrypted (not recommended but allows backup)
      console.warn('[ProfileBackup] Encryption not available, storing unencrypted');
      content = JSON.stringify(backupData);
    }

    // Create NIP-78 event
    const event = new NDKEvent(ndkInstance);
    event.kind = APP_DATA_KIND;
    event.content = content;
    event.tags = [
      ['d', dTag],
      ['encrypted', isEncrypted ? 'true' : 'false'],
      ...(encryptionMethod ? [['encryption', encryptionMethod]] : [])
    ];

    // Sign and publish
    await event.sign();
    const publishedRelays = await event.publish();

    console.log('[ProfileBackup] Backup published to slot', slot, 'on', publishedRelays.size, 'relays');

    // Wait briefly for relay processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    return publishedRelays.size > 0;
  } catch (error) {
    console.error('[ProfileBackup] Failed to create backup:', error);
    return false;
  }
}

/**
 * Fetch the most recent profile backup from relay
 *
 * @param ndkInstance - NDK instance to use
 * @param pubkey - User's public key
 * @returns ProfileBackupData if found, null otherwise
 */
export async function fetchProfileBackup(
  ndkInstance: NDK,
  pubkey: string
): Promise<ProfileBackupData | null> {
  console.log('[ProfileBackup] Fetching backup for pubkey:', pubkey.slice(0, 8) + '...');

  try {
    // Fetch NIP-78 events from all slots (including legacy)
    const events = await ndkInstance.fetchEvents({
      kinds: [APP_DATA_KIND],
      authors: [pubkey],
      '#d': getAllDTags()
    });

    if (!events || events.size === 0) {
      console.log('[ProfileBackup] No backups found');
      return null;
    }

    // Get the most recent event
    const eventsArray = Array.from(events);
    eventsArray.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const latestEvent = eventsArray[0];

    console.log('[ProfileBackup] Found backup from:', new Date((latestEvent.created_at || 0) * 1000).toISOString());

    // Check if encrypted
    const encryptedTag = latestEvent.tags.find(t => t[0] === 'encrypted');
    const isEncrypted = encryptedTag?.[1] === 'true';

    if (isEncrypted) {
      if (!hasEncryptionSupport()) {
        console.warn('[ProfileBackup] Backup is encrypted but decryption not available');
        return null;
      }
      // Get encryption method from tags, default to nip04 for legacy backups
      const encMethodTag = latestEvent.tags.find(t => t[0] === 'encryption');
      const method: EncryptionMethod = (encMethodTag?.[1] === 'nip44' || encMethodTag?.[1] === 'nip04')
        ? encMethodTag[1] as EncryptionMethod
        : 'nip04'; // Default to nip04 for older backups
      return await decryptData(latestEvent.content, latestEvent.pubkey, method);
    } else {
      return JSON.parse(latestEvent.content) as ProfileBackupData;
    }
  } catch (error) {
    console.error('[ProfileBackup] Failed to fetch backup:', error);
    return null;
  }
}

/**
 * List all available profile backups (with timestamps)
 *
 * @param ndkInstance - NDK instance to use
 * @param pubkey - User's public key
 * @returns Array of backup info (timestamp, eventId)
 */
export async function listProfileBackups(
  ndkInstance: NDK,
  pubkey: string
): Promise<Array<{ timestamp: number; eventId: string; createdAt: number; data?: ProfileBackupData }>> {
  console.log('[ProfileBackup] Listing backups for pubkey:', pubkey.slice(0, 8) + '...');

  try {
    // Fetch from all backup slots (including legacy)
    const events = await ndkInstance.fetchEvents({
      kinds: [APP_DATA_KIND],
      authors: [pubkey],
      '#d': getAllDTags()
    });

    if (!events || events.size === 0) {
      return [];
    }

    const backups: Array<{ timestamp: number; eventId: string; createdAt: number; data?: ProfileBackupData }> = [];

    for (const event of events) {
      try {
        const encryptedTag = event.tags.find(t => t[0] === 'encrypted');
        const isEncrypted = encryptedTag?.[1] === 'true';

        let data: ProfileBackupData;
        if (isEncrypted && hasEncryptionSupport()) {
          // Get encryption method from tags, default to nip04 for legacy backups
          const encMethodTag = event.tags.find(t => t[0] === 'encryption');
          const method: EncryptionMethod = (encMethodTag?.[1] === 'nip44' || encMethodTag?.[1] === 'nip04')
            ? encMethodTag[1] as EncryptionMethod
            : 'nip04';
          data = await decryptData(event.content, event.pubkey, method);
        } else if (!isEncrypted) {
          data = JSON.parse(event.content) as ProfileBackupData;
        } else {
          // Can't decrypt, use event created_at as timestamp
          backups.push({
            timestamp: (event.created_at || 0) * 1000,
            eventId: event.id || '',
            createdAt: event.created_at || 0
          });
          continue;
        }

        backups.push({
          timestamp: data.timestamp,
          eventId: event.id || '',
          createdAt: event.created_at || 0,
          data: data
        });
      } catch (e) {
        console.warn('[ProfileBackup] Could not parse backup event:', e);
      }
    }

    // Sort by timestamp, newest first, and limit to max slots
    backups.sort((a, b) => b.timestamp - a.timestamp);

    return backups.slice(0, MAX_BACKUP_SLOTS);
  } catch (error) {
    console.error('[ProfileBackup] Failed to list backups:', error);
    return [];
  }
}

/**
 * Restore profile from a backup
 *
 * @param ndkInstance - NDK instance to use
 * @param pubkey - User's public key
 * @param backup - The backup data to restore
 * @returns true if restore was successful
 */
export async function restoreProfileFromBackup(
  ndkInstance: NDK,
  pubkey: string,
  backup: ProfileBackupData
): Promise<boolean> {
  console.log('[ProfileBackup] Restoring profile from backup timestamp:', new Date(backup.timestamp).toISOString());

  try {
    // Create new kind:0 event with backup data
    const profileEvent = new NDKEvent(ndkInstance);
    profileEvent.kind = 0;
    profileEvent.content = JSON.stringify(backup.profile);
    profileEvent.tags = [];

    // Sign and publish
    await profileEvent.sign();
    const publishedRelays = await profileEvent.publish();

    console.log('[ProfileBackup] Profile restored, published to', publishedRelays.size, 'relays');

    return publishedRelays.size > 0;
  } catch (error) {
    console.error('[ProfileBackup] Failed to restore profile:', error);
    return false;
  }
}

/**
 * Fetch a specific backup by event ID
 *
 * @param ndkInstance - NDK instance to use
 * @param eventId - The event ID of the backup
 * @returns ProfileBackupData if found, null otherwise
 */
export async function fetchBackupById(
  ndkInstance: NDK,
  eventId: string
): Promise<ProfileBackupData | null> {
  try {
    const event = await ndkInstance.fetchEvent(eventId);

    if (!event) {
      return null;
    }

    const encryptedTag = event.tags.find(t => t[0] === 'encrypted');
    const isEncrypted = encryptedTag?.[1] === 'true';

    if (isEncrypted) {
      if (!hasEncryptionSupport()) {
        return null;
      }
      // Get encryption method from tags, default to nip04 for legacy backups
      const encMethodTag = event.tags.find(t => t[0] === 'encryption');
      const method: EncryptionMethod = (encMethodTag?.[1] === 'nip44' || encMethodTag?.[1] === 'nip04')
        ? encMethodTag[1] as EncryptionMethod
        : 'nip04';
      return await decryptData(event.content, event.pubkey, method);
    } else {
      return JSON.parse(event.content) as ProfileBackupData;
    }
  } catch (error) {
    console.error('[ProfileBackup] Failed to fetch backup by ID:', error);
    return null;
  }
}

/**
 * Helper to get the current NDK instance from the store
 */
export function getNdk(): NDK {
  return get(ndk);
}
