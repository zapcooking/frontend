import { redirect, type RequestHandler } from '@sveltejs/kit';

/**
 * Compatibility redirect for links minted while the NIP-108 "premium
 * recipes" experiment ran. /premium/recipe/<naddr> took the same slug
 * /recipe/<naddr> does, and kind-35000 recipes still render there.
 */
export const GET: RequestHandler = ({ params }) => {
  redirect(301, `/recipe/${params.slug}`);
};
