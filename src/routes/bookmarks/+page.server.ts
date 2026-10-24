import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Redirect to new My Kitchen route for backward compatibility
  throw redirect(301, '/my-kitchen');
};

