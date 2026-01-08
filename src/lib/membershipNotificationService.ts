/**
 * Membership Notification Service
 * 
 * Sends Nostr DMs to users when their membership is about to expire.
 */

import NDK, { NDKEvent, NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { nip44, nip04 } from 'nostr-tools';

export interface ExpiringMember {
  pubkey: string;
  subscription_end: string;
  tier: string;
  payment_id: string;
}

/**
 * Check for memberships expiring within the specified days
 */
export async function getExpiringMemberships(
  apiSecret: string,
  daysAhead: number = 7
): Promise<ExpiringMember[]> {
  try {
    const response = await fetch('https://members.zap.cooking/api/members', {
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
        // Only check active members
        if (m.status !== 'active') return false;
        
        // Check if subscription_end exists and is within the expiration window
        if (!m.subscription_end) return false;
        
        const endDate = new Date(m.subscription_end);
        // Expires within the window AND hasn't expired yet
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
 * Send a Nostr DM (kind 4) using NIP-04 encryption (for better client compatibility)
 */
export async function sendMembershipExpirationDM(
  ndk: NDK,
  recipientPubkey: string,
  subscriptionEnd: string,
  tier: string,
  senderPrivateKey: string
): Promise<boolean> {
  try {
    // Create a signer from the private key
    // The private key should be for a service account that sends membership notifications
    const signer = new NDKPrivateKeySigner(senderPrivateKey);
    ndk.signer = signer;

    // Get recipient user
    const recipient = ndk.getUser({ pubkey: recipientPubkey });
    await recipient.fetchProfile();

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

    // Get sender pubkey
    const senderUser = await signer.user();
    const senderPubkeyHex = senderUser.hexpubkey;
    
    // Use NIP-04 for better compatibility (more widely supported than NIP-44)
    // NIP-04 format: encrypt(privkey: string, pubkey: string, plaintext: string) -> string
    const encryptedContent = await nip04.encrypt(
      senderPrivateKey,
      recipientPubkey,
      message
    );

    // Create the DM event (kind 4)
    const dmEvent = new NDKEvent(ndk);
    dmEvent.kind = 4;
    dmEvent.content = encryptedContent;
    dmEvent.tags = [['p', recipientPubkey]]; // Recipient tag
    dmEvent.created_at = Math.floor(Date.now() / 1000);
    
    // Explicitly sign the event
    await dmEvent.sign(signer);

    // Publish the event
    await dmEvent.publish();

    console.log(`[Membership Notification] Sent expiration DM to ${recipientPubkey.substring(0, 16)}...`);
    return true;
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

    // Process each expiring member
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
        
        // Add a small delay between messages to avoid rate limiting
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

