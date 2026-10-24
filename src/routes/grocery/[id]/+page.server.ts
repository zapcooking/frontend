import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  // Grocery lives inside the My Kitchen hub now — redirect old list links, preserving the id
  throw redirect(301, `/my-kitchen/grocery/${params.id}`);
};
