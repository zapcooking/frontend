import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Redirect to My Kitchen - list creation happens within the My Kitchen interface now
  throw redirect(301, '/my-kitchen');
};

