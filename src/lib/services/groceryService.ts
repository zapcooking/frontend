/**
 * Grocery List Service
 * 
 * Handles encrypted grocery list storage using NIP-78 (kind 30078) and NIP-44 encryption.
 * Lists are self-encrypted to the user's own pubkey for privacy.
 * 
 * Event Structure:
 * - kind: 30078 (NIP-78 Application-specific Data)
 * - d tag: "grocery-{uniqueId}" (makes it addressable/replaceable)
 * - client tag: "zap.cooking" (for filtering our app's data)
 * - a tags: optional links to recipes (30023:pubkey:slug)
 * - content: NIP-44 encrypted JSON payload
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { ndk, userPublickey, ndkReady } from '$lib/nostr';
import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk';
import { encrypt, decrypt, detectEncryptionMethod, type EncryptionMethod } from '$lib/encryptionService';
import { getOutboxRelays } from '$lib/relayListCache';
import { CLIENT_TAG_IDENTIFIER } from '$lib/consts';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type GroceryCategory = 'produce' | 'protein' | 'dairy' | 'pantry' | 'frozen' | 'other';

export interface GroceryItem {
  id: string;
  name: string;
  quantity: string;
  category: GroceryCategory;
  checked: boolean;
  recipeId?: string;  // a-tag format: "30023:pubkey:slug"
  addedAt: number;    // Unix timestamp (seconds)
}

export interface GroceryList {
  id: string;
  title: string;
  items: GroceryItem[];
  recipeLinks: string[];  // a-tag format references to linked recipes
  notes?: string;
  createdAt: number;      // Unix timestamp (seconds)
  updatedAt: number;      // Unix timestamp (seconds)
}

export interface GroceryListEvent {
  list: GroceryList;
  event: NDKEvent;
  encryptionMethod: EncryptionMethod;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const GROCERY_KIND = 30078;
const GROCERY_D_TAG_PREFIX = 'grocery-';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a unique ID for a grocery list
 */
export function generateListId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * Convert a list ID to a d-tag value
 */
function listIdToDTag(listId: string): string {
  return `${GROCERY_D_TAG_PREFIX}${listId}`;
}

/**
 * Extract list ID from a d-tag value
 */
function dTagToListId(dTag: string): string | null {
  if (!dTag.startsWith(GROCERY_D_TAG_PREFIX)) {
    return null;
  }
  return dTag.slice(GROCERY_D_TAG_PREFIX.length);
}

/**
 * Extract recipe links from event tags
 */
function extractRecipeLinks(event: NDKEvent): string[] {
  return event.tags
    .filter(tag => tag[0] === 'a' && tag[1]?.startsWith('30023:'))
    .map(tag => tag[1]);
}

// ═══════════════════════════════════════════════════════════════
// FETCH OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch and decrypt all grocery lists for the current user
 */
export async function fetchGroceryLists(): Promise<GroceryListEvent[]> {
  if (!browser) {
    return [];
  }

  const pubkey = get(userPublickey);
  const ndkInstance = get(ndk);

  if (!pubkey || !ndkInstance) {
    console.warn('[GroceryService] Not logged in or NDK not available');
    return [];
  }

  // Wait for NDK to be ready
  await ndkReady;

  // Build filter for grocery list events
  // Note: We can't filter by #client tag as relays don't support multi-letter tag filtering
  // We'll filter locally after fetching
  const filter: NDKFilter = {
    kinds: [GROCERY_KIND],
    authors: [pubkey],
    limit: 100
  };

  console.log('[GroceryService] Fetching grocery lists with filter:', filter);
  
  try {
    // Fetch events with timeout - closeOnEose ensures we don't hang waiting forever
    const fetchPromise = ndkInstance.fetchEvents(filter, {
      closeOnEose: true
    });
    
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise<Set<NDKEvent>>((resolve) => {
      setTimeout(() => {
        console.log('[GroceryService] Fetch timed out, returning empty set');
        resolve(new Set());
      }, 10000); // 10 second timeout
    });
    
    const events = await Promise.race([fetchPromise, timeoutPromise]);

    console.log(`[GroceryService] Received ${events.size} events from relays`);

    const lists: GroceryListEvent[] = [];
    
    for (const event of events) {
      // Filter locally: only process events with our client tag or grocery d-tag prefix
      const clientTag = event.tags.find(t => t[0] === 'client')?.[1];
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];
      
      // Accept if it has our client tag OR if d-tag starts with grocery prefix
      const isOurEvent = clientTag === CLIENT_TAG_IDENTIFIER || dTag?.startsWith(GROCERY_D_TAG_PREFIX);
      
      if (!isOurEvent) {
        console.log('[GroceryService] Skipping non-grocery event:', dTag);
        continue;
      }
      
      try {
        const listEvent = await decryptGroceryEvent(event, pubkey);
        if (listEvent) {
          lists.push(listEvent);
        }
      } catch (error) {
        console.warn('[GroceryService] Failed to decrypt grocery list:', error);
        // Continue with other lists even if one fails
      }
    }

    // Sort by updatedAt (most recent first)
    lists.sort((a, b) => b.list.updatedAt - a.list.updatedAt);
    
    console.log(`[GroceryService] Fetched ${lists.length} grocery lists`);
    return lists;
  } catch (error) {
    console.error('[GroceryService] Failed to fetch grocery lists:', error);
    throw error;
  }
}

