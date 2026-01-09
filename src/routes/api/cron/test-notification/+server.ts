/**
 * Test endpoint for sending membership expiration notifications to a specific npub
 * 
 * Can be used for testing on both local and production environments.
 * Requires CRON_SECRET for security when deployed.
 * 
 * GET /api/cron/test-notification?npub=<npub>
 * 
 * Local Example:
 * curl "http://localhost:5174/api/cron/test-notification?npub=npub1..."
 * 
 * Production Example:
 * curl -H "Authorization: Bearer your_cron_secret" \
 *   "https://zap.cooking/api/cron/test-notification?npub=npub1..."
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import NDK from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { sendMembershipExpirationDM } from '$lib/membershipNotificationService';

export const GET: RequestHandler = async ({ url, request, platform }) => {
  // Optional: Require a cron secret for security (same as main cron endpoint)
  const CRON_SECRET = platform?.env?.CRON_SECRET || env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  
  // Only require auth if CRON_SECRET is explicitly set and non-empty
  if (CRON_SECRET && CRON_SECRET.trim().length > 0) {
    if (!authHeader) {
      return json(
        { error: 'Authorization required. Include: Authorization: Bearer <CRON_SECRET>' },
        { status: 401 }
      );
    }
    
    const expectedAuth = `Bearer ${CRON_SECRET}`;
    if (authHeader !== expectedAuth) {
      return json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
  }

  // Get npub from query parameter
  const npub = url.searchParams.get('npub');
  if (!npub) {
    return json(
      { error: 'Missing npub parameter. Usage: ?npub=npub1...' },
      { status: 400 }
    );
  }

  // Decode npub to hex pubkey
  let recipientPubkey: string;
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') {
      return json(
        { error: 'Invalid npub format' },
        { status: 400 }
      );
    }
    recipientPubkey = decoded.data as string;
  } catch (error) {
    return json(
      { error: `Failed to decode npub: ${(error as Error).message}` },
      { status: 400 }
    );
  }

  // Get required environment variables
  let NOTIFICATION_PRIVATE_KEY = platform?.env?.NOTIFICATION_PRIVATE_KEY || env.NOTIFICATION_PRIVATE_KEY;
  if (!NOTIFICATION_PRIVATE_KEY) {
    return json(
      { error: 'NOTIFICATION_PRIVATE_KEY not configured. Add it to your .env file.' },
      { status: 500 }
    );
  }

  // If provided as nsec, decode it to hex
  if (NOTIFICATION_PRIVATE_KEY.startsWith('nsec1')) {
    try {
      const decoded = nip19.decode(NOTIFICATION_PRIVATE_KEY);
      const dataArray = Array.from(decoded.data as Uint8Array);
      NOTIFICATION_PRIVATE_KEY = dataArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      return json(
        { error: 'Invalid nsec format: ' + (error as Error).message },
        { status: 500 }
      );
    }
  }

  // Validate private key format
  if (!/^[0-9a-fA-F]{64}$/.test(NOTIFICATION_PRIVATE_KEY)) {
    return json(
      { error: 'Invalid NOTIFICATION_PRIVATE_KEY format - must be 64 hex characters or nsec' },
      { status: 500 }
    );
  }

  try {
    // Initialize NDK
    const ndk = new NDK({
      explicitRelayUrls: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://purplepag.es'
      ]
    });
    
    await ndk.connect();

    // Create a test expiration date (7 days from now)
    const testExpirationDate = new Date();
    testExpirationDate.setDate(testExpirationDate.getDate() + 7);
    const testExpirationISO = testExpirationDate.toISOString();

    // Send test notification
    const success = await sendMembershipExpirationDM(
      ndk,
      recipientPubkey,
      testExpirationISO,
      'Cook+', // Test tier
      NOTIFICATION_PRIVATE_KEY
    );

    if (success) {
      return json({
        success: true,
        message: 'Test notification sent successfully',
        recipient: {
          npub: npub,
          pubkey: recipientPubkey.substring(0, 16) + '...'
        },
        testExpirationDate: testExpirationISO,
        timestamp: new Date().toISOString()
      });
    } else {
      return json(
        {
          success: false,
          error: 'Failed to send notification (check console for details)',
          recipient: {
            npub: npub,
            pubkey: recipientPubkey.substring(0, 16) + '...'
          }
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('[Test Notification] Error:', error);
    return json(
      {
        success: false,
        error: error.message || 'Failed to send test notification',
        recipient: {
          npub: npub,
          pubkey: recipientPubkey.substring(0, 16) + '...'
        }
      },
      { status: 500 }
    );
  }
};
