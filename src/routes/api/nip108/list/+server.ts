/**
 * List Gated Recipes
 * 
 * GET /api/nip108/list
 * 
 * Returns a list of all stored gated recipes (metadata only)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getAllGatedContentMeta } from '$lib/nip108/server-store';

export const GET: RequestHandler = async () => {
  try {
    const recipes = getAllGatedContentMeta();
    
    return json({
      recipes,
      count: recipes.length
    });
    
  } catch (error) {
    console.error('[NIP-108 List] Error:', error);
    return json(
      { error: 'Failed to list gated recipes' },
      { status: 500 }
    );
  }
};
