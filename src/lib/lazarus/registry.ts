import type { Event } from 'nostr-tools'
import { estimatePrivateItems, getContentEncryption } from './private-items'

/**
 * Lazarus: recovery of user data from relay history.
 *
 * Vendored from the spec’s reference implementation (dmnyc/jumble-spark, branch feat/lazarus-data-recovery)
 * (src/services/lazarus/registry.ts), spec 0.6.0-draft. When the spec
 * reaches 1.0, re-vendor rather than hand-patch, so conformance vectors
 * and kind semantics stay in step.
 *
 * The kind registry below is the single source of truth for how each
 * recoverable kind is counted, ranked, and warned about. The algorithm
 * (scan / rank / delta / recover) never hardcodes kind semantics, so new
 * kinds are added here and nowhere else.
 *
 * Spec: https://github.com/dmnyc/lazarus/blob/main/SPEC.md
 */

export type LazarusRanking = 'count' | 'recency' | 'intent'

export type LazarusWarning = 'remute' | 'stale-relays' | 'affects-others'

export interface LazarusItemCount {
  /** Number of publicly visible items. */
  count: number
  /**
   * True when the event carries encrypted private items that were not
   * decrypted for this count, so the public count may understate the real
   * size of the list.
   */
  partial: boolean
  /** Private items, once the encrypted content has been decrypted. */
  privateCount?: number
  /**
   * Private items estimated from the encrypted payload size, while they
   * haven't been decrypted. Enough to tell an emptied private list from a
   * full one, which the public count alone reads as the same zero.
   */
  privateEstimate?: { min: number; max: number }
}

export interface LazarusKindProfile {
  kind: number
  name: string
  tier: 1 | 2 | 3
  ranking: LazarusRanking
  /**
   * True when an empty item set is a defined state with its own meaning
   * (e.g. kind 10044 announces "no longer using NIP-4e") rather than the
   * fingerprint of a clobbering client. Empty candidates on these kinds
   * are valid options, never labeled as damage, and ranking is disabled:
   * the user must choose with intent.
   */
  meaningfulEmpty: boolean
  requiredWarnings: LazarusWarning[]
  itemCount: (event: Event) => LazarusItemCount
  /**
   * Tag types counted among decrypted private items (NIP-51), for kinds
   * whose content can carry them.
   */
  privateItemTypes?: string[]
}

const MUTE_TAG_TYPES = ['p', 'word', 't', 'e']

function countTags(types: string[], mayHavePrivateItems = false) {
  return (event: Event): LazarusItemCount => {
    const count = event.tags.filter((tag) => types.includes(tag[0])).length
    // Only encrypted content holds private items; kind 3 content is often
    // legacy relay JSON, which isn't a hidden part of the list
    if (!mayHavePrivateItems || !getContentEncryption(event.content)) {
      return { count, partial: false }
    }
    return { count, partial: true, privateEstimate: estimatePrivateItems(event.content) }
  }
}

function contentPresence(event: Event): LazarusItemCount {
  return { count: event.content.trim().length > 0 ? 1 : 0, partial: false }
}

export const LAZARUS_REGISTRY: Record<number, LazarusKindProfile> = {
  3: {
    kind: 3,
    name: 'Follow list',
    tier: 1,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: countTags(['p'], true),
    privateItemTypes: ['p']
  },
  10000: {
    kind: 10000,
    name: 'Mute list',
    tier: 1,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: ['remute', 'affects-others'],
    itemCount: countTags(MUTE_TAG_TYPES, true),
    privateItemTypes: MUTE_TAG_TYPES
  },
  0: {
    kind: 0,
    name: 'Profile metadata',
    tier: 2,
    ranking: 'recency',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: contentPresence
  },
  10003: {
    kind: 10003,
    name: 'Bookmarks',
    tier: 2,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: countTags(['e', 'a'], true),
    privateItemTypes: ['e', 'a']
  },
  10044: {
    kind: 10044,
    name: 'Encryption key list (NIP-4e)',
    tier: 2,
    ranking: 'intent',
    meaningfulEmpty: true,
    requiredWarnings: ['affects-others'],
    // NIP-4e lists encryption pubkeys in `n` tags
    itemCount: countTags(['n'])
  },
  10002: {
    kind: 10002,
    name: 'Relay list',
    tier: 3,
    ranking: 'recency',
    meaningfulEmpty: false,
    requiredWarnings: ['stale-relays'],
    itemCount: countTags(['r'])
  },
  10050: {
    kind: 10050,
    name: 'DM relay inbox',
    tier: 3,
    ranking: 'recency',
    meaningfulEmpty: false,
    requiredWarnings: ['stale-relays'],
    itemCount: countTags(['relay'])
  },
  10006: {
    kind: 10006,
    name: 'Blocked relays',
    tier: 3,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: countTags(['relay'])
  }
}

/** Registry order: tier ascending, then kind ascending. */
export function getLazarusKindProfiles(): LazarusKindProfile[] {
  return Object.values(LAZARUS_REGISTRY).sort((a, b) => a.tier - b.tier || a.kind - b.kind)
}

export function getLazarusKindProfile(kind: number): LazarusKindProfile | undefined {
  return LAZARUS_REGISTRY[kind]
}
