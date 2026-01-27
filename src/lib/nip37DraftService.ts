/**
 * NIP-37 Draft Storage Service
 *
 * Implements encrypted draft event storage per NIP-37:
 * - Kind 31234: Draft wrapper events (encrypted, addressable)
 * - Kind 10013: Relay list for private content (encrypted relay URLs)
 *
 * Features:
 * - NIP-44 encryption for draft content
 * - Private relay list discovery with fallbacks
 * - Debounced publishing to prevent spam
 * - Deduplication of fetched drafts
 * - Expiration handling (90-day default)
 */

import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { NDKEvent, NDKRelaySet, type NDKFilter } from '@nostr-dev-kit/ndk';
import { getNdkInstance, userPublickey, ndkReady } from '$lib/nostr';
import { encrypt, decrypt, hasEncryptionSupport, detectEncryptionMethod } from '$lib/encryptionService';
import { getOutboxRelays } from '$lib/relayListCache';
import type { RecipeDraft } from '$lib/draftStore';
import type { ArticleDraft } from '$lib/articleEditor';
import TurndownService from 'turndown';
import { parseMarkdown } from '$lib/parser';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// NIP-37 Event Kinds
export const KIND_DRAFT_WRAP = 31234;
export const KIND_PRIVATE_RELAY_LIST = 10013;

// Recipe draft kind (what's inside the wrapper)
export const KIND_RECIPE = 30023;

// Default expiration: 90 days
const DEFAULT_EXPIRATION_DAYS = 90;

// Debounce delay for publishing (5 seconds)
const PUBLISH_DEBOUNCE_MS = 5000;

// Network timeout
const NETWORK_TIMEOUT_MS = 15000;

// Default private relays (fallback if no kind:10013)
const DEFAULT_PRIVATE_RELAYS = [
  'wss://kitchen.zap.cooking',
  'wss://relay.damus.io',
  'wss://nos.lol'
];

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RemoteDraft {
  id: string;                    // d-tag value (draft identifier)
  eventId: string;               // Nostr event ID
  draft: RecipeDraft | ArticleDraft;  // Decrypted draft content
  draftType: 'recipe' | 'article';    // Type of draft
  createdAt: number;             // Event created_at timestamp (ms)
  expiresAt: number | null;      // Expiration timestamp (ms) or null if no expiration
  relayUrl?: string;             // Relay this was fetched from
}

export interface DraftSyncState {
  isSyncing: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  pendingPublish: Set<string>;   // Draft IDs pending publish
}

