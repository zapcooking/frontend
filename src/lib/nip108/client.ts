/**
 * NIP-108 Client Utilities
 * 
 * Functions for creating and reading Lightning Gated Recipes
 * 
 * Note: Since most relays don't support NIP-108 event kinds (54, 55, 56),
 * we use a hybrid approach:
 * - Store encrypted content on our server
 * - Mark recipes with a 'gated' tag
 * - Handle payment and decryption server-side
 */

import type { NDKEvent, NDK } from '@nostr-dev-kit/ndk';
import { NDKEvent as NDKEventClass } from '@nostr-dev-kit/ndk';
import { encrypt, generateSecretKey, bufferToHex } from './encryption';
import { randomBytes } from '@noble/hashes/utils.js';
import type { GatedRecipeMetadata, PaymentRequest, SecretResponse } from './types';
import { nip04 } from 'nostr-tools';

/**
 * Create a gated recipe (Server-side storage approach)
 * 
 * Flow:
 * 1. Encrypt the recipe content with a random secret
 * 2. Store encrypted content on server (not on Nostr relays)
 * 3. Return gated ID for the recipe event tags
 * 
 * @param recipeEvent - The original recipe event (kind 30023)
 * @param ndk - NDK instance
 * @param costMsats - Cost in milli-satoshis
 * @param endpoint - Payment endpoint URL
 * @param preview - Optional preview text
 * @returns Promise with gated note ID and metadata
 */
