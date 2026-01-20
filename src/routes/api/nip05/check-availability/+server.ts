/**
 * Check NIP-05 Username Availability
 * 
 * Checks if a username is available for NIP-05 registration at @zap.cooking
 * 
 * GET /api/nip05/check-availability?username=<username>
 * 
 * Returns:
 * {
 *   available: boolean,
 *   username: string,
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

export const GET: RequestHandler = async ({ url, platform }) => {
  // Membership feature flag guard
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const username = url.searchParams.get('username')?.trim().toLowerCase();
    
    if (!username) {
      return json(
        { available: false, error: 'Username is required' },
        { status: 400 }
      );
    }
    
    // Validate username format (alphanumeric + underscore, 3-20 chars)
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return json({
        available: false,
        username,
        error: 'Username must be 3-20 characters (letters, numbers, underscore only)'
      });
    }
    
    // Check reserved usernames
    if (RESERVED_USERNAMES.includes(username)) {
      return json({
        available: false,
        username,
        error: 'This username is reserved'
      });
    }
    
    // Get API secret for members API
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      console.error('[NIP-05] RELAY_API_SECRET not configured');
      return json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }
    
    // Check availability with members API
    const checkRes = await fetch(`https://pantry.zap.cooking/api/nip05/check/${encodeURIComponent(username)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!checkRes.ok) {
      // If API returns 404, username is available
      if (checkRes.status === 404) {
        return json({
          available: true,
          username
        });
      }
      
      console.error('[NIP-05] Check availability API error:', checkRes.status);
      return json(
        { available: false, error: 'Failed to check availability' },
        { status: 500 }
      );
    }
    
    const data = await checkRes.json();
    
    // If API returns data, username is taken
    return json({
      available: !data.exists,
      username,
      ...(data.exists && { error: 'Username is not available' })
    });
    
  } catch (error: any) {
    console.error('[NIP-05] Error checking availability:', error);
    
    return json(
      { 
        available: false,
        error: error.message || 'Failed to check availability'
      },
      { status: 500 }
    );
  }
};
