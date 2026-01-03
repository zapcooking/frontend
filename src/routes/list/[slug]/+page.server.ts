import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  // Redirect old /list/[slug] to new /cookbook/[naddr] format
  // The slug is typically already an naddr, so we can redirect directly
  throw redirect(301, `/cookbook/${params.slug}`);
};

