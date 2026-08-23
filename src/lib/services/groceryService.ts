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
import { NDKEvent, NDKRelaySet, type NDKFilter } from '@nostr-dev-kit/ndk';
import { encrypt, decrypt, detectEncryptionMethod, type EncryptionMethod } from '$lib/encryptionService';
import { getOutboxRelays, getInboxRelays } from '$lib/relayListCache';
import { CLIENT_TAG_IDENTIFIER } from '$lib/consts';
import {
  canonicalizeGroceryCategory,
  type GroceryCategory
} from '$lib/grocery/categories';
import type { GroceryItemSource } from '$lib/grocery/consolidation';

export type { GroceryCategory } from '$lib/grocery/categories';
export type { GroceryItemSource } from '$lib/grocery/consolidation';

export type GroceryItemOrigin = 'manual' | 'recipe';

export interface UnresolvedRecipeSource {
  a: string;
  title?: string;
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

/**
 * Grocery list item. Persistence is Zap-owned and retailer-agnostic.
 * A future grocery provider adapter should consume `toProviderList`
 * from `$lib/grocery/export` rather than this event payload.
 */
export interface GroceryItem {
  id: string;
  name: string;
  quantity: string;
  category: GroceryCategory;
  checked: boolean;
  recipeId?: string;  // a-tag format: "30023:pubkey:slug"
  addedAt: number;    // Unix timestamp (seconds)
  /** Consolidation key. Optional on lists written before grocery v1.1. */
  normalizedName?: string;
  unit?: string;
  origin?: GroceryItemOrigin;
  sources?: GroceryItemSource[];
  /** User chose "I still need this" for a pantry-matched ingredient. */
  pantryOverride?: boolean;
}

export interface GroceryList {
  id: string;
  title: string;
  items: GroceryItem[];
  recipeLinks: string[];  // a-tag format references to linked recipes
  notes?: string;
  /**
   * Recipe ingredients recognized as already in the user's pantry.
   * Informational only — not shopping items, and pantry inventory is
   * not decremented when this list is generated.
   */
  pantryCovered?: PantryCoveredItem[];
  /**
   * Normalized names the user forced onto the shopping list after a
   * pantry match. Survives meal-plan recalculation.
   */
  pantryOverrides?: string[];
  /** Meal-plan week this list was generated from, e.g. `2026-W29`. */
  sourceWeekId?: string;
  stats?: {
    totalIngredients: number;
    pantryCoveredCount: number;
    addedCount: number;
  };
  /** Planned recipes that could not be loaded when this list was generated. */
  unresolvedRecipes?: UnresolvedRecipeSource[];
  createdAt: number;      // Unix timestamp (seconds)
  updatedAt: number;      // Unix timestamp (seconds)
}

export interface PantryCoveredItem {
  name: string;
  quantity: string;
  recipeId?: string;
  normalizedName?: string;
  unit?: string;
  category?: GroceryCategory;
  sources?: GroceryItemSource[];
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

function asTrimmed(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
}

function sanitizeSources(raw: unknown): GroceryItemSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: GroceryItemSource[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const recipeId = asTrimmed(r.recipeId, 200);
    const occurrenceId = asTrimmed(r.occurrenceId, 80);
    if (!recipeId || !occurrenceId) continue;
    const source: GroceryItemSource = {
      recipeId,
      occurrenceId,
      quantity: asTrimmed(r.quantity, 80) || ''
    };
    const recipeTitle = asTrimmed(r.recipeTitle, 120);
    if (recipeTitle) source.recipeTitle = recipeTitle;
    const originalName = asTrimmed(r.originalName, 80);
    if (originalName) source.originalName = originalName;
    out.push(source);
  }
  return out.length ? out : undefined;
}

function sanitizeGroceryItem(raw: unknown, fallbackNow: number): GroceryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = asTrimmed(r.id, 64);
  const name = asTrimmed(r.name, 80);
  if (!id || !name) return null;
  const origin = r.origin === 'manual' || r.origin === 'recipe' ? r.origin : undefined;
  const item: GroceryItem = {
    id,
    name,
    quantity: asTrimmed(r.quantity, 80) || '',
    category: canonicalizeGroceryCategory(
      typeof r.category === 'string' ? r.category : undefined,
      name
    ),
    checked: r.checked === true,
    addedAt: typeof r.addedAt === 'number' && Number.isFinite(r.addedAt) ? r.addedAt : fallbackNow
  };
  const recipeId = asTrimmed(r.recipeId, 200);
  if (recipeId) item.recipeId = recipeId;
  const normalizedName = asTrimmed(r.normalizedName, 80);
  if (normalizedName) item.normalizedName = normalizedName;
  const unit = asTrimmed(r.unit, 24);
  if (unit) item.unit = unit;
  if (origin) item.origin = origin;
  else item.origin = recipeId ? 'recipe' : 'manual';
  const sources = sanitizeSources(r.sources);
  if (sources) item.sources = sources;
  if (r.pantryOverride === true) item.pantryOverride = true;
  return item;
}

