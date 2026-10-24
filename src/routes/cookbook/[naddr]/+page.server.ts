import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  // Cookbook is now My Kitchen — redirect old collection links, preserving the naddr
  throw redirect(301, `/my-kitchen/${params.naddr}`);
};
