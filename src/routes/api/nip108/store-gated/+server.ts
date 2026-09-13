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
 *   title: string
 * }
 *
 * Auth: NIP-98 on POST and PATCH. The author's pubkey comes from the
 * verified auth event, never from the body.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { hasActiveMembership } from '$lib/membershipApi.server';
import { getGatedContent, storeGatedContent, hasGatedContent, updateGatedContentNaddr, type GatedKV } from '$lib/nip108/server-store';
import { verifyNip98 } from '$lib/nip98.server';

function getKV(platform: App.Platform | undefined): GatedKV {
  return (platform?.env?.GATED_CONTENT as GatedKV) || null;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const kv = getKV(platform);

  try {
    // Body read ONCE as bytes so NIP-98 can verify the payload hash.
    let bodyBytes: Uint8Array;
    try {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return json({ error: 'Invalid request body' }, { status: 400 });
    }

    // The membership gate below used to key off a body `authorPubkey`,
    // which is an identity claim: anyone could name a known member and
    // create gated content in their name. Identity now comes from the
    // signature.
    const verification = await verifyNip98(request, { bodyBytes });
    if (!verification.ok) {
      console.warn(`[NIP-108] NIP-98 rejected on store (${verification.reason})`);
      return json({ error: 'Authentication required' }, { status: 401 });
    }
    const authorPubkey = verification.pubkey;

    let body: any;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      gatedNoteId,
      encryptedContent,
      iv,
      secret,
      costMsats,
      endpoint,
      preview,
      title,
      authorLightningAddress,
      naddr,
      image
    } = body;

    // Validate required fields
    if (!gatedNoteId || !encryptedContent || !iv || !secret) {
      return json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Membership gate: only active members can create gated recipes
    const API_SECRET = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
    const MEMBERSHIP_ENABLED = String(platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED || '').toLowerCase();
    if (MEMBERSHIP_ENABLED === 'true' && API_SECRET) {
      const isActive = await hasActiveMembership(authorPubkey, API_SECRET);
      if (!isActive) {
        return json(
          { error: 'Active membership required to create gated recipes' },
          { status: 403 }
        );
      }
    }

    if (typeof costMsats !== 'number' || costMsats <= 0) {
      return json(
        { error: 'costMsats must be a positive number' },
        { status: 400 }
      );
    }

    if (gatedNoteId.length > 200) {
      return json(
        { error: 'gatedNoteId too long' },
        { status: 400 }
      );
    }

    // Check if gatedNoteId already exists
    if (await hasGatedContent(kv, gatedNoteId)) {
      return json(
        { error: 'Gated note ID already exists' },
        { status: 409 }
      );
    }

    // Store the gated content
    await storeGatedContent(kv, gatedNoteId, {
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
export const PATCH: RequestHandler = async ({ request, platform }) => {
  const kv = getKV(platform);

  try {
    // This handler previously had NO authentication: knowing a
    // gatedNoteId was enough to repoint someone else's paid content at an
    // attacker-chosen naddr. Now it requires a signature AND ownership.
    let bodyBytes: Uint8Array;
    try {
      bodyBytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      return json({ error: 'Invalid request body' }, { status: 400 });
    }

    const verification = await verifyNip98(request, { bodyBytes });
    if (!verification.ok) {
      console.warn(`[NIP-108] NIP-98 rejected on update (${verification.reason})`);
      return json({ error: 'Authentication required' }, { status: 401 });
    }

    let body: any;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { gatedNoteId, naddr } = body;

    if (!gatedNoteId) {
      return json({ error: 'Missing gatedNoteId' }, { status: 400 });
    }

    // Ownership check. A valid signature from SOME key isn't enough —
    // it must be the key that created this content. 404 rather than 403
    // for a non-owner so the endpoint doesn't confirm which IDs exist.
    const existing = await getGatedContent(kv, gatedNoteId);
    if (!existing || existing.authorPubkey !== verification.pubkey) {
      return json({ error: 'Gated content not found' }, { status: 404 });
    }

    if (naddr) {
      const updated = await updateGatedContentNaddr(kv, gatedNoteId, naddr);
      if (!updated) {
        return json({ error: 'Gated content not found' }, { status: 404 });
      }
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
export const GET: RequestHandler = async ({ url, platform }) => {
  const kv = getKV(platform);

  try {
    const gatedNoteId = url.searchParams.get('id');

    if (!gatedNoteId) {
      return json(
        { error: 'Missing gatedNoteId parameter' },
        { status: 400 }
      );
    }

    const content = await getGatedContent(kv, gatedNoteId);

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
