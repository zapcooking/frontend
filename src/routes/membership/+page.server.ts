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
    return { founders: [], error: 'Not configured' };
  }

  try {
    const res = await fetch('https://pantry.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`
      }
    });

    const data = await res.json();

    // Filter for Genesis Founders (both 'genesis_' and 'founder' prefixes)
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

    // Helper to extract founder number from payment_id (for sorting)
    const extractFounderNumber = (paymentId: string): number => {
      const match = paymentId?.match(/(?:genesis_|founder_?)(\d+)/i);
      return match ? parseInt(match[1]) : 999;
    };

    // Separate priority founders from others
    const priorityFoundersList: any[] = [];
    const otherFoundersList: any[] = [];

    for (const member of allFounders) {
      const priorityIndex = PRIORITY_FOUNDERS.indexOf(member.pubkey);
      
      if (priorityIndex !== -1) {
        // Priority founders - store with their priority index for sorting
        priorityFoundersList.push({
          priorityIndex,
          pubkey: member.pubkey,
          tier: member.tier || 'genesis_founder',
          joined: member.created_at || null
        });
      } else {
        // Other founders - store with original number for sorting
        otherFoundersList.push({
          originalNumber: extractFounderNumber(member.payment_id),
          pubkey: member.pubkey,
          tier: member.tier,
          joined: member.created_at
        });
      }
    }

    // Sort priority founders by their index (0-3)
    priorityFoundersList.sort((a, b) => a.priorityIndex - b.priorityIndex);
    
    // Sort other founders by join date (oldest first, newest at end)
    otherFoundersList.sort((a, b) => {
      const dateA = new Date(a.joined || 0).getTime();
      const dateB = new Date(b.joined || 0).getTime();
      return dateA - dateB;
    });

    // Build final list: priority founders are #1-4, others are #5+
    const founders = [
      ...priorityFoundersList.map((f, idx) => ({
        number: idx + 1, // #1, #2, #3, #4
        pubkey: f.pubkey,
        tier: f.tier,
        joined: f.joined
      })),
      ...otherFoundersList.map((f, idx) => ({
        number: priorityFoundersList.length + idx + 1, // #5, #6, #7...
        pubkey: f.pubkey,
        tier: f.tier,
        joined: f.joined
      }))
    ];

    return { founders };

  } catch (err) {
    console.error('Failed to load founders:', err);
    return { founders: [], error: 'Failed to load' };
  }
};

