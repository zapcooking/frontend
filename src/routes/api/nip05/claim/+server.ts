/**
 * Claim NIP-05 Username
 * 
 * Claims a NIP-05 identifier for a paid member at @zap.cooking
 * 
 * POST /api/nip05/claim
 * 
 * Body:
 * {
 *   username: string,
 *   pubkey: string,
 *   tier: 'cook' | 'pro'
 * }
 * 
 * Returns:
 * {
 *   success: boolean,
 *   nip05?: string,
 *   error?: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Reserved usernames that cannot be claimed
const RESERVED_USERNAMES = [
  'admin', 'api', 'www', 'mail', 'ftp', 'localhost', 'root', 
  'support', 'help', 'about', 'contact', 'info', 'team',
  'zapcooking', 'zap', 'cooking', 'recipes', 'recipe',
  'moderator', 'mod', 'staff', 'official', 'bot', 'system'
];

export const POST: RequestHandler = async ({ request, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { username, pubkey, tier } = body;
    
    // Validate required fields
    if (!username || !pubkey) {
      return json(
        { success: false, error: 'Username and pubkey are required' },
        { status: 400 }
      );
    }
    
    const normalizedUsername = username.trim().toLowerCase();
    
    // Validate username format
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
      return json({
        success: false,
        error: 'Username must be 3-20 characters (letters, numbers, underscore only)'
      });
    }
    
    // Check reserved usernames
    if (RESERVED_USERNAMES.includes(normalizedUsername)) {
      return json({
        success: false,
        error: 'This username is reserved'
      });
    }
    
    // Validate pubkey format
    if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
      return json(
        { success: false, error: 'Invalid pubkey format' },
        { status: 400 }
      );
    }
    
    // Validate tier
    if (tier && !['cook', 'pro'].includes(tier)) {
      return json(
        { success: false, error: 'Invalid tier' },
        { status: 400 }
      );
    }
    
    // Get API secret
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      console.error('[NIP-05] RELAY_API_SECRET not configured');
      return json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }
    
    // First verify the user has an active membership
    const memberCheckRes = await fetch(`https://pantry.zap.cooking/api/members/${pubkey}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!memberCheckRes.ok) {
      console.error('[NIP-05] Member check failed:', memberCheckRes.status);
      return json({
        success: false,
        error: 'Active membership required to claim NIP-05'
      }, { status: 403 });
    }
    
    const memberData = await memberCheckRes.json();
    
    // Genesis founders (payment_id starts with 'genesis_') have lifetime access
    const isGenesisFounder = memberData.payment_id?.startsWith('genesis_');
    const now = new Date();
    
    console.log('[NIP-05] Member data:', {
      pubkey: pubkey.substring(0, 16) + '...',
      subscription_end: memberData.subscription_end,
      subscription_end_type: typeof memberData.subscription_end,
      payment_id: memberData.payment_id,
      tier: memberData.tier,
      isGenesisFounder
    });
    
    // Check if membership is active (not expired)
    // Skip expiry check for Genesis founders (lifetime access)
    if (memberData.subscription_end && !isGenesisFounder) {
      let expiryDate: Date;
      try {
        expiryDate = new Date(memberData.subscription_end);
        
        // Validate the date was parsed correctly
        if (isNaN(expiryDate.getTime())) {
          console.error('[NIP-05] Invalid subscription_end date format:', memberData.subscription_end);
          return json({
            success: false,
            error: 'Invalid membership data format'
          }, { status: 500 });
        }
        
        const isExpired = expiryDate < now;
        
        console.log('[NIP-05] Expiry check:', {
          expiryDate: expiryDate.toISOString(),
          now: now.toISOString(),
          isExpired,
          subscription_end_raw: memberData.subscription_end
        });
        
        if (isExpired) {
          return json({
            success: false,
            error: 'Membership has expired. Please renew to claim NIP-05'
          }, { status: 403 });
        }
      } catch (e) {
        console.error('[NIP-05] Error parsing subscription_end:', e);
        return json({
          success: false,
          error: 'Error checking membership status'
        }, { status: 500 });
      }
    } else if (!memberData.subscription_end && !isGenesisFounder) {
      // No subscription_end for non-genesis member might be an issue
      console.warn('[NIP-05] No subscription_end for non-genesis member:', {
        payment_id: memberData.payment_id
      });
    }
    
    console.log('[NIP-05] Claiming NIP-05 for member:', {
      pubkey: pubkey.substring(0, 16) + '...',
      username: normalizedUsername,
      tier: tier || 'cook'
    });
    
    // Claim NIP-05 with members API
    const claimRes = await fetch('https://pantry.zap.cooking/api/nip05/claim', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: normalizedUsername,
        pubkey,
        tier: tier || 'cook'
      })
    });
    
    if (!claimRes.ok) {
      const errorText = await claimRes.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { error: errorText };
      }
      
      console.error('[NIP-05] Claim API error:', {
        status: claimRes.status,
        error: errorData
      });
      
      // Handle specific error cases
      if (claimRes.status === 409) {
        return json({
          success: false,
          error: 'Username is not available'
        });
      }
      
      return json({
        success: false,
        error: errorData.error || 'Failed to claim NIP-05'
      }, { status: claimRes.status });
    }
    
    const nip05 = `${normalizedUsername}@zap.cooking`;
    
    console.log('[NIP-05] Successfully claimed:', nip05);
    
    return json({
      success: true,
      nip05,
      username: normalizedUsername
    });
    
  } catch (error: any) {
    console.error('[NIP-05] Error claiming NIP-05:', error);
    
    return json(
      { 
        success: false,
        error: error.message || 'Failed to claim NIP-05'
      },
      { status: 500 }
    );
  }
};
