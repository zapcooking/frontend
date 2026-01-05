import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { Tier } from '../routes/membership/paymentStore';

export type MembershipTier = 'open' | 'cook' | 'pro';

export interface Membership {
  pubkey: string; // hex pubkey
  tier: MembershipTier;
  expiresAt: number; // timestamp
  purchasedAt: number; // timestamp
  paymentMethod: 'bitcoin' | 'card';
  invoiceId?: string;
}

interface MembershipData {
  [pubkey: string]: Membership;
}

// Store all memberships
const storageKey = 'zapcooking_memberships';

function loadMembershipsFromStorage(): MembershipData {
  if (!browser) return {};
  
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load memberships from storage:', error);
  }
  
  return {};
}

function saveMembershipsToStorage(memberships: MembershipData): void {
  if (!browser) return;
  
  try {
    localStorage.setItem(storageKey, JSON.stringify(memberships));
  } catch (error) {
    console.error('Failed to save memberships to storage:', error);
  }
}

// Internal store
const memberships = writable<MembershipData>(loadMembershipsFromStorage());

// Subscribe to changes and persist
memberships.subscribe((data) => {
  saveMembershipsToStorage(data);
});

// Public API
export const membershipStore = {
  subscribe: memberships.subscribe,
  
  /**
   * Get membership for a specific pubkey
   */
  getMembership(pubkey: string): Membership | null {
    const data = get(memberships);
    return data[pubkey] || null;
  },
  
  /**
   * Check if a user has an active membership
   */
  hasActiveMembership(pubkey: string): boolean {
    const membership = this.getMembership(pubkey);
    if (!membership) return false;
    
    // Check if membership is expired
    return membership.expiresAt > Date.now();
  },
  
  /**
   * Get the current active tier for a user (returns 'open' if no active membership)
   */
  getActiveTier(pubkey: string): MembershipTier {
    const membership = this.getMembership(pubkey);
    if (!membership) return 'open';
    
    if (membership.expiresAt > Date.now()) {
      return membership.tier;
    }
    
    return 'open';
  },
  
  /**
   * Add or update a membership (called after payment completion)
   */
  setMembership(membership: Membership): void {
    memberships.update((data) => {
      return {
        ...data,
        [membership.pubkey]: membership
      };
    });
  },
  
  /**
   * Remove membership (for testing/admin purposes)
   */
  removeMembership(pubkey: string): void {
    memberships.update((data) => {
      const updated = { ...data };
      delete updated[pubkey];
      return updated;
    });
  },
  
  /**
   * Get all memberships (for admin/debugging)
   */
  getAllMemberships(): MembershipData {
    return get(memberships);
  }
};

/**
 * Derived store: Get membership for current user
 * Usage: $currentUserMembership (returns Membership | null)
 */
export const currentUserMembership = derived(
  [memberships],
  ([$memberships], set) => {
    // This will be updated by components that know the current user's pubkey
    set(null);
  },
  null as Membership | null
);

/**
 * Create a derived store for a specific pubkey's membership
 */
export function createMembershipStore(pubkey: string | null) {
  return derived(
    memberships,
    ($memberships) => {
      if (!pubkey) return null;
      return $memberships[pubkey] || null;
    },
    null as Membership | null
  );
}

/**
 * Create a derived store for a specific pubkey's active tier
 */
export function createTierStore(pubkey: string | null) {
  return derived(
    memberships,
    ($memberships) => {
      if (!pubkey) return 'open';
      const membership = $memberships[pubkey];
      if (!membership) return 'open';
      
      if (membership.expiresAt > Date.now()) {
        return membership.tier;
      }
      
      return 'open';
    },
    'open' as MembershipTier
  );
}

// Format membership expiry date
export function formatMembershipExpiry(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Check if membership is expiring soon (within 7 days)
export function isMembershipExpiringSoon(timestamp: number): boolean {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return timestamp - Date.now() < sevenDays && timestamp > Date.now();
}