/** Drop malformed pantryCovered rows so the grocery UI never reads `.name` on null. */
export function sanitizePantryCovered(raw: unknown): PantryCoveredItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PantryCoveredItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 80) : '';
    if (!name) continue;
    const covered: PantryCoveredItem = {
      name,
      quantity: typeof r.quantity === 'string' ? r.quantity.trim().slice(0, 40) : ''
    };
    if (typeof r.recipeId === 'string' && r.recipeId.trim()) {
      covered.recipeId = r.recipeId.trim();
    }
    const normalizedName = asTrimmed(r.normalizedName, 80);
    if (normalizedName) covered.normalizedName = normalizedName;
    const unit = asTrimmed(r.unit, 24);
    if (unit) covered.unit = unit;
    if (typeof r.category === 'string') {
      covered.category = canonicalizeGroceryCategory(r.category, name);
    }
    const sources = sanitizeSources(r.sources);
    if (sources) covered.sources = sources;
    out.push(covered);
  }
  return out.length ? out : undefined;
}

function sanitizePantryOverrides(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().slice(0, 80))
    .filter(Boolean);
  return out.length ? [...new Set(out)] : undefined;
}

function sanitizeStats(raw: unknown): GroceryList['stats'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const totalIngredients = typeof r.totalIngredients === 'number' ? r.totalIngredients : undefined;
  const pantryCoveredCount = typeof r.pantryCoveredCount === 'number' ? r.pantryCoveredCount : undefined;
  const addedCount = typeof r.addedCount === 'number' ? r.addedCount : undefined;
  if (totalIngredients == null || pantryCoveredCount == null || addedCount == null) return undefined;
  return { totalIngredients, pantryCoveredCount, addedCount };
}

export function sanitizeUnresolvedRecipes(raw: unknown): UnresolvedRecipeSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: UnresolvedRecipeSource[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const a = typeof r.a === 'string' ? r.a.trim() : '';
    if (!a.includes(':') || seen.has(a)) continue;
    seen.add(a);
    const title = asTrimmed(r.title, 120);
    out.push(title ? { a, title } : { a });
  }
  return out.length ? out : undefined;
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
      const dTag = event.tags.find(t => t[0] === 'd')?.[1];

      // Require the grocery- d-tag prefix so pantry / mealplan kind-30078
      // events are not decrypted as grocery lists.
      const isOurEvent = dTag?.startsWith(GROCERY_D_TAG_PREFIX);
      
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

    const now = event.created_at || Math.floor(Date.now() / 1000);
    const itemsRaw = Array.isArray(payload.items) ? payload.items : [];
    const items: GroceryItem[] = [];
    for (const raw of itemsRaw) {
      const item = sanitizeGroceryItem(raw, now);
      if (item) items.push(item);
    }

    const sourceWeekId =
      typeof payload.sourceWeekId === 'string' && /^\d{4}-W\d{2}$/.test(payload.sourceWeekId)
        ? payload.sourceWeekId
        : undefined;

    const list: GroceryList = {
      id: payload.id || listId,
      title: payload.title || 'Untitled List',
      items,
      recipeLinks,
      notes: payload.notes,
      pantryCovered: sanitizePantryCovered(payload.pantryCovered),
      pantryOverrides: sanitizePantryOverrides(payload.pantryOverrides),
      sourceWeekId,
      stats: sanitizeStats(payload.stats),
      unresolvedRecipes: sanitizeUnresolvedRecipes(payload.unresolvedRecipes),
      createdAt: payload.createdAt || now,
      updatedAt: payload.updatedAt || now
    };

    return {
      list,
      event,
      encryptionMethod: method
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[GroceryService] Failed to decrypt/parse grocery list:', {
      message: errorMsg,
      stack: errorStack,
      error,
      listId,
      dTag,
      hasContent: !!event.content,
      contentLength: event.content?.length || 0
    });
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
    pantryCovered: listToSave.pantryCovered,
    pantryOverrides: listToSave.pantryOverrides,
    sourceWeekId: listToSave.sourceWeekId,
    stats: listToSave.stats,
    unresolvedRecipes: listToSave.unresolvedRecipes,
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
    
    console.log('[GroceryService] Publishing grocery list to relays...', writeRelays.length > 0 ? `(${writeRelays.length} outbox relays)` : '(default relays)');
    
    // Publish to user's outbox relays if available, otherwise use default relay set
    if (writeRelays.length > 0) {
      const relaySet = NDKRelaySet.fromRelayUrls(writeRelays, ndkInstance);
      await event.publish(relaySet);
    } else {
      await event.publish();
    }
    
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
 * Delete one or more grocery lists by publishing a kind 5 deletion event.
 * NIP-09 allows multiple `a` tags on a single deletion request.
 *
 * @param listIds - List IDs to delete
 * @param eventIds - Optional map of list ID → event ID for `e` tags
 * @returns The deletion event, or null if there is nothing to delete
 */
