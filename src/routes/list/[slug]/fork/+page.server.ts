import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  // Redirect old /list/[slug]/fork to new /cookbook/[naddr] format
  // Editing happens within the cookbook interface now
  throw redirect(301, `/cookbook/${params.slug}`);
};

