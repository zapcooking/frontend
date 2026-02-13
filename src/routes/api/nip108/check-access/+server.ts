/**
 * Check Access to Gated Recipe
 * 
 * GET /api/nip108/check-access?g=<gatedNoteId>&p=<userPubkey>
 * 
 * Checks if a user has paid for access to a gated recipe.
 * If access exists, returns the decrypted content.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { decrypt, hexToBuffer } from '$lib/nip108/encryption';
import { getGatedContent, hasPaid, type GatedKV } from '$lib/nip108/server-store';

function getKV(platform: App.Platform | undefined): GatedKV {
  return (platform?.env?.GATED_CONTENT as GatedKV) || null;
}

export const GET: RequestHandler = async ({ url, platform }) => {
  const kv = getKV(platform);

  try {
    const gatedNoteId = url.searchParams.get('g');
    const userPubkey = url.searchParams.get('p');

    if (!gatedNoteId || !userPubkey) {
      return json(
        { error: 'Missing required parameters: g (gatedNoteId), p (userPubkey)' },
        { status: 400 }
      );
    }

    // Get the gated content (needed for both author check and decryption)
    const content = await getGatedContent(kv, gatedNoteId);

    if (!content) {
      return json(
        { error: 'Gated content not found' },
        { status: 404 }
      );
    }

    // Author always has access to their own recipes
    const isAuthor = content.authorPubkey === userPubkey;

    // Check if user has paid (or is the author)
    if (!isAuthor && !(await hasPaid(kv, gatedNoteId, userPubkey))) {
      return json({
        hasAccess: false
      });
    }

    // Decrypt the content for the user
    try {
      const secretKey = hexToBuffer(content.secret);
      const decryptedContent = decrypt(content.iv, content.encryptedContent, secretKey);

      return json({
        hasAccess: true,
        decryptedContent
      });
    } catch (decryptError) {
      console.error('[NIP-108 Check Access] Decryption error:', decryptError);
      return json(
        { error: 'Failed to decrypt content' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('[NIP-108 Check Access] Error:', error);
    return json(
      { error: 'Failed to check access' },
      { status: 500 }
    );
  }
};
