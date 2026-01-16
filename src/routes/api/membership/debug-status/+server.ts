/**
 * Debug Membership Status (temporary endpoint for debugging)
 * 
 * GET /api/membership/debug-status?pubkey=xxx
 * 
 * Accepts either hex pubkey or npub format
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Simple bech32 decoder for npub (avoids nostr-tools import issues on Cloudflare)
function decodeNpub(npub: string): string | null {
  try {
    const ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const data = npub.slice(5); // Remove 'npub1' prefix
    
    const values: number[] = [];
    for (const char of data) {
      const idx = ALPHABET.indexOf(char.toLowerCase());
      if (idx === -1) return null;
      values.push(idx);
    }
    
    // Convert from 5-bit to 8-bit
    let acc = 0;
    let bits = 0;
    const result: number[] = [];
    
    for (const value of values.slice(0, -6)) { // Exclude checksum
      acc = (acc << 5) | value;
      bits += 5;
      while (bits >= 8) {
        bits -= 8;
        result.push((acc >> bits) & 0xff);
      }
    }
    
    return result.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return null;
  }
}

export const GET: RequestHandler = async ({ url, platform }) => {
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  let pubkey = url.searchParams.get('pubkey');
  
  if (!pubkey) {
    return json({ error: 'pubkey required' }, { status: 400 });
  }

  const originalInput = pubkey;

  // Convert npub to hex if needed
  if (pubkey.startsWith('npub1')) {
    const decoded = decodeNpub(pubkey);
    if (!decoded || decoded.length !== 64) {
      return json({ 
        error: 'Invalid npub format', 
        input: originalInput,
        decoded: decoded,
        hint: 'Please provide the 64-character hex pubkey instead'
      }, { status: 400 });
    }
    pubkey = decoded;
  }

  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
  if (!API_SECRET) {
    return json({ error: 'Server not configured' }, { status: 500 });
  }

  try {
    // Show the hex pubkey being used
    const hexPubkeyUsed = pubkey;
    
    const memberRes = await fetch(`https://pantry.zap.cooking/api/members/${pubkey}`, {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    const responseText = await memberRes.text();
    
    if (!memberRes.ok) {
      return json({ 
        found: false, 
        hexPubkeyUsed: hexPubkeyUsed.substring(0, 16) + '...',
        fullHexPubkey: hexPubkeyUsed, // Show full pubkey for debugging
        apiStatus: memberRes.status,
        apiResponse: responseText,
        message: 'Member not found or API error'
      });
    }

    let memberData;
    try {
      memberData = JSON.parse(responseText);
    } catch (e) {
      return json({ error: 'Invalid JSON from API', response: responseText }, { status: 500 });
    }
    
    const isGenesisFounder = memberData.payment_id?.startsWith('genesis_');
    const subscriptionEnd = memberData.subscription_end ? new Date(memberData.subscription_end) : null;
    const isExpired = subscriptionEnd && subscriptionEnd < new Date();

    return json({
      found: true,
      hexPubkeyUsed: hexPubkeyUsed.substring(0, 16) + '...',
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
