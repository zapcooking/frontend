import { error } from '@sveltejs/kit';
import { TIER_CONFIGS, isTierSlug } from '$lib/membership/tiers';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  if (!isTierSlug(params.tier)) {
    throw error(404, 'Membership tier not found');
  }
  return { tier: TIER_CONFIGS[params.tier] };
};
