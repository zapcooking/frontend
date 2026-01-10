import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, platform }) => {
  // Cloudflare uses platform.env, local dev uses $env
  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;

  if (!API_SECRET) {
    console.error('RELAY_API_SECRET not found');
    return { founders: [], error: 'Not configured' };
  }

  try {
    const res = await fetch('https://members.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`
      }
    });

    const data = await res.json();

    // Helper to extract founder number from payment_id
    const extractFounderNumber = (paymentId: string): number => {
      // Handle both 'genesis_X' and 'founder_X' formats
      const match = paymentId?.match(/(?:genesis_|founder_?)(\d+)/i);
      return match ? parseInt(match[1]) : 999;
    };

    // Filter for Genesis Founders (both 'genesis_' and 'founder' prefixes)
    const founders = data.members
      .filter((m: any) => {
        const pid = m.payment_id?.toLowerCase() || '';
        return pid.startsWith('genesis_') || pid.startsWith('founder');
      })
      // Remove duplicates by pubkey (keep the one with lowest founder number)
      .reduce((acc: any[], m: any) => {
        const existing = acc.find(f => f.pubkey === m.pubkey);
        if (!existing) {
          acc.push(m);
        } else {
          // Keep the one with lower founder number
          const existingNum = extractFounderNumber(existing.payment_id);
          const newNum = extractFounderNumber(m.payment_id);
          if (newNum < existingNum) {
            const idx = acc.indexOf(existing);
            acc[idx] = m;
          }
        }
        return acc;
      }, [])
      .sort((a: any, b: any) => {
        // Sort by founder number
        return extractFounderNumber(a.payment_id) - extractFounderNumber(b.payment_id);
      })
      .map((m: any, index: number) => {
        // Use sequential numbering (1, 2, 3...) based on sorted order
        return {
          number: index + 1,
          pubkey: m.pubkey,
          tier: m.tier,
          joined: m.created_at
        };
      });

    return { founders };

  } catch (err) {
    console.error('Failed to load founders:', err);
    return { founders: [], error: 'Failed to load' };
  }
};