export async function deleteGroceryLists(
  listIds: string[],
  eventIds?: Record<string, string>
): Promise<NDKEvent | null> {
  const uniqueIds = [...new Set(listIds.filter(Boolean))];
  if (uniqueIds.length === 0) return null;

  if (!browser) {
    throw new Error('Cannot delete grocery lists on server');
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
    const deleteEvent = new NDKEvent(ndkInstance);
    deleteEvent.kind = 5;
    deleteEvent.content =
      uniqueIds.length === 1
        ? 'Deleted grocery list'
        : `Deleted ${uniqueIds.length} grocery lists`;
    deleteEvent.tags = uniqueIds.map((listId) => [
      'a',
      `${GROCERY_KIND}:${pubkey}:${listIdToDTag(listId)}`
    ]);

    for (const listId of uniqueIds) {
      const eventId = eventIds?.[listId];
      if (eventId) {
        deleteEvent.tags.push(['e', eventId]);
      }
    }

    await deleteEvent.sign();

    const writeRelays = await getOutboxRelays(pubkey);

    console.log(
      '[GroceryService] Publishing deletion event...',
      writeRelays.length > 0 ? `(${writeRelays.length} outbox relays)` : '(default relays)'
    );

    if (writeRelays.length > 0) {
      const relaySet = NDKRelaySet.fromRelayUrls(writeRelays, ndkInstance);
      await deleteEvent.publish(relaySet);
    } else {
      await deleteEvent.publish();
    }

    console.log('[GroceryService] Grocery list(s) deleted successfully');
    return deleteEvent;
  } catch (error) {
    console.error('[GroceryService] Failed to delete grocery list(s):', error);
    throw error;
  }
}

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
  if (!listId) return null;
  return deleteGroceryLists([listId], eventId ? { [listId]: eventId } : undefined);
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Create a new empty grocery list
 */
export function createEmptyList(
  title: string = 'New List',
  extras?: Partial<Pick<GroceryList, 'sourceWeekId' | 'notes'>>
): GroceryList {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: generateListId(),
    title,
    items: [],
    recipeLinks: [],
    sourceWeekId: extras?.sourceWeekId,
    notes: extras?.notes,
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
  recipeId?: string,
  extras?: Partial<
    Pick<GroceryItem, 'normalizedName' | 'unit' | 'origin' | 'sources' | 'pantryOverride'>
  >
): GroceryItem {
  const origin = extras?.origin || (recipeId ? 'recipe' : 'manual');
  const { origin: _ignoredOrigin, ...rest } = extras || {};
  return {
    id: generateListId(),
    name,
    quantity,
    category,
    checked: false,
    recipeId,
    addedAt: Math.floor(Date.now() / 1000),
    origin,
    ...rest
  };
}

/**
 * Build a recipe address (a-tag format) from event data
 */
export function buildRecipeAddress(pubkey: string, dTag: string): string {
  return `30023:${pubkey}:${dTag}`;
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
