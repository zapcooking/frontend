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
  // Use a hash of the encrypted content + timestamp for uniqueness
  const gatedNoteId = `gated_${Date.now()}_${bufferToHex(secretKeyBytes).substring(0, 16)}`;
  
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
  const costRaw = parseInt(gatedTag[2], 10);
  
  // Detect if cost is in msats (old format) or sats (new format)
  // If cost > 10000, it's likely msats from old format
  const costSats = costRaw > 10000 ? Math.ceil(costRaw / 1000) : costRaw;
  
  // Fetch additional info from server
  try {
    const response = await fetch(`/api/nip108/store-gated?id=${encodeURIComponent(gatedNoteId)}`);
    
    if (!response.ok) {
      console.warn('Failed to fetch gated content info:', response.status);
      // Return basic info from tag (cost in sats)
      return {
        gatedNoteId,
        announcementNoteId: gatedNoteId,
        cost: costSats,
        endpoint: '/api/nip108/payment',
        iv: '',
        authorPubkey: recipeEvent.pubkey // Include author for ownership check
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
      authorPubkey: data.authorPubkey || recipeEvent.pubkey
    };
  } catch (error) {
    console.warn('Error checking gated status:', error);
    // Return basic info from tag (cost in sats)
    return {
      gatedNoteId,
      announcementNoteId: gatedNoteId,
      cost: costSats,
      endpoint: '/api/nip108/payment',
      iv: '',
      authorPubkey: recipeEvent.pubkey
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
    throw new Error(`Payment request failed: ${response.status} ${response.statusText}`);
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
