/**
* Membership Notification Service
*
* Sends Nostr DMs to users when their membership is about to expire.
*/

import NDK, { NDKEvent, NDKPrivateKeySigner, NDKRelaySet } from '@nostr-dev-kit/ndk';
import { nip04 } from 'nostr-tools';

export interface ExpiringMember {
  pubkey: string;
  subscription_end: string;
  tier: string;
  payment_id: string;
}

// Reliable relays for DM delivery
const DM_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social',
  'wss://purplepag.es'
];

/**
* Check for memberships expiring within the specified days
*/
export async function getExpiringMemberships(
  apiSecret: string,
  daysAhead: number = 7
): Promise<ExpiringMember[]> {
  try {
    const response = await fetch('https://pantry.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${apiSecret}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch members: ${response.status}`);
    }

    const data = await response.json();
    const now = new Date();
    const expirationDate = new Date();
    expirationDate.setDate(now.getDate() + daysAhead);

    const expiringMembers = data.members
      ?.filter((m: any) => {
        if (m.status !== 'active') return false;
        if (!m.subscription_end) return false;
        
        const endDate = new Date(m.subscription_end);
        return endDate >= now && endDate <= expirationDate;
      })
      .map((m: any) => ({
        pubkey: m.pubkey,
        subscription_end: m.subscription_end,
        tier: m.tier,
        payment_id: m.payment_id
      })) || [];

    return expiringMembers;
  } catch (error) {
    console.error('[Membership Notification] Error fetching expiring memberships:', error);
    throw error;
  }
}

/**
* Wait for at least one relay to be connected
*/
async function waitForRelayConnection(ndk: NDK, timeoutMs: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const connectedRelays = Array.from(ndk.pool.relays.values()).filter(
      (relay) => relay.status === 1 // NDKRelayStatus.CONNECTED
    );
    
    if (connectedRelays.length > 0) {
      console.log(`[Membership Notification] Connected to ${connectedRelays.length} relays`);
      return true;
    }
    
    // Wait 100ms before checking again
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return false;
}

/**
* Send a Nostr DM (kind 4) using NIP-04 encryption
*/
export async function sendMembershipExpirationDM(
  ndk: NDK,
  recipientPubkey: string,
  subscriptionEnd: string,
  tier: string,
  senderPrivateKey: string
): Promise<boolean> {
  try {
    const signer = new NDKPrivateKeySigner(senderPrivateKey);
    ndk.signer = signer;

    // Wait for relay connections
    const connected = await waitForRelayConnection(ndk, 5000);
    if (!connected) {
      console.error('[Membership Notification] No relays connected after timeout');
      // Continue anyway - publish might still work
    }

    // Format the message
    const endDate = new Date(subscriptionEnd);
    const daysUntilExpiry = Math.ceil(
      (endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    
    const formattedDate = endDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    
    const message = `⚡ Your Zap Cooking membership is due for renewal in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}
(${formattedDate})
Renew to continue your Zap Cooking membership without interruption.
🔗 Renew here: https://zap.cooking/membership
We're glad you're cooking with us 🍳`;

    // Encrypt with NIP-04
    const encryptedContent = await nip04.encrypt(
      senderPrivateKey,
      recipientPubkey,
      message
    );

    // Create the DM event (kind 4)
    const dmEvent = new NDKEvent(ndk);
    dmEvent.kind = 4;
    dmEvent.content = encryptedContent;
    dmEvent.tags = [['p', recipientPubkey]];
    dmEvent.created_at = Math.floor(Date.now() / 1000);
    
    await dmEvent.sign(signer);

    // Try to publish to connected relays
    // Use a try-catch for each relay to be more resilient
    const connectedRelays = Array.from(ndk.pool.relays.values()).filter(
      (relay) => relay.status === 1
    );
    
    console.log(`[Membership Notification] Attempting to publish to ${connectedRelays.length} connected relays`);
    
    let publishedToAtLeastOne = false;
    const publishPromises = connectedRelays.map(async (relay) => {
      try {
        await relay.publish(dmEvent);
        console.log(`[Membership Notification] Published to ${relay.url}`);
        publishedToAtLeastOne = true;
        return true;
      } catch (err) {
        console.log(`[Membership Notification] Failed to publish to ${relay.url}:`, err);
        return false;
      }
    });
    
    await Promise.allSettled(publishPromises);
    
    if (!publishedToAtLeastOne) {
      // Fallback: try the default publish method
      console.log('[Membership Notification] Trying default publish method...');
      try {
        await dmEvent.publish();
        publishedToAtLeastOne = true;
      } catch (err) {
        console.error('[Membership Notification] Default publish also failed:', err);
      }
    }

    if (publishedToAtLeastOne) {
      console.log(`[Membership Notification] Sent expiration DM to ${recipientPubkey.substring(0, 16)}...`);
      return true;
    } else {
      console.error('[Membership Notification] Failed to publish to any relay');
      return false;
    }
  } catch (error) {
    console.error('[Membership Notification] Error sending DM:', error);
    return false;
  }
}

/**
* Process all expiring memberships and send notifications
*/
export async function processExpiringMemberships(
  ndk: NDK,
  apiSecret: string,
  senderPrivateKey: string,
  daysAhead: number = 7
): Promise<{ sent: number; failed: number; errors: string[] }> {
  try {
    const expiringMembers = await getExpiringMemberships(apiSecret, daysAhead);
    
    console.log(`[Membership Notification] Found ${expiringMembers.length} expiring memberships`);

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const member of expiringMembers) {
      try {
        const success = await sendMembershipExpirationDM(
          ndk,
          member.pubkey,
          member.subscription_end,
          member.tier,
          senderPrivateKey
        );
        
        if (success) {
          sent++;
        } else {
          failed++;
          errors.push(`Failed to send DM to ${member.pubkey.substring(0, 16)}...`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        failed++;
        errors.push(`Error processing ${member.pubkey.substring(0, 16)}...: ${error.message}`);
      }
    }

    return { sent, failed, errors };
  } catch (error: any) {
    console.error('[Membership Notification] Error processing expiring memberships:', error);
    throw error;
  }
}
