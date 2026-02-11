import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';

// Fixed order for first 4 Genesis Founders (npubs)
const PRIORITY_FOUNDER_NPUBS = [
  'npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq', // #1
  'npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx', // #2
  'npub1cgcwm56v5hyrrzl5ty4vq4kdud63n5u4czgycdl2r3jshzk55ufqe52ndy', // #3
  'npub1chakany8dcz93clv4xgcudcvhnfhdyqutprq2yh72daydevv8zasmuhf02' // #4
];

// Convert npubs to hex pubkeys
const PRIORITY_FOUNDERS = PRIORITY_FOUNDER_NPUBS.map((npub) => {
  try {
    const decoded = nip19.decode(npub);
    return decoded.type === 'npub' ? (decoded.data as string) : null;
  } catch {
    console.error('Failed to decode npub:', npub);
    return null;
  }
}).filter(Boolean) as string[];

// Fallback data for local development when API secret is not available
const FALLBACK_FOUNDERS = PRIORITY_FOUNDERS.map((pubkey, idx) => ({
  number: idx + 1,
  pubkey: pubkey,
  tier: 'genesis_founder',
  joined: null
}));

export const load: PageServerLoad = async ({ fetch, platform }) => {
  // Cloudflare uses platform.env, local dev uses $env
  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;

  if (!API_SECRET) {
    console.warn('RELAY_API_SECRET not found, using fallback founders data');
    return { founders: FALLBACK_FOUNDERS };
  }

  try {
    const res = await fetch('https://pantry.zap.cooking/api/members', {
      headers: {
        Authorization: `Bearer ${API_SECRET}`
      }
    });

    const data = await res.json();

    // Filter for active Genesis Founders and get only priority ones
    const allFounders = data.members
      .filter((m: any) => {
        if (m.status === 'cancelled') return false;
        const pid = m.payment_id?.toLowerCase() || '';
        return pid.startsWith('genesis_') || pid.startsWith('founder');
      })
      // Remove duplicates by pubkey
      .reduce((acc: any[], m: any) => {
        if (!acc.find((f) => f.pubkey === m.pubkey)) {
          acc.push(m);
        }
        return acc;
      }, []);

    // Helper to extract founder number from payment_id
    const extractFounderNumber = (paymentId: string): number => {
      const normalized = paymentId?.toLowerCase() || '';

      // Handle plain "founder" (with or without trailing underscore) explicitly
      if (normalized === 'founder' || normalized === 'founder_') {
        return 1;
      }

      const match = normalized.match(/(?:genesis_|founder_?)(\d+)/i);
      return match ? parseInt(match[1]) : 999;
    };

    // Separate priority founders from others
    const priorityFoundersList: any[] = [];
    const otherFoundersList: any[] = [];

    for (const member of allFounders) {
      const priorityIndex = PRIORITY_FOUNDERS.indexOf(member.pubkey);

      if (priorityIndex !== -1) {
        priorityFoundersList.push({
          priorityIndex,
          pubkey: member.pubkey,
          tier: member.tier || 'genesis_founder',
          joined: member.created_at || null
        });
      } else {
        otherFoundersList.push({
          originalNumber: extractFounderNumber(member.payment_id),
          pubkey: member.pubkey,
          tier: member.tier,
          joined: member.created_at
        });
      }
    }

    // Also include priority founders not yet in the API
    for (let i = 0; i < PRIORITY_FOUNDERS.length; i++) {
      if (!priorityFoundersList.find(f => f.pubkey === PRIORITY_FOUNDERS[i])) {
        priorityFoundersList.push({
          priorityIndex: i,
          pubkey: PRIORITY_FOUNDERS[i],
          tier: 'genesis_founder',
          joined: null
        });
      }
    }

    priorityFoundersList.sort((a, b) => a.priorityIndex - b.priorityIndex);
    otherFoundersList.sort((a, b) => a.originalNumber - b.originalNumber);

    const founders = [
      ...priorityFoundersList.map((f, idx) => ({
        number: idx + 1,
        pubkey: f.pubkey,
        tier: f.tier,
        joined: f.joined
      })),
      ...otherFoundersList.map((f) => ({
        number: f.originalNumber,
        pubkey: f.pubkey,
        tier: f.tier,
        joined: f.joined
      }))
    ];

    return { founders };
  } catch (err) {
    console.error('Failed to load founders:', err);
    return { founders: [] };
  }
};
