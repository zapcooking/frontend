import { redirect, type RequestHandler } from '@sveltejs/kit';

/**
 * The NIP-108 "premium recipes" experiment is retired. Links to /premium
 * were shared on Nostr while it ran, so send them to the recipe index
 * rather than a 404.
 */
export const GET: RequestHandler = () => {
  redirect(301, '/recipes');
};
