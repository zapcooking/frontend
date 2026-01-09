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

export interface Nip05ClaimResult {
  success: boolean;
  nip05?: string;
  username?: string;
  error?: string;
}

/**
 * Check if a username is available
 */
export async function checkUsernameAvailable(username: string): Promise<boolean> {
  if (!browser) return false;
  
  const trimmed = username.trim().toLowerCase();
  
  // Validate username format (alphanumeric + underscore, 3-20 chars)
  if (!/^[a-z0-9_]{3,20}$/.test(trimmed)) {
    return false;
  }
  
  try {
    const response = await fetch(`/api/nip05/check-availability?username=${encodeURIComponent(trimmed)}`);
    
    if (!response.ok) {
      console.error('[NIP-05] Check availability error:', response.status);
      return false;
    }
    
    const data = await response.json();
    return data.available === true;
  } catch (error) {
    console.error('[NIP-05] Error checking username availability:', error);
    return false;
  }
}

/**
 * Claim a NIP-05 identifier for a user
 */
export async function claimNip05(
  username: string,
  pubkey: string,
  tier: 'cook' | 'pro'
): Promise<Nip05ClaimResult> {
  if (!browser) {
    return { success: false, error: 'Browser environment required' };
  }
  
  const trimmed = username.trim().toLowerCase();
  
  // Validate username
  if (!/^[a-z0-9_]{3,20}$/.test(trimmed)) {
    return { success: false, error: 'Username must be 3-20 characters (letters, numbers, underscore only)' };
  }
  
  try {
    const response = await fetch('/api/nip05/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: trimmed,
        pubkey,
        tier
      })
    });
    
    const data = await response.json();
    
    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Failed to claim NIP-05'
      };
    }
    
    return {
      success: true,
      nip05: data.nip05,
      username: data.username
    };
  } catch (error: any) {
    console.error('[NIP-05] Error claiming NIP-05:', error);
    return {
      success: false,
      error: error.message || 'Failed to claim NIP-05'
    };
  }
}

/**
 * Generate a suggested username from a pubkey or profile name
 */
export function generateSuggestedUsername(pubkey: string, displayName?: string): string {
  // If display name exists, try to use it
  if (displayName) {
    // Clean the display name: remove spaces, special chars, make lowercase
    const cleaned = displayName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .substring(0, 20);
    
    if (cleaned.length >= 3) {
      return cleaned;
    }
  }
  
  // Fall back to using first 8 chars of pubkey
  return pubkey.substring(0, 8).toLowerCase();
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