export interface PrivateRelayList {
  relays: string[];
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

// Debounce timers for publishing
const publishDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// In-memory cache of private relay list
let cachedPrivateRelays: PrivateRelayList | null = null;

// Track in-flight fetches
let fetchInProgress: Promise<RemoteDraft[]> | null = null;

// ═══════════════════════════════════════════════════════════════
// PRIVATE RELAY LIST (KIND 10013)
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch and decrypt the user's private relay list (kind 10013)
 * Falls back to NIP-65 write relays, then default relays
 */
export async function getPrivateRelays(pubkey: string): Promise<string[]> {
  if (!browser) return DEFAULT_PRIVATE_RELAYS;

  // Return cached if fresh (less than 5 minutes old)
  if (cachedPrivateRelays && Date.now() - cachedPrivateRelays.updatedAt < 5 * 60 * 1000) {
    return cachedPrivateRelays.relays;
  }

  try {
    await ndkReady;
    const ndkInstance = getNdkInstance();

    // Try to fetch kind 10013 event
    const filter: NDKFilter = {
      kinds: [KIND_PRIVATE_RELAY_LIST],
      authors: [pubkey],
      limit: 1
    };

    const events = await Promise.race([
      ndkInstance.fetchEvents(filter),
      new Promise<Set<NDKEvent>>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), NETWORK_TIMEOUT_MS)
      )
    ]);

    if (events.size > 0) {
      const event = [...events][0];

      // Content is NIP-44 encrypted relay URLs
      if (event.content) {
        try {
          const method = detectEncryptionMethod(event.content);
          const decrypted = await decrypt(pubkey, event.content, method);
          const relayData = JSON.parse(decrypted);

          // Extract relay URLs from decrypted content
          // Format: array of relay URLs or object with 'relays' key
          let relays: string[] = [];
          if (Array.isArray(relayData)) {
            relays = relayData.filter((r: unknown) => typeof r === 'string');
          } else if (relayData.relays && Array.isArray(relayData.relays)) {
            relays = relayData.relays.filter((r: unknown) => typeof r === 'string');
          }

          if (relays.length > 0) {
            cachedPrivateRelays = { relays, updatedAt: Date.now() };
            console.log('[NIP-37] Found private relay list:', relays);
            return relays;
          }
        } catch (e) {
          console.warn('[NIP-37] Failed to decrypt private relay list:', e);
        }
      }

      // Check for unencrypted relay tags (some implementations)
      const relayTags = event.tags.filter(t => t[0] === 'relay' && t[1]);
      if (relayTags.length > 0) {
        const relays = relayTags.map(t => t[1]);
        cachedPrivateRelays = { relays, updatedAt: Date.now() };
        console.log('[NIP-37] Found private relays from tags:', relays);
        return relays;
      }
    }
  } catch (e) {
    console.warn('[NIP-37] Failed to fetch private relay list:', e);
  }

  // Fallback: Use NIP-65 outbox relays
  try {
    const outboxRelays = await getOutboxRelays(pubkey);
    if (outboxRelays.length > 0) {
      console.log('[NIP-37] Using NIP-65 outbox relays as fallback:', outboxRelays);
      cachedPrivateRelays = { relays: outboxRelays, updatedAt: Date.now() };
      return outboxRelays;
    }
  } catch (e) {
    console.warn('[NIP-37] Failed to get outbox relays:', e);
  }

  // Final fallback
  console.log('[NIP-37] Using default private relays');
  return DEFAULT_PRIVATE_RELAYS;
}

/**
 * Publish/update the user's private relay list (kind 10013)
 */
