import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
  throw redirect(308, `/membership/success/pro-kitchen${url.search}`);
};
