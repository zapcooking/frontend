/**
 * Debug Membership Status (temporary endpoint for debugging)
 * 
 * GET /api/membership/debug-status?pubkey=xxx
 * 
 * Accepts either hex pubkey or npub format
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { nip19 } from 'nostr-tools';

export const GET: RequestHandler = async ({ url, platform }) => {
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  let pubkey = url.searchParams.get('pubkey');
  
  if (!pubkey) {
    return json({ error: 'pubkey required' }, { status: 400 });
  }

  // Convert npub to hex if needed
  if (pubkey.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(pubkey);
      if (decoded.type === 'npub') {
        pubkey = decoded.data as string;
      }
    } catch (e) {
      return json({ error: 'Invalid npub format' }, { status: 400 });
    }
  }

  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
  if (!API_SECRET) {
    return json({ error: 'Server not configured' }, { status: 500 });
  }

  try {
    const memberRes = await fetch(`https://members.zap.cooking/api/members/${pubkey}`, {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    if (!memberRes.ok) {
      return json({ 
        found: false, 
        status: memberRes.status,
        message: 'Member not found or API error'
      });
    }

    const memberData = await memberRes.json();
    
    const isGenesisFounder = memberData.payment_id?.startsWith('genesis_');
    const subscriptionEnd = memberData.subscription_end ? new Date(memberData.subscription_end) : null;
    const isExpired = subscriptionEnd && subscriptionEnd < new Date();

    return json({
      found: true,
      pubkey: pubkey.substring(0, 16) + '...',
      payment_id: memberData.payment_id,
      tier: memberData.tier,
      subscription_end: memberData.subscription_end,
      isGenesisFounder,
      isExpired: isExpired && !isGenesisFounder,
      canClaimNip05: !isExpired || isGenesisFounder
    });
  } catch (error: any) {
    return json({ error: error.message }, { status: 500 });
  }
};