export async function createGatedRecipe(
  recipeEvent: NDKEvent,
  ndk: NDK,
  costMsats: number,
  endpoint: string,
  preview?: string,
  authorLightningAddress?: string // Author's lud16 for receiving payments
): Promise<{
  gatedNoteId: string;
  announcementNoteId: string;
  secretKey: string; // Hex-encoded secret key
}> {
  // Get author pubkey from signer if not set on event
  let authorPubkey = recipeEvent.pubkey;
  if (!authorPubkey && ndk.signer) {
    const user = await ndk.signer.user();
    authorPubkey = user.pubkey;
  }
  
  if (!authorPubkey) {
    throw new Error('Could not determine author pubkey. Please sign in first.');
  }
  
  // Generate secret key for encryption
  const secretKeyBytes = generateSecretKey();
  
  // Serialize recipe event to JSON (full recipe content)
  const recipeJson = JSON.stringify({
    kind: recipeEvent.kind,
    content: recipeEvent.content,
    tags: recipeEvent.tags,
    created_at: recipeEvent.created_at || Math.floor(Date.now() / 1000),
    pubkey: authorPubkey
  });
  
  // Encrypt recipe content
  const encrypted = encrypt(recipeJson, secretKeyBytes);
  
  // Generate a unique gated note ID (not published to relays)
  // Use random bytes for uniqueness — never leak the secret key in IDs
  const gatedNoteId = `gated_${Date.now()}_${bufferToHex(randomBytes(8))}`;
  
  // Get recipe image if available
  const imageTag = recipeEvent.getMatchingTags('image')[0];
  const recipeImage = imageTag ? imageTag[1] : '';
  
  // Store encrypted content on server
  const response = await fetch('/api/nip108/store-gated', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gatedNoteId,
      encryptedContent: encrypted.content,
      iv: encrypted.iv,
      secret: bufferToHex(secretKeyBytes),
      costMsats,
      endpoint,
      preview: preview || recipeEvent.tagValue('summary') || '',
      title: recipeEvent.tagValue('title') || 'Recipe',
      authorPubkey,
      authorLightningAddress, // Pass Lightning address for payments
      image: recipeImage
    })
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Failed to store gated content: ${error.error || response.statusText}`);
  }
  
  // Return IDs (announcementNoteId is same as gatedNoteId in this approach)
  return {
    gatedNoteId,
    announcementNoteId: gatedNoteId,
    secretKey: bufferToHex(secretKeyBytes)
  };
}

/**
 * Check if a recipe event is gated (has 'gated' tag)
 * 
 * @param recipeEvent - Recipe event to check
 * @param ndk - NDK instance (not used in server-side approach, kept for compatibility)
 * @returns Promise with gated metadata if gated, null otherwise (cost is in sats)
 */
export async function checkIfGated(
  recipeEvent: NDKEvent,
  ndk: NDK
): Promise<GatedRecipeMetadata | null> {
  // Check for 'gated' tag on the recipe: ['gated', gatedNoteId, cost]
  const gatedTag = recipeEvent.getMatchingTags('gated')[0];
  
  if (!gatedTag || gatedTag.length < 3) {
    return null; // Not a gated recipe
  }
  
  const gatedNoteId = gatedTag[1];
  // Tag value is always in sats (set during recipe creation)
  const costSats = parseInt(gatedTag[2], 10);
  
  // Fetch additional info from server
  try {
    const response = await fetch(`/api/nip108/store-gated?id=${encodeURIComponent(gatedNoteId)}`);
    
    if (!response.ok) {
      console.warn('Failed to fetch gated content info:', response.status);
      // Return basic info from tag — server doesn't have the encrypted data
      return {
        gatedNoteId,
        announcementNoteId: gatedNoteId,
        cost: costSats,
        endpoint: '/api/nip108/payment',
        iv: '',
        authorPubkey: recipeEvent.pubkey,
        serverHasData: false
      };
    }

    const data = await response.json();

    // Server stores msats internally, convert to sats for display
    const serverCostSats = data.costMsats ? Math.ceil(data.costMsats / 1000) : costSats;

    return {
      gatedNoteId,
      announcementNoteId: gatedNoteId,
      cost: serverCostSats,
      endpoint: '/api/nip108/payment',
      preview: data.preview || '',
      iv: '',
      authorPubkey: data.authorPubkey || recipeEvent.pubkey,
      serverHasData: true
    };
  } catch (error) {
    console.warn('Error checking gated status:', error);
    // Return basic info from tag — server unreachable
    return {
      gatedNoteId,
      announcementNoteId: gatedNoteId,
      cost: costSats,
      endpoint: '/api/nip108/payment',
      iv: '',
      authorPubkey: recipeEvent.pubkey,
      serverHasData: false
    };
  }
}

/**
 * Check if user has access to a gated recipe (server-side check)
 * 
 * @param gatedNoteId - Gated note ID
 * @param userPubkey - User's public key
 * @param ndk - NDK instance (kept for compatibility)
 * @returns Promise with decrypted recipe event if access exists, null otherwise
 */
export async function checkAccess(
  gatedNoteId: string,
  userPubkey: string,
  ndk: NDK
): Promise<NDKEvent | null> {
  try {
    // Check with server if user has access
    const response = await fetch(`/api/nip108/check-access?g=${encodeURIComponent(gatedNoteId)}&p=${encodeURIComponent(userPubkey)}`);
    
    if (!response.ok) {
      return null; // No access
    }
    
    const data = await response.json();
    
    if (!data.hasAccess || !data.decryptedContent) {
      return null;
    }
    
    // Parse and reconstruct recipe event
    const recipeData = JSON.parse(data.decryptedContent);
    const recipeEvent = new NDKEventClass(ndk);
    recipeEvent.kind = recipeData.kind;
    recipeEvent.content = recipeData.content;
    recipeEvent.tags = recipeData.tags;
    recipeEvent.created_at = recipeData.created_at;
    recipeEvent.pubkey = recipeData.pubkey;
    
    return recipeEvent;
  } catch (error) {
    console.error('Error checking access:', error);
    return null;
  }
}

/**
 * Request payment for gated recipe
 * 
 * @param endpoint - Payment endpoint URL (can be relative like /api/nip108/payment)
 * @param gatedNoteId - Event ID of gated note
 * @param userPubkey - User's public key
 * @returns Promise with payment request (402 response)
 */
export async function requestPayment(
  endpoint: string,
  gatedNoteId: string,
  userPubkey: string
): Promise<PaymentRequest> {
  // Build URL with query params - handle both relative and absolute URLs
  const params = new URLSearchParams();
  params.set('g', gatedNoteId);
  params.set('p', userPubkey);
  
  const url = endpoint.includes('?') 
    ? `${endpoint}&${params.toString()}`
    : `${endpoint}?${params.toString()}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (response.status === 402) {
    // Payment required
    return await response.json();
  } else if (response.status === 200) {
    // Already paid or free
    return await response.json();
  } else {
    const errorBody = await response.json().catch(() => null);
    const detail =
      errorBody && typeof errorBody.error === 'string' && errorBody.error.trim().length > 0
        ? ` - ${errorBody.error}`
        : '';
    throw new Error(`Payment request failed: ${response.status} ${response.statusText}${detail}`);
  }
}

/**
 * Fetch secret after payment
 * 
 * @param endpoint - Payment endpoint URL (can be relative like /api/nip108/payment)
 * @param gatedNoteId - Event ID of gated note
 * @param userPubkey - User's public key
 * @param paymentPreimage - Payment preimage (proof of payment)
 * @returns Promise with secret key
 */
