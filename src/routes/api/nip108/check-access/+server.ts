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
import { getGatedContent, hasPaid } from '$lib/nip108/server-store';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const gatedNoteId = url.searchParams.get('g');
    const userPubkey = url.searchParams.get('p');
    
    if (!gatedNoteId || !userPubkey) {
      return json(
        { error: 'Missing required parameters: g (gatedNoteId), p (userPubkey)' },
        { status: 400 }
      );
    }
    
    // Check if user has paid
    if (!hasPaid(gatedNoteId, userPubkey)) {
      return json({
        hasAccess: false
      });
    }
    
    // Get the gated content
    const content = getGatedContent(gatedNoteId);
    
    if (!content) {
      return json(
        { error: 'Gated content not found' },
        { status: 404 }
      );
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
