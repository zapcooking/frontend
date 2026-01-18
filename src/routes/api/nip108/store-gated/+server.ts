/**
 * Store Gated Recipe Content
 * 
 * POST /api/nip108/store-gated
 * 
 * Stores encrypted recipe content for Lightning-gated access.
 * This is server-side storage since most relays don't support NIP-108 kinds.
 * 
 * Body:
 * {
 *   gatedNoteId: string,
 *   encryptedContent: string,
 *   iv: string,
 *   secret: string,
 *   costMsats: number,
 *   endpoint: string,
 *   preview: string,
 *   title: string,
 *   authorPubkey: string
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { getGatedContent, storeGatedContent, hasGatedContent } from '$lib/nip108/server-store';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const {
      gatedNoteId,
      encryptedContent,
      iv,
      secret,
      costMsats,
      endpoint,
      preview,
      title,
      authorPubkey,
      authorLightningAddress,
      naddr,
      image
    } = body;
    
    // Validate required fields
    if (!gatedNoteId || !encryptedContent || !iv || !secret || !costMsats || !authorPubkey) {
      return json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Check if gatedNoteId already exists
    if (hasGatedContent(gatedNoteId)) {
      return json(
        { error: 'Gated note ID already exists' },
        { status: 409 }
      );
    }
    
    // Store the gated content
    storeGatedContent(gatedNoteId, {
      encryptedContent,
      iv,
      secret,
      costMsats,
      endpoint: endpoint || '',
      preview: preview || '',
      title: title || 'Recipe',
      authorPubkey,
      authorLightningAddress: authorLightningAddress || '',
      naddr: naddr || '',
      image: image || ''
    });
    
    console.log(`[NIP-108] Stored gated content: ${gatedNoteId} (${title}) - ${costMsats} mSats`);
    
    return json({
      success: true,
      gatedNoteId
    });
    
  } catch (error) {
    console.error('[NIP-108 Store Gated] Error:', error);
    return json(
      { error: 'Failed to store gated content' },
      { status: 500 }
    );
  }
};

/**
 * PATCH /api/nip108/store-gated
 * 
 * Update gated recipe metadata (e.g., add naddr after publishing)
 */
export const PATCH: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { gatedNoteId, naddr } = body;
    
    if (!gatedNoteId) {
      return json({ error: 'Missing gatedNoteId' }, { status: 400 });
    }
    
    const content = getGatedContent(gatedNoteId);
    if (!content) {
      return json({ error: 'Gated content not found' }, { status: 404 });
    }
    
    // Update the naddr
    if (naddr) {
      content.naddr = naddr;
    }
    
    console.log(`[NIP-108] Updated gated content: ${gatedNoteId} with naddr: ${naddr}`);
    
    return json({ success: true });
    
  } catch (error) {
    console.error('[NIP-108 Update Gated] Error:', error);
    return json({ error: 'Failed to update gated content' }, { status: 500 });
  }
};

/**
 * GET /api/nip108/store-gated?id=<gatedNoteId>
 * 
 * Get public info about a gated recipe (for display before payment)
 */
export const GET: RequestHandler = async ({ url }) => {
  try {
    const gatedNoteId = url.searchParams.get('id');
    
    if (!gatedNoteId) {
      return json(
        { error: 'Missing gatedNoteId parameter' },
        { status: 400 }
      );
    }
    
    const content = getGatedContent(gatedNoteId);
    
    if (!content) {
      return json(
        { error: 'Gated content not found' },
        { status: 404 }
      );
    }
    
    // Return public info only (not the secret or encrypted content)
    return json({
      gatedNoteId,
      costMsats: content.costMsats,
      preview: content.preview,
      title: content.title,
      authorPubkey: content.authorPubkey,
      naddr: content.naddr,
      image: content.image
    });
    
  } catch (error) {
    console.error('[NIP-108 Get Gated Info] Error:', error);
    return json(
      { error: 'Failed to get gated content info' },
      { status: 500 }
    );
  }
};