export async function setPrivateRelays(relays: string[]): Promise<boolean> {
  if (!browser) return false;

  const pubkey = get(userPublickey);
  if (!pubkey) {
    console.error('[NIP-37] Cannot set private relays: not logged in');
    return false;
  }

  if (!hasEncryptionSupport()) {
    console.error('[NIP-37] Cannot set private relays: encryption not supported');
    return false;
  }

  try {
    await ndkReady;
    const ndkInstance = getNdkInstance();

    // Encrypt relay list to self
    const content = JSON.stringify({ relays });
    const { ciphertext } = await encrypt(pubkey, content);

    // Create kind 10013 event
    const event = new NDKEvent(ndkInstance);
    event.kind = KIND_PRIVATE_RELAY_LIST;
    event.content = ciphertext;
    event.tags = [];

    // Sign and publish to NIP-65 write relays
    await event.sign();

    const writeRelays = await getOutboxRelays(pubkey);
    if (writeRelays.length > 0) {
      const relaySet = NDKRelaySet.fromRelayUrls(writeRelays, ndkInstance);
      await event.publish(relaySet);
    } else {
      await event.publish();
    }

    // Update cache
    cachedPrivateRelays = { relays, updatedAt: Date.now() };

    console.log('[NIP-37] Private relay list published');
    return true;
  } catch (e) {
    console.error('[NIP-37] Failed to publish private relay list:', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// DRAFT ENCRYPTION/DECRYPTION
// ═══════════════════════════════════════════════════════════════

/**
 * Create encrypted draft content for NIP-37 (recipe)
 * Contains the unsigned recipe event data
 */
async function encryptDraftContent(draft: RecipeDraft, pubkey: string): Promise<string> {
  // Create the unsigned event content that would be published as kind 30023
  const unsignedEvent = {
    kind: KIND_RECIPE,
    content: buildRecipeMarkdown(draft),
    tags: buildRecipeTags(draft),
    created_at: Math.floor(draft.updatedAt / 1000)
  };

  const plaintext = JSON.stringify(unsignedEvent);
  const { ciphertext } = await encrypt(pubkey, plaintext);

  return ciphertext;
}

/**
 * Create encrypted draft content for NIP-37 (article)
 * Contains the unsigned article event data
 */
async function encryptArticleDraftContent(draft: ArticleDraft, pubkey: string): Promise<string> {
  // Initialize turndown for HTML to Markdown conversion
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
  });

  // Create the unsigned event content that would be published as kind 30023
  const unsignedEvent = {
    kind: 30023, // Same kind as recipes, but distinguished by tags
    content: turndownService.turndown(draft.content || ''),
    tags: buildArticleTags(draft),
    created_at: Math.floor(draft.updatedAt / 1000)
  };

  const plaintext = JSON.stringify(unsignedEvent);
  const { ciphertext } = await encrypt(pubkey, plaintext);

  return ciphertext;
}

/**
 * Decrypt draft content from NIP-37 event
 */
async function decryptDraftContent(content: string, pubkey: string, draftType: 'recipe' | 'article' = 'recipe'): Promise<RecipeDraft | ArticleDraft | null> {
  try {
    const method = detectEncryptionMethod(content);
    const decrypted = await decrypt(pubkey, content, method);
    const eventData = JSON.parse(decrypted);

    // Parse based on draft type
    if (draftType === 'article') {
      return parseArticleToDraft(eventData);
    } else {
      return parseRecipeToDraft(eventData);
    }
  } catch (e) {
    console.error('[NIP-37] Failed to decrypt draft:', e);
    return null;
  }
}

/**
 * Build recipe markdown from draft
 */
function buildRecipeMarkdown(draft: RecipeDraft): string {
  const parts: string[] = [];

  // Summary
  if (draft.summary) {
    parts.push(draft.summary);
    parts.push('');
  }

  // Chef's notes
  if (draft.chefsnotes) {
    parts.push("## Chef's Notes");
    parts.push(draft.chefsnotes);
    parts.push('');
  }

  // Ingredients
  if (draft.ingredients.length > 0) {
    parts.push('## Ingredients');
    for (const ingredient of draft.ingredients) {
      if (ingredient.trim()) {
        parts.push(`- ${ingredient}`);
      }
    }
    parts.push('');
  }

  // Directions
  if (draft.directions.length > 0) {
    parts.push('## Directions');
    for (let i = 0; i < draft.directions.length; i++) {
      if (draft.directions[i].trim()) {
        parts.push(`${i + 1}. ${draft.directions[i]}`);
      }
    }
    parts.push('');
  }

  // Additional markdown
  if (draft.additionalMarkdown) {
    parts.push(draft.additionalMarkdown);
  }

  return parts.join('\n');
}

/**
 * Build recipe tags from draft
 */
function buildRecipeTags(draft: RecipeDraft): string[][] {
  const tags: string[][] = [];

  // Title
  if (draft.title) {
    tags.push(['title', draft.title]);
  }

  // Images
  for (const image of draft.images) {
    if (image) {
      tags.push(['image', image]);
    }
  }

  // Recipe tags
  for (const tag of draft.tags) {
    tags.push(['t', `zapcooking-${tag.title.toLowerCase()}`]);
  }

  // Time and servings
  if (draft.preptime) {
    tags.push(['preptime', draft.preptime]);
  }
  if (draft.cooktime) {
    tags.push(['cooktime', draft.cooktime]);
  }
  if (draft.servings) {
    tags.push(['servings', draft.servings]);
  }

  return tags;
}

/**
 * Build article tags from draft
 */
function buildArticleTags(draft: ArticleDraft): string[][] {
  const tags: string[][] = [];

  // Title
  if (draft.title) {
    tags.push(['title', draft.title]);
  }

  // Subtitle/Summary
  if (draft.subtitle) {
    tags.push(['summary', draft.subtitle]);
  }

  // Cover image
  if (draft.coverImage) {
    tags.push(['image', draft.coverImage]);
  }

  // Article tag (zapreads)
  tags.push(['t', 'zapreads']);

  // User-defined tags
  for (const tag of draft.tags) {
    if (tag.trim()) {
      tags.push(['t', tag.toLowerCase().trim()]);
    }
  }

  return tags;
}

/**
 * Parse article event data back to draft format
 */
function parseArticleToDraft(eventData: { kind: number; content: string; tags: string[][]; created_at?: number }, draftId?: string): ArticleDraft {
  const tags = eventData.tags || [];
  const content = eventData.content || '';

  // Extract from tags
  const title = tags.find(t => t[0] === 'title')?.[1] || '';
  const subtitle = tags.find(t => t[0] === 'summary')?.[1] || '';
  const coverImage = tags.find(t => t[0] === 'image')?.[1] || '';

  // Extract user-defined tags (exclude zapreads)
  const userTags = tags
    .filter(t => t[0] === 't' && t[1] !== 'zapreads')
    .map(t => t[1] || '');

  // Convert markdown back to HTML for Tiptap
  // Drafts store HTML, so we need to convert the markdown from NIP-37
  const htmlContent = parseMarkdown(content);

  const timestamp = (eventData.created_at || Math.floor(Date.now() / 1000)) * 1000;

  return {
    id: draftId || `draft_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    title,
    subtitle,
    content: htmlContent,
    coverImage,
    tags: userTags,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/**
 * Parse recipe event data back to draft format
 */
function parseRecipeToDraft(eventData: { kind: number; content: string; tags: string[][]; created_at?: number }, draftId?: string): RecipeDraft {
  const tags = eventData.tags || [];
  const content = eventData.content || '';

  // Extract from tags
  const title = tags.find(t => t[0] === 'title')?.[1] || '';
  const images = tags.filter(t => t[0] === 'image').map(t => t[1]);
  const preptime = tags.find(t => t[0] === 'preptime')?.[1] || '';
  const cooktime = tags.find(t => t[0] === 'cooktime')?.[1] || '';
  const servings = tags.find(t => t[0] === 'servings')?.[1] || '';

  // Extract recipe tags
  const recipeTags = tags
    .filter(t => t[0] === 't' && (t[1]?.startsWith('zapcooking-') || t[1]?.startsWith('nostrcooking-')))
    .map(t => {
      const tagName = t[1].replace(/^(zapcooking|nostrcooking)-/, '');
      return { title: tagName.charAt(0).toUpperCase() + tagName.slice(1) };
    });

  // Parse content sections
  const sections = parseRecipeContent(content);

  const timestamp = (eventData.created_at || Math.floor(Date.now() / 1000)) * 1000;

  return {
    id: draftId || `draft_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    title,
    images,
    tags: recipeTags,
    summary: sections.summary,
    chefsnotes: sections.chefsnotes,
    preptime,
    cooktime,
    servings,
    ingredients: sections.ingredients,
    directions: sections.directions,
    additionalMarkdown: sections.additionalMarkdown,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

/**
 * Parse recipe markdown content into sections
 */
function parseRecipeContent(content: string): {
  summary: string;
  chefsnotes: string;
  ingredients: string[];
  directions: string[];
  additionalMarkdown: string;
} {
  const result = {
    summary: '',
    chefsnotes: '',
    ingredients: [] as string[],
    directions: [] as string[],
    additionalMarkdown: ''
  };

  if (!content) return result;

  const lines = content.split('\n');
  let currentSection = 'summary';
  let additionalStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase().trim();

    // Detect section headers
    if (lowerLine.startsWith("## chef's notes") || lowerLine.startsWith('## chefs notes')) {
      currentSection = 'chefsnotes';
      continue;
    } else if (lowerLine.startsWith('## ingredients')) {
      currentSection = 'ingredients';
      continue;
    } else if (lowerLine.startsWith('## directions') || lowerLine.startsWith('## instructions') || lowerLine.startsWith('## steps')) {
      currentSection = 'directions';
      continue;
    } else if (lowerLine.startsWith('## ') && currentSection === 'directions') {
      // Any other ## header after directions is additional content
      additionalStart = i;
      break;
    }

    // Add content to current section
    switch (currentSection) {
      case 'summary':
        if (line.trim()) {
          result.summary += (result.summary ? '\n' : '') + line;
        }
        break;
      case 'chefsnotes':
        if (line.trim()) {
          result.chefsnotes += (result.chefsnotes ? '\n' : '') + line;
        }
        break;
      case 'ingredients':
        if (line.trim().startsWith('- ')) {
          result.ingredients.push(line.trim().substring(2));
        } else if (line.trim().startsWith('* ')) {
          result.ingredients.push(line.trim().substring(2));
        }
        break;
      case 'directions':
        // Match numbered lines like "1. " or "1) "
        const match = line.trim().match(/^\d+[.)]\s*(.+)/);
        if (match) {
          result.directions.push(match[1]);
        }
        break;
    }
  }

  // Capture additional markdown
  if (additionalStart >= 0) {
    result.additionalMarkdown = lines.slice(additionalStart).join('\n');
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// FETCH REMOTE DRAFTS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch all drafts from remote relays
 * Uses deduplication and returns the newest version of each draft
 */
export async function fetchRemoteDrafts(): Promise<RemoteDraft[]> {
  if (!browser) return [];

  const pubkey = get(userPublickey);
  if (!pubkey) {
    console.log('[NIP-37] Cannot fetch drafts: not logged in');
    return [];
  }

  if (!hasEncryptionSupport()) {
    console.log('[NIP-37] Cannot fetch drafts: encryption not supported');
    return [];
  }

  // Dedupe in-flight fetches
  if (fetchInProgress) {
    return fetchInProgress;
  }

  fetchInProgress = (async () => {
    try {
      await ndkReady;
      const ndkInstance = getNdkInstance();

      // Get private relays
      const relays = await getPrivateRelays(pubkey);

      console.log('[NIP-37] Fetching drafts from relays:', relays);

      // Create relay set
      const relaySet = NDKRelaySet.fromRelayUrls(relays, ndkInstance);

      // Fetch kind 31234 events for both recipe and article drafts
      const filter: NDKFilter = {
        kinds: [KIND_DRAFT_WRAP],
        authors: [pubkey]
        // Don't filter by #k - fetch all drafts and filter by #draft-type tag
      };

      const events = await Promise.race([
        ndkInstance.fetchEvents(filter, {}, relaySet),
        new Promise<Set<NDKEvent>>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), NETWORK_TIMEOUT_MS)
        )
      ]);

      console.log(`[NIP-37] Fetched ${events.size} draft events`);

      // Process and deduplicate drafts
      const draftsMap = new Map<string, RemoteDraft>();
      const now = Date.now();

      for (const event of events) {
        // Get d-tag (draft identifier)
        const dTag = event.tags.find(t => t[0] === 'd')?.[1];
        if (!dTag) continue;

        // Check expiration
        const expirationTag = event.tags.find(t => t[0] === 'expiration');
        const expiresAt = expirationTag ? parseInt(expirationTag[1]) * 1000 : null;

        if (expiresAt && expiresAt < now) {
          console.log(`[NIP-37] Skipping expired draft: ${dTag}`);
          continue;
        }

        // Check if content is empty (deletion marker)
        if (!event.content || event.content.trim() === '') {
          console.log(`[NIP-37] Skipping deleted draft: ${dTag}`);
          continue;
        }

        // Determine draft type from tags
        const draftTypeTag = event.tags.find(t => t[0] === 'draft-type');
        const draftType: 'recipe' | 'article' = draftTypeTag?.[1] === 'article' ? 'article' : 'recipe';

        // Decrypt content
        const draft = await decryptDraftContent(event.content, pubkey, draftType);
        if (!draft) continue;

        // Use d-tag as draft ID
        draft.id = dTag;

        const eventCreatedAt = (event.created_at || 0) * 1000;

        // Keep newest version
        const existing = draftsMap.get(dTag);
        if (!existing || eventCreatedAt > existing.createdAt) {
          draftsMap.set(dTag, {
            id: dTag,
            eventId: event.id,
            draft,
            draftType,
            createdAt: eventCreatedAt,
            expiresAt
          });
        }
      }

      const drafts = [...draftsMap.values()];
      console.log(`[NIP-37] Processed ${drafts.length} unique drafts`);

      return drafts;
    } catch (e) {
      console.error('[NIP-37] Failed to fetch drafts:', e);
      return [];
    } finally {
      fetchInProgress = null;
    }
  })();

  return fetchInProgress;
}

