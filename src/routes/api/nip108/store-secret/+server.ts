/**
 * Store Secret for Gated Note
 * 
 * POST /api/nip108/store-secret
 * 
 * Body:
 * {
 *   gatedNoteId: string,
 *   secret: string (hex-encoded)
 * }
 * 
 * Stores the secret key for a gated note so it can be distributed after payment.
 * In production, this should be stored securely (encrypted database, etc.)
 */

import { json, type RequestHandler } from '@sveltejs/kit';

// In-memory store (in production, use a database)
const gatedNoteSecrets = new Map<string, string>();

function storeGatedNoteSecret(gatedNoteId: string, secret: string): void {
  gatedNoteSecrets.set(gatedNoteId, secret);
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { gatedNoteId, secret } = body;
    
    if (!gatedNoteId || !secret) {
      return json(
        { error: 'gatedNoteId and secret are required' },
        { status: 400 }
      );
    }
    
    // Store secret (in production, encrypt and store in database)
    await storeGatedNoteSecret(gatedNoteId, secret);
    
    return json({ success: true });
    
  } catch (error) {
    console.error('[NIP-108 Store Secret] Error:', error);
    return json(
      { error: 'Failed to store secret' },
      { status: 500 }
    );
  }
};
