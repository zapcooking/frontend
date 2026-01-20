import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';

// Fixed order for first 4 Genesis Founders (npubs)
const PRIORITY_FOUNDER_NPUBS = [
  'npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq', // #1
  'npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx', // #2
  'npub1cgcwm56v5hyrrzl5ty4vq4kdud63n5u4czgycdl2r3jshzk55ufqe52ndy', // #3
  'npub1chakany8dcz93clv4xgcudcvhnfhdyqutprq2yh72daydevv8zasmuhf02'  // #4
];

// Convert npubs to hex pubkeys
const PRIORITY_FOUNDERS = PRIORITY_FOUNDER_NPUBS.map(npub => {
  try {
    const decoded = nip19.decode(npub);
    return decoded.type === 'npub' ? decoded.data as string : null;
  } catch {
    console.error('Failed to decode npub:', npub);
    return null;
  }
}).filter(Boolean) as string[];

export const load: PageServerLoad = async ({ fetch, platform }) => {
  // Cloudflare uses platform.env, local dev uses $env
  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;

  if (!API_SECRET) {
    console.error('RELAY_API_SECRET not found');
    return { founders: [] };
  }

  try {
    const res = await fetch('https://pantry.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`
      }
    });

    const data = await res.json();

    // Filter for Genesis Founders and get only priority ones
    const allFounders = data.members
      .filter((m: any) => {
        const pid = m.payment_id?.toLowerCase() || '';
        return pid.startsWith('genesis_') || pid.startsWith('founder');
      })
      // Remove duplicates by pubkey
      .reduce((acc: any[], m: any) => {
        if (!acc.find(f => f.pubkey === m.pubkey)) {
          acc.push(m);
        }
        return acc;
      }, []);

    // Build list with only priority founders in order
    // Always return all 4 priority founders, even if not in API response
    const founders = PRIORITY_FOUNDERS.map((pubkey, idx) => {
      // Find this pubkey in the API response
      const member = allFounders.find((m: any) => m.pubkey === pubkey);
      
      return {
        number: idx + 1, // #1, #2, #3, #4
        pubkey: pubkey,
        tier: member?.tier || 'genesis_founder',
        joined: member?.created_at || null
      };
    }).filter(f => f && f.pubkey); // Filter out any that failed to decode

    return { founders };

  } catch (err) {
    console.error('Failed to load founders:', err);
    return { founders: [] };
  }
};
