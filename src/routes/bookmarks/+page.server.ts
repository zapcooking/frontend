import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Redirect to new cookbook route for backward compatibility
  throw redirect(301, '/cookbook');
};

