/**
 * Membership Feature Flag Helpers
 * 
 * Provides utilities for checking if membership features are enabled.
 * This allows membership code to exist on main but remain inaccessible
 * until explicitly enabled via environment variables.
 * 
 * Client-side: Use PUBLIC_MEMBERSHIP_ENABLED
 * Server-side: Use MEMBERSHIP_ENABLED
 */

/**
 * Check if membership is enabled on the client side.
 * Uses PUBLIC_MEMBERSHIP_ENABLED from $env/dynamic/public
 * 
 * @param membershipEnabled - The value of PUBLIC_MEMBERSHIP_ENABLED
 * @returns true if PUBLIC_MEMBERSHIP_ENABLED === 'true', false otherwise
 */
export function isMembershipEnabledClient(membershipEnabled?: string): boolean {
  return membershipEnabled === 'true';
}

