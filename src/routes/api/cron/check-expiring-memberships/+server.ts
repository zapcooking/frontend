/**
 * Cron Job: Check Expiring Memberships
 * 
 * This endpoint should be called periodically (e.g., daily) to check for
 * memberships expiring soon and send Nostr DMs to notify users.
 * 
 * For Cloudflare Workers, add this to wrangler.toml:
 * 
 * [[triggers.crons]]
 * cron = "0 10 * * *"  # Daily at 10:00 UTC
 * 
 * GET /api/cron/check-expiring-memberships
 * 
 * Headers:
 * Authorization: Bearer <CRON_SECRET> (optional, for security)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import NDK from '@nostr-dev-kit/ndk';
import { processExpiringMemberships } from '$lib/membershipNotificationService';

export const GET: RequestHandler = async ({ request, platform }) => {
  // Optional: Require a cron secret for security
  const CRON_SECRET = platform?.env?.CRON_SECRET || env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  
  if (CRON_SECRET) {
    const expectedAuth = `Bearer ${CRON_SECRET}`;
    if (authHeader !== expectedAuth) {
      return json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
  }

  // Check if membership notifications are enabled
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED !== 'true') {
    return json(
      { error: 'Membership notifications disabled' },
      { status: 403 }
    );
  }

  try {
    // Get required environment variables
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    if (!API_SECRET) {
      throw new Error('RELAY_API_SECRET not configured');
    }

    // Get the private key for sending DMs
    // This should be a dedicated service account key for sending membership notifications
    // Can be provided as:
    // - Hex private key (64 characters): "abc123..."
    // - nsec (bech32 encoded): "nsec1..."
    let NOTIFICATION_PRIVATE_KEY = platform?.env?.NOTIFICATION_PRIVATE_KEY || env.NOTIFICATION_PRIVATE_KEY;
    if (!NOTIFICATION_PRIVATE_KEY) {
      throw new Error('NOTIFICATION_PRIVATE_KEY not configured');
    }

    // If provided as nsec, decode it to hex
    if (NOTIFICATION_PRIVATE_KEY.startsWith('nsec1')) {
      try {
        const { nip19 } = await import('nostr-tools');
        const decoded = nip19.decode(NOTIFICATION_PRIVATE_KEY);
        // Convert Uint8Array to hex string
        const dataArray = Array.from(decoded.data as Uint8Array);
        NOTIFICATION_PRIVATE_KEY = dataArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (error) {
        throw new Error('Invalid nsec format: ' + (error as Error).message);
      }
    }

    // Validate private key format (should be 64 character hex string)
    if (!/^[0-9a-fA-F]{64}$/.test(NOTIFICATION_PRIVATE_KEY)) {
      throw new Error('Invalid NOTIFICATION_PRIVATE_KEY format - must be 64 hex characters or nsec');
    }

    // Initialize NDK for sending DMs
    // Use a minimal relay set for sending DMs
    const ndk = new NDK({
      explicitRelayUrls: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://purplepag.es'
      ]
    });
    
    await ndk.connect();

    // Process expiring memberships (default: 7 days ahead)
    const daysAhead = 7;
    const result = await processExpiringMemberships(
      ndk,
      API_SECRET,
      NOTIFICATION_PRIVATE_KEY,
      daysAhead
    );

    return json({
      success: true,
      timestamp: new Date().toISOString(),
      daysAhead,
      notificationsSent: result.sent,
      notificationsFailed: result.failed,
      totalExpiring: result.sent + result.failed,
      errors: result.errors.length > 0 ? result.errors : undefined
    });

  } catch (error: any) {
    console.error('[Cron] Error checking expiring memberships:', error);
    
    return json(
      {
        success: false,
        error: error.message || 'Failed to check expiring memberships',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
};

// Also support POST for manual triggers
export const POST = GET;

