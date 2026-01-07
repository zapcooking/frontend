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

    const founders = data.members
      .filter((m: any) => m.payment_id?.startsWith('founder'))
      .sort((a: any, b: any) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      .map((m: any, index: number) => ({
        number: index + 1,
        pubkey: m.pubkey,
        tier: m.tier,
        joined: m.created_at
      }));

    return { founders };

  } catch (err) {
    console.error('Failed to load founders:', err);
    return { founders: [], error: 'Failed to load' };
  }
};

