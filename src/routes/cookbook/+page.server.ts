import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  // Cookbook is now My Kitchen — redirect for backward compatibility
  throw redirect(301, '/my-kitchen');
};
