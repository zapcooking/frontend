/**
 * Permanent redirect from the retired `/onboarding` page to account
 * creation. Nothing in the app linked to it any more, but old links and
 * crawlers may still ask for it; signup lives in the sign-in overlay
 * (`/login?join=1` opens it on "Pick a name").
 */

import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	throw redirect(301, '/login?join=1');
};
