/**
 * Membership Route Guard
 * 
 * Returns 404 when membership is disabled via MEMBERSHIP_ENABLED environment variable.
 * This gate ensures membership pages are inaccessible until explicitly enabled.
 *
 * Local development: a 404 on /membership almost always means this flag is
 * unset in `.env`. Set `MEMBERSHIP_ENABLED=true` (this route + the
 * membership API) and `PUBLIC_MEMBERSHIP_ENABLED=true` (client-side Cook+
 * discovery modal). See the MEMBERSHIP CONFIGURATION block in `.env.example`.
 */

import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ platform }) => {
  // Cloudflare uses platform.env, local dev uses $env
  const MEMBERSHIP_ENABLED = platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED;
  
  // Return 404 when membership is not enabled
  if (MEMBERSHIP_ENABLED?.toLowerCase() !== 'true') {
    throw error(404, 'Not found');
  }
  
  return {};
};

