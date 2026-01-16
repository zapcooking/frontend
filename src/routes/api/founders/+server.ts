import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
  // Membership feature flag guard - return 403 when disabled
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  // Cloudflare uses platform.env, local dev uses $env
  const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
  
  if (!API_SECRET) {
    console.error('RELAY_API_SECRET not configured');
    return json({ error: 'Server configuration error' }, { status: 500 });
  }

  try {
    const res = await fetch('https://pantry.zap.cooking/api/members', {
      headers: {
        'Authorization': `Bearer ${API_SECRET}`
      }
    });

    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const data = await res.json();

    // Filter genesis founders and sort by creation date
    const founders = data.members
      .filter((m: any) => m.payment_id?.startsWith('founder'))
      .sort((a: any, b: any) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      .map((m: any, index: number) => ({
        number: index + 1,
        pubkey: m.pubkey,
        tier: m.tier,
        joined: m.created_at,
        subscriptionEnd: m.subscription_end
      }));

    return json({ 
      founders,
      total: founders.length 
    });

  } catch (err) {
    console.error('Failed to fetch founders:', err);
    return json({ error: 'Failed to fetch founders' }, { status: 500 });
  }
};

