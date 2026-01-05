import { browser } from '$app/environment';
import type { NDK } from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { profileCacheManager } from './profileCache';

/**
 * NIP-05 Service
 * Handles claiming and managing zap.cooking NIP-05 identifiers for paid members
 */

export interface Nip05Claim {
  username: string;
  pubkey: string;
  tier: 'cook' | 'pro';
  claimedAt: number;
}

/**
 * Check if a username is available
 * TODO: Replace with real API call
 */
export async function checkUsernameAvailable(username: string): Promise<boolean> {
  if (!browser) return false;
  
  // Validate username format (alphanumeric + underscore, 3-20 chars)
  if (!/^[a-z0-9_]{3,20}$/i.test(username)) {
    return false;
  }
  
  // TODO: Call backend API to check availability
  // For now, mock: assume available if meets format requirements
  await new Promise(resolve => setTimeout(resolve, 300)); // Simulate API delay
  
  return true;
}

/**
 * Claim a NIP-05 identifier for a user
 * TODO: Replace with real API call
 */
export async function claimNip05(
  username: string,
  pubkey: string,
  tier: 'cook' | 'pro'
): Promise<{ success: boolean; nip05?: string; error?: string }> {
  if (!browser) {
    return { success: false, error: 'Browser environment required' };
  }
  
  // Validate username
  if (!/^[a-z0-9_]{3,20}$/i.test(username)) {
    return { success: false, error: 'Username must be 3-20 characters (letters, numbers, underscore only)' };
  }
  
  // TODO: Call backend API to claim NIP-05
  // POST /api/nip05/claim { username, pubkey, tier }
  // Backend should:
  // 1. Verify user has active membership
  // 2. Check username availability
  // 3. Create NIP-05 mapping
  // 4. Return success
  
  // Mock implementation
  await new Promise(resolve => setTimeout(resolve, 500));
  
  const nip05 = `${username.toLowerCase()}@zap.cooking`;
  
  return {
    success: true,
    nip05
  };
}

/**
 * Update user's profile with NIP-05 identifier
 * Preserves all existing profile fields
 */
export async function updateProfileWithNip05(
  ndk: NDK,
  pubkey: string,
  nip05: string
): Promise<boolean> {
  try {
    // Fetch current profile event to preserve all fields
    const events = await ndk.fetchEvents({
      kinds: [0],
      authors: [pubkey],
      limit: 1
    });

    let currentProfile: Record<string, any> = {};
    
    if (events.size > 0) {
      // Get the latest profile event
      const latestEvent = Array.from(events).sort((a, b) =>
        (b.created_at || 0) - (a.created_at || 0)
      )[0];
      
      // Parse existing profile content
      try {
        currentProfile = JSON.parse(latestEvent.content || '{}');
      } catch (e) {
        console.warn('[NIP-05] Failed to parse existing profile, starting fresh');
        currentProfile = {};
      }
    }
    
    // Merge NIP-05 into existing profile
    const updatedProfile = {
      ...currentProfile,
      nip05: nip05
    };
    
    // Create and publish updated profile event
    const metaEvent = new NDKEvent(ndk);
    metaEvent.kind = 0;
    metaEvent.tags = [];
    metaEvent.content = JSON.stringify(updatedProfile);
    
    await metaEvent.sign();
    const publishedRelays = await metaEvent.publish();
    
    if (publishedRelays.size === 0) {
      console.error('[NIP-05] Failed to publish profile - no relays confirmed');
      return false;
    }
    
    console.log('[NIP-05] Profile updated with NIP-05, published to', publishedRelays.size, 'relays');
    
    // Invalidate profile cache so the updated profile is fetched fresh
    profileCacheManager.invalidateProfile(pubkey);
    
    return true;
  } catch (error) {
    console.error('Failed to update profile with NIP-05:', error);
    return false;
  }
}

/**
 * Validate username format
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username || username.trim().length === 0) {
    return { valid: false, error: 'Username is required' };
  }
  
  const trimmed = username.trim().toLowerCase();
  
  if (trimmed.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  
  if (trimmed.length > 20) {
    return { valid: false, error: 'Username must be 20 characters or less' };
  }
  
  if (!/^[a-z0-9_]+$/.test(trimmed)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }
  
  // Reserved usernames
  const reserved = ['admin', 'api', 'www', 'mail', 'ftp', 'localhost', 'root', 'support', 'help', 'about', 'contact'];
  if (reserved.includes(trimmed)) {
    return { valid: false, error: 'This username is reserved' };
  }
  
  return { valid: true };
}