export async function fetchSecret(
  endpoint: string,
  gatedNoteId: string,
  userPubkey: string,
  paymentPreimage: string
): Promise<string> {
  // Build URL with query params - handle both relative and absolute URLs
  const params = new URLSearchParams();
  params.set('g', gatedNoteId);
  params.set('p', userPubkey);
  params.set('preimage', paymentPreimage);
  
  const url = endpoint.includes('?') 
    ? `${endpoint}&${params.toString()}`
    : `${endpoint}?${params.toString()}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch secret: ${response.status} ${response.statusText}`);
  }
  
  const data: SecretResponse = await response.json();
  return data.secret;
}

/**
 * Backfill gated recipe data for old recipes where the server store is empty.
 *
 * This handles the case where a premium recipe was published before the KV
 * binding was configured, so the encrypted content was never stored server-side.
 * The author triggers this by visiting their own recipe — re-encrypts the relay
 * content and stores it so the normal per-user payment flow works for everyone.
 *
 * @param recipeEvent - The recipe event from the relay (must have full content)
 * @param ndk - NDK instance
 * @param gatedNoteId - Existing gated note ID from the recipe's 'gated' tag
 * @param costSats - Cost in sats from the recipe's 'gated' tag
 * @returns Promise<boolean> true if backfill succeeded
 */
export async function backfillGatedRecipe(
  recipeEvent: NDKEvent,
  ndk: NDK,
  gatedNoteId: string,
  costSats: number
): Promise<boolean> {
  try {
    const authorPubkey = recipeEvent.pubkey;

    // Resolve author's lightning address for the payment flow
    let authorLightningAddress = '';
    try {
      const profileEvent = await ndk.fetchEvent({
        kinds: [0],
        authors: [authorPubkey]
      });
      if (profileEvent) {
        const profile = JSON.parse(profileEvent.content);
        authorLightningAddress = profile.lud16 || '';
      }
    } catch {
      // Non-critical — payments will use mock invoices in dev
    }

    // Generate new secret key for encryption
    const secretKeyBytes = generateSecretKey();

    // Serialize the full recipe event
    const recipeJson = JSON.stringify({
      kind: recipeEvent.kind,
      content: recipeEvent.content,
      tags: recipeEvent.tags,
      created_at: recipeEvent.created_at || Math.floor(Date.now() / 1000),
      pubkey: authorPubkey
    });

    // Encrypt
    const encrypted = encrypt(recipeJson, secretKeyBytes);

    // Extract metadata from event tags
    const imageTag = recipeEvent.getMatchingTags('image')[0];
    const preview = recipeEvent.tagValue('summary') || '';
    const title = recipeEvent.tagValue('title') || 'Recipe';

    // Store on server
    const response = await fetch('/api/nip108/store-gated', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gatedNoteId,
        encryptedContent: encrypted.content,
        iv: encrypted.iv,
        secret: bufferToHex(secretKeyBytes),
        costMsats: costSats * 1000,
        endpoint: '/api/nip108/payment',
        preview,
        title,
        authorPubkey,
        authorLightningAddress,
        image: imageTag ? imageTag[1] : ''
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown' }));
      console.warn('[NIP-108 Backfill] Failed:', response.status, err.error);
      return false;
    }

    console.log('[NIP-108 Backfill] Successfully backfilled:', gatedNoteId);
    return true;
  } catch (err) {
    console.error('[NIP-108 Backfill] Error:', err);
    return false;
  }
}

/**
 * Create key note (kind 56) after receiving secret
 * 
 * @param gatedNoteId - Event ID of gated note
 * @param secretHex - Secret key (hex-encoded)
 * @param recipientPubkey - Recipient's public key
 * @param ndk - NDK instance
 * @returns Promise with key note event ID
 */
export async function createKeyNote(
  gatedNoteId: string,
  secretHex: string,
  recipientPubkey: string,
  ndk: NDK
): Promise<string> {
  if (!ndk.signer) {
    throw new Error('NDK signer required to create key note');
  }
  
  const privateKey = await ndk.signer.privateKey();
  if (!privateKey) {
    throw new Error('Private key not available');
  }
  
  // Encrypt secret using NIP-04
  const encryptedSecret = await nip04.encrypt(privateKey, recipientPubkey, secretHex);
  
  // Create key note (kind 56)
  const keyNote = new NDKEventClass(ndk);
  keyNote.kind = 56;
  keyNote.content = encryptedSecret;
  keyNote.tags.push(['g', gatedNoteId]); // Reference to gated note
  
  // Publish key note
  await keyNote.publish();
  
  return keyNote.id;
}
