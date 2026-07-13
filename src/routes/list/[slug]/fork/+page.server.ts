import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  // Redirect old /list/[slug]/fork to new /my-kitchen/[naddr] format
  // Editing happens within the My Kitchen interface now
  throw redirect(301, `/my-kitchen/${params.slug}`);
};

