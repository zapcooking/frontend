import { env } from '$env/dynamic/public';
import type { LayoutServerLoad } from './$types';

export const ssr = true;

export const load: LayoutServerLoad = async () => {
  // Pass PUBLIC_MEMBERSHIP_ENABLED to client for UI gating
  return {
    membershipEnabled: env.PUBLIC_MEMBERSHIP_ENABLED || 'false'
  };
};
