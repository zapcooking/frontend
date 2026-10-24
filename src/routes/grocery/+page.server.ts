import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Grocery lives inside the My Kitchen hub now — redirect for backward compatibility
  throw redirect(301, '/my-kitchen/grocery');
};
