import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Redirect to cookbook - editing happens within the cookbook interface now
  throw redirect(301, '/cookbook');
};

