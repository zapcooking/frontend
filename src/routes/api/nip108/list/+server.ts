/**
 * List Gated Recipes
 * 
 * GET /api/nip108/list
 * 
 * Returns a list of all stored gated recipes (metadata only)
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getAllGatedContentMeta, type GatedKV } from '$lib/nip108/server-store';

function getKV(platform: App.Platform | undefined): GatedKV {
  return (platform?.env?.GATED_CONTENT as GatedKV) || null;
}

export const GET: RequestHandler = async ({ platform }) => {
  const kv = getKV(platform);

  try {
    const recipes = await getAllGatedContentMeta(kv);

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