// ═══════════════════════════════════════════════════════════════
// PUBLISH DRAFT
// ═══════════════════════════════════════════════════════════════

/**
 * Publish a draft to remote relays (with debouncing)
 */
export function publishDraftDebounced(draft: RecipeDraft): void {
  if (!browser) return;

  const pubkey = get(userPublickey);
  if (!pubkey || !hasEncryptionSupport()) return;

  // Clear existing timer for this draft
  const existingTimer = publishDebounceTimers.get(draft.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new debounce timer
  const timer = setTimeout(() => {
    publishDebounceTimers.delete(draft.id);
    publishDraft(draft).catch(e => {
      console.error('[NIP-37] Debounced publish failed:', e);
    });
  }, PUBLISH_DEBOUNCE_MS);

  publishDebounceTimers.set(draft.id, timer);
}

/**
 * Immediately publish a draft to remote relays
 */
export async function publishDraft(draft: RecipeDraft): Promise<boolean> {
  if (!browser) return false;

  const pubkey = get(userPublickey);
  if (!pubkey) {
    console.error('[NIP-37] Cannot publish draft: not logged in');
    return false;
  }

  if (!hasEncryptionSupport()) {
    console.error('[NIP-37] Cannot publish draft: encryption not supported');
    return false;
  }

  try {
    await ndkReady;
    const ndkInstance = getNdkInstance();

    // Encrypt draft content
    const encryptedContent = await encryptDraftContent(draft, pubkey);

    // Create kind 31234 event
    const event = new NDKEvent(ndkInstance);
    event.kind = KIND_DRAFT_WRAP;
    event.content = encryptedContent;

    // Calculate expiration (90 days from now)
    const expirationTime = Math.floor(Date.now() / 1000) + (DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60);

    event.tags = [
      ['d', draft.id],                           // Addressable identifier
      ['k', String(KIND_RECIPE)],                // Draft kind
      ['draft-type', 'recipe'],                  // Draft type
      ['expiration', String(expirationTime)]     // NIP-40 expiration
    ];

    // Sign the event
    await event.sign();

    // Get private relays
    const relays = await getPrivateRelays(pubkey);

    console.log('[NIP-37] Publishing draft to relays:', relays);

    // Publish to private relays
    const relaySet = NDKRelaySet.fromRelayUrls(relays, ndkInstance);
    await event.publish(relaySet);

    console.log(`[NIP-37] Draft published: ${draft.id}`);
    return true;
  } catch (e) {
    console.error('[NIP-37] Failed to publish draft:', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// DELETE DRAFT
// ═══════════════════════════════════════════════════════════════

/**
 * Publish an article draft to remote relays (with debouncing)
 */
export function publishArticleDraftDebounced(draft: ArticleDraft): void {
  if (!browser) return;

  const pubkey = get(userPublickey);
  if (!pubkey || !hasEncryptionSupport()) return;

  // Clear existing timer for this draft
  const existingTimer = publishDebounceTimers.get(draft.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Set new debounce timer
  const timer = setTimeout(() => {
    publishDebounceTimers.delete(draft.id);
    publishArticleDraft(draft).catch(e => {
      console.error('[NIP-37] Debounced article publish failed:', e);
    });
  }, PUBLISH_DEBOUNCE_MS);

  publishDebounceTimers.set(draft.id, timer);
}

/**
 * Immediately publish an article draft to remote relays
 */
export async function publishArticleDraft(draft: ArticleDraft): Promise<boolean> {
  if (!browser) return false;

  const pubkey = get(userPublickey);
  if (!pubkey) {
    console.error('[NIP-37] Cannot publish article draft: not logged in');
    return false;
  }

  if (!hasEncryptionSupport()) {
    console.error('[NIP-37] Cannot publish article draft: encryption not supported');
    return false;
  }

  try {
    await ndkReady;
    const ndkInstance = getNdkInstance();

    // Encrypt draft content
    const encryptedContent = await encryptArticleDraftContent(draft, pubkey);

    // Create kind 31234 event
    const event = new NDKEvent(ndkInstance);
    event.kind = KIND_DRAFT_WRAP;
    event.content = encryptedContent;

    // Calculate expiration (90 days from now)
    const expirationTime = Math.floor(Date.now() / 1000) + (DEFAULT_EXPIRATION_DAYS * 24 * 60 * 60);

    event.tags = [
      ['d', draft.id],                           // Addressable identifier
      ['k', String(30023)],                      // Draft kind (same as recipes)
      ['draft-type', 'article'],                 // Draft type to distinguish from recipes
      ['expiration', String(expirationTime)]     // NIP-40 expiration
    ];

    // Sign the event
    await event.sign();

    // Get private relays
    const relays = await getPrivateRelays(pubkey);

    console.log('[NIP-37] Publishing article draft to relays:', relays);

    // Publish to private relays
    const relaySet = NDKRelaySet.fromRelayUrls(relays, ndkInstance);
    await event.publish(relaySet);

    console.log(`[NIP-37] Article draft published: ${draft.id}`);
    return true;
  } catch (e) {
    console.error('[NIP-37] Failed to publish article draft:', e);
    return false;
  }
}

/**
 * Delete a draft from remote relays
 * Per NIP-37, this is done by publishing an event with empty content
 */
export async function deleteDraftRemote(draftId: string, draftType: 'recipe' | 'article' = 'recipe'): Promise<boolean> {
  if (!browser) return false;

  const pubkey = get(userPublickey);
  if (!pubkey) {
    console.error('[NIP-37] Cannot delete draft: not logged in');
    return false;
  }

  try {
    await ndkReady;
    const ndkInstance = getNdkInstance();

    // Create kind 31234 event with empty content (deletion marker)
    const event = new NDKEvent(ndkInstance);
    event.kind = KIND_DRAFT_WRAP;
    event.content = '';  // Empty content = deletion
    event.tags = [
      ['d', draftId],
      ['k', String(30023)],
      ['draft-type', draftType]
    ];

    // Sign the event
    await event.sign();

    // Get private relays
    const relays = await getPrivateRelays(pubkey);

    // Publish to private relays
    const relaySet = NDKRelaySet.fromRelayUrls(relays, ndkInstance);
    await event.publish(relaySet);

    console.log(`[NIP-37] Draft deleted: ${draftId}`);
    return true;
  } catch (e) {
    console.error('[NIP-37] Failed to delete draft:', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Check if NIP-37 draft sync is available
 */
export function isDraftSyncAvailable(): boolean {
  if (!browser) return false;

  const pubkey = get(userPublickey);
  return !!pubkey && hasEncryptionSupport();
}

/**
 * Cancel pending publish for a draft
 */
export function cancelPendingPublish(draftId: string): void {
  const timer = publishDebounceTimers.get(draftId);
  if (timer) {
    clearTimeout(timer);
    publishDebounceTimers.delete(draftId);
  }
}

/**
 * Flush all pending publishes immediately
 */
export async function flushPendingPublishes(): Promise<void> {
  // This would need draft data stored somewhere - for now just clear timers
  for (const [draftId, timer] of publishDebounceTimers) {
    clearTimeout(timer);
    publishDebounceTimers.delete(draftId);
  }
}

/**
 * Clear cached private relay list
 */
export function clearPrivateRelayCache(): void {
  cachedPrivateRelays = null;
}
