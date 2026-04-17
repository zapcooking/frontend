import { error } from '@sveltejs/kit';
import { isTierSlug } from '$lib/membership/tiers';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  if (!isTierSlug(params.tier)) {
    throw error(404, 'Membership tier not found');
  }
  return { tierSlug: params.tier };
};