/**
 * Fetch a single grocery list by ID
 */
export async function fetchGroceryList(listId: string): Promise<GroceryListEvent | null> {
  if (!browser) {
    return null;
  }

  const pubkey = get(userPublickey);
  const ndkInstance = get(ndk);

  if (!pubkey || !ndkInstance) {
    return null;
  }

  await ndkReady;

  const dTag = listIdToDTag(listId);
  
  const filter: NDKFilter = {
    kinds: [GROCERY_KIND],
    authors: [pubkey],
    '#d': [dTag],
    limit: 1
  };

  try {
    const event = await ndkInstance.fetchEvent(filter, { groupable: false });
    
    if (!event) {
      return null;
    }

    return await decryptGroceryEvent(event, pubkey);
  } catch (error) {
    console.error('[GroceryService] Failed to fetch grocery list:', error);
    return null;
  }
}

/**
 * Decrypt a grocery list event
 */
async function decryptGroceryEvent(
  event: NDKEvent,
  pubkey: string
): Promise<GroceryListEvent | null> {
  // Extract d-tag to get list ID
  const dTag = event.tags.find(t => t[0] === 'd')?.[1];
  if (!dTag) {
    console.warn('[GroceryService] Event missing d-tag');
    return null;
  }

  const listId = dTagToListId(dTag);
  if (!listId) {
    console.warn('[GroceryService] Invalid grocery d-tag:', dTag);
    return null;
  }

  // Skip events without content (shouldn't happen, but be safe)
  if (!event.content) {
    console.warn('[GroceryService] Event missing content');
    return null;
  }

  try {
    // Detect encryption method from ciphertext format
    const method = detectEncryptionMethod(event.content);
    
    // Decrypt content (self-encrypted to own pubkey)
    const plaintext = await decrypt(pubkey, event.content, method);
    
    // Parse JSON payload
    const payload = JSON.parse(plaintext);
    
    // Extract recipe links from event tags
    const recipeLinks = extractRecipeLinks(event);

    // Build GroceryList object
    const list: GroceryList = {
      id: payload.id || listId,
      title: payload.title || 'Untitled List',
      items: payload.items || [],
      recipeLinks,
      notes: payload.notes,
      createdAt: payload.createdAt || (event.created_at || Math.floor(Date.now() / 1000)),
      updatedAt: payload.updatedAt || (event.created_at || Math.floor(Date.now() / 1000))
    };

    return {
      list,
      event,
      encryptionMethod: method
    };
  } catch (error) {
    console.error('[GroceryService] Failed to decrypt/parse grocery list:', error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// SAVE OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Save (create or update) a grocery list
 * 
 * @param list - The grocery list to save
 * @returns The saved event, or null on failure
 */
export async function saveGroceryList(list: GroceryList): Promise<NDKEvent | null> {
  if (!browser) {
    throw new Error('Cannot save grocery list on server');
  }

  const pubkey = get(userPublickey);
  const ndkInstance = get(ndk);

  if (!pubkey) {
    throw new Error('Not logged in');
  }

  if (!ndkInstance?.signer) {
    throw new Error('No signer available. Please log in again.');
  }

  await ndkReady;

  // Update the updatedAt timestamp
  const now = Math.floor(Date.now() / 1000);
  const listToSave: GroceryList = {
    ...list,
    updatedAt: now,
    createdAt: list.createdAt || now
  };

  // Prepare the encrypted payload
  const payload = JSON.stringify({
    id: listToSave.id,
    title: listToSave.title,
    items: listToSave.items,
    notes: listToSave.notes,
    createdAt: listToSave.createdAt,
    updatedAt: listToSave.updatedAt
  });

  try {
    // Encrypt to self (user's own pubkey)
    const { ciphertext } = await encrypt(pubkey, payload, 'nip44');

    // Build the event
    const event = new NDKEvent(ndkInstance);
    event.kind = GROCERY_KIND;
    event.content = ciphertext;
    
    // Set tags
    event.tags = [
      ['d', listIdToDTag(listToSave.id)],
      ['client', CLIENT_TAG_IDENTIFIER]
    ];

    // Add recipe link tags
    for (const recipeLink of listToSave.recipeLinks) {
      event.tags.push(['a', recipeLink]);
    }

    // Sign and publish
    await event.sign();
    
    // Get user's write relays for publishing
    const writeRelays = await getOutboxRelays(pubkey);
    
    console.log('[GroceryService] Publishing grocery list to relays...');
    await event.publish();
    
    console.log('[GroceryService] Grocery list saved successfully');
    return event;
  } catch (error) {
    console.error('[GroceryService] Failed to save grocery list:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// DELETE OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Delete a grocery list by publishing a kind 5 deletion event
 * 
 * @param listId - The ID of the list to delete
 * @param eventId - Optional: the event ID to reference in deletion
 * @returns The deletion event, or null on failure
 */
export async function deleteGroceryList(
  listId: string,
  eventId?: string
): Promise<NDKEvent | null> {
  if (!browser) {
    throw new Error('Cannot delete grocery list on server');
  }

  const pubkey = get(userPublickey);
  const ndkInstance = get(ndk);

  if (!pubkey) {
    throw new Error('Not logged in');
  }

  if (!ndkInstance?.signer) {
    throw new Error('No signer available. Please log in again.');
  }

  await ndkReady;

  try {
    // Create deletion event (kind 5 per NIP-09)
    const deleteEvent = new NDKEvent(ndkInstance);
    deleteEvent.kind = 5;
    deleteEvent.content = 'Deleted grocery list';
    
    // Reference the addressable event with an 'a' tag
    const aTag = `${GROCERY_KIND}:${pubkey}:${listIdToDTag(listId)}`;
    deleteEvent.tags = [
      ['a', aTag]
    ];

    // If we have the specific event ID, also add an 'e' tag
    if (eventId) {
      deleteEvent.tags.push(['e', eventId]);
    }

    // Sign and publish
    await deleteEvent.sign();
    
    console.log('[GroceryService] Publishing deletion event...');
    await deleteEvent.publish();
    
    console.log('[GroceryService] Grocery list deleted successfully');
    return deleteEvent;
  } catch (error) {
    console.error('[GroceryService] Failed to delete grocery list:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new empty grocery list
 */
export function createEmptyList(title: string = 'New List'): GroceryList {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: generateListId(),
    title,
    items: [],
    recipeLinks: [],
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Create a new grocery item
 */
export function createGroceryItem(
  name: string,
  quantity: string = '',
  category: GroceryCategory = 'other',
  recipeId?: string
): GroceryItem {
  return {
    id: generateListId(),
    name,
    quantity,
    category,
    checked: false,
    recipeId,
    addedAt: Math.floor(Date.now() / 1000)
  };
}

/**
 * Infer category from item name (basic heuristics)
 */
export function inferCategory(name: string): GroceryCategory {
  const lowercaseName = name.toLowerCase();
  
  // Produce keywords
  const produceKeywords = [
    'apple', 'banana', 'orange', 'lemon', 'lime', 'grape', 'berry', 'strawberry',
    'blueberry', 'raspberry', 'mango', 'pineapple', 'watermelon', 'melon',
    'lettuce', 'spinach', 'kale', 'cabbage', 'broccoli', 'cauliflower',
    'carrot', 'celery', 'cucumber', 'tomato', 'pepper', 'onion', 'garlic',
    'potato', 'sweet potato', 'squash', 'zucchini', 'mushroom', 'avocado',
    'herb', 'basil', 'cilantro', 'parsley', 'mint', 'fruit', 'vegetable'
  ];
  
  // Protein keywords
  const proteinKeywords = [
    'chicken', 'beef', 'pork', 'lamb', 'turkey', 'duck', 'meat',
    'fish', 'salmon', 'tuna', 'shrimp', 'crab', 'lobster', 'seafood',
    'egg', 'tofu', 'tempeh', 'seitan', 'bacon', 'sausage', 'ham'
  ];
  
  // Dairy keywords
  const dairyKeywords = [
    'milk', 'cream', 'butter', 'cheese', 'yogurt', 'sour cream',
    'cottage cheese', 'cream cheese', 'whipped cream', 'half and half'
  ];
  
  // Frozen keywords
  const frozenKeywords = [
    'frozen', 'ice cream', 'popsicle', 'sorbet', 'gelato'
  ];
  
  // Pantry keywords
  const pantryKeywords = [
    'flour', 'sugar', 'salt', 'pepper', 'oil', 'vinegar', 'spice',
    'rice', 'pasta', 'noodle', 'bread', 'cereal', 'oat', 'bean', 'lentil',
    'can', 'canned', 'sauce', 'broth', 'stock', 'honey', 'syrup',
    'nut', 'almond', 'peanut', 'walnut', 'seed', 'chocolate', 'cocoa'
  ];
  
  if (produceKeywords.some(kw => lowercaseName.includes(kw))) {
    return 'produce';
  }
  if (proteinKeywords.some(kw => lowercaseName.includes(kw))) {
    return 'protein';
  }
  if (dairyKeywords.some(kw => lowercaseName.includes(kw))) {
    return 'dairy';
  }
  if (frozenKeywords.some(kw => lowercaseName.includes(kw))) {
    return 'frozen';
  }
  if (pantryKeywords.some(kw => lowercaseName.includes(kw))) {
    return 'pantry';
  }
  
  return 'other';
}
