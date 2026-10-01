import { kinds, type Event } from 'nostr-tools'
import { estimatePrivateItems, getContentEncryption } from './private-items'

/**
 * Lazarus: recovery of user data from relay history.
 *
 * Vendored from the spec’s reference implementation (dmnyc/jumble-spark, branch feat/lazarus-data-recovery)
 * (src/services/lazarus/registry.ts) at spec 0.6.0-draft, since updated to
 * 0.6.2-draft. When the spec reaches 1.0, re-vendor rather than hand-patch,
 * so conformance vectors and kind semantics stay in step.
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
  /**
   * Tag types whose entries are the list's items. Profiles (kind 0) have
   * none: their items are the fields in their content.
   */
  itemTypes?: string[]
  /** True when the items are relay URLs, which compare normalized. */
  relayItems?: boolean
  itemCount: (event: Event) => LazarusItemCount
  /**
   * Tag types counted among decrypted private items (NIP-51), for kinds
   * whose content can carry them.
   */
  privateItemTypes?: string[]
}

/**
 * A relay URL as items compare it: scheme and host lowercased, a default
 * port, repeated slashes and a trailing slash dropped, so a client that
 * rewrote wss://Relay.Example/ as wss://relay.example changed nothing.
 */
export function normalizeLazarusRelayUrl(url: string): string {
  const value = url.trim()
  try {
    const parsed = new URL(value)
    const path = parsed.pathname.replace(/\/+/g, '/').replace(/\/$/, '')
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`
  } catch {
    return value
  }
}

/**
 * What makes a tag an item, and two tags the same item: its type and value.
 * A relay hint or petname a client rewrote doesn't change who is followed or
 * muted. Relay URLs compare normalized, and on relay lists the read/write
 * marker counts too, since it changes what the relay is for. A tag without
 * a value is not an item. Without item types, every tag type counts.
 */
export function getLazarusItemKey(
  profile: Pick<LazarusKindProfile, 'kind' | 'itemTypes' | 'relayItems'>,
  tag: string[]
): string | undefined {
  const [type, value, marker] = tag
  if (!type || !value) return undefined
  if (profile.itemTypes && !profile.itemTypes.includes(type)) return undefined
  const key = profile.relayItems ? normalizeLazarusRelayUrl(value) : value
  return JSON.stringify(profile.kind === kinds.RelayList ? [type, key, marker ?? ''] : [type, key])
}

/** A version's items, keyed as they compare, each item once. */
export function getLazarusItems(
  profile: Pick<LazarusKindProfile, 'kind' | 'itemTypes' | 'relayItems'>,
  tags: string[][]
): Map<string, string[]> {
  const items = new Map<string, string[]>()
  for (const tag of tags) {
    const key = getLazarusItemKey(profile, tag)
    if (key !== undefined && !items.has(key)) items.set(key, tag)
  }
  return items
}

/**
 * A profile's items: the fields of its content that have a value. Content
 * that isn't a JSON object has none, so a profile wiped to {} is empty.
 */
export function getLazarusProfileFields(event: Event | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(event?.content || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== null))
  } catch {
    return {}
  }
}

/** A list kind's profile, counting its public items and sizing any encrypted ones. */
function listKind(profile: Omit<LazarusKindProfile, 'itemCount'>): LazarusKindProfile {
  const listProfile: LazarusKindProfile = {
    ...profile,
    itemCount: (event) => {
      const count = getLazarusItems(listProfile, event.tags).size
      // Only encrypted content holds private items; kind 3 content is often
      // legacy relay JSON, which isn't a hidden part of the list
      if (!profile.privateItemTypes || !getContentEncryption(event.content)) {
        return { count, partial: false }
      }
      return { count, partial: true, privateEstimate: estimatePrivateItems(event.content) }
    }
  }
  return listProfile
}

const MUTE_TAG_TYPES = ['p', 'word', 't', 'e']

export const LAZARUS_REGISTRY: Record<number, LazarusKindProfile> = {
  3: listKind({
    kind: 3,
    name: 'Follow list',
    tier: 1,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemTypes: ['p'],
    privateItemTypes: ['p']
  }),
  10000: listKind({
    kind: 10000,
    name: 'Mute list',
    tier: 1,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: ['remute', 'affects-others'],
    itemTypes: MUTE_TAG_TYPES,
    privateItemTypes: MUTE_TAG_TYPES
  }),
  0: {
    kind: 0,
    name: 'Profile metadata',
    tier: 2,
    ranking: 'recency',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemCount: (event) => ({
      count: Object.keys(getLazarusProfileFields(event)).length,
      partial: false
    })
  },
  10003: listKind({
    kind: 10003,
    name: 'Bookmarks',
    tier: 2,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemTypes: ['e', 'a'],
    privateItemTypes: ['e', 'a']
  }),
  10044: listKind({
    kind: 10044,
    name: 'Encryption key list (NIP-4e)',
    tier: 2,
    ranking: 'intent',
    meaningfulEmpty: true,
    requiredWarnings: ['affects-others'],
    // NIP-4e lists encryption pubkeys in `n` tags
    itemTypes: ['n']
  }),
  10002: listKind({
    kind: 10002,
    name: 'Relay list',
    tier: 3,
    ranking: 'recency',
    meaningfulEmpty: false,
    requiredWarnings: ['stale-relays'],
    itemTypes: ['r'],
    relayItems: true
  }),
  10050: listKind({
    kind: 10050,
    name: 'DM relay inbox',
    tier: 3,
    ranking: 'recency',
    meaningfulEmpty: false,
    requiredWarnings: ['stale-relays'],
    itemTypes: ['relay'],
    relayItems: true
  }),
  10006: listKind({
    kind: 10006,
    name: 'Blocked relays',
    tier: 3,
    ranking: 'count',
    meaningfulEmpty: false,
    requiredWarnings: [],
    itemTypes: ['relay'],
    relayItems: true
  })
}

/** Registry order: tier ascending, then kind ascending. */
export function getLazarusKindProfiles(): LazarusKindProfile[] {
  return Object.values(LAZARUS_REGISTRY).sort((a, b) => a.tier - b.tier || a.kind - b.kind)
}

export function getLazarusKindProfile(kind: number): LazarusKindProfile | undefined {
  return LAZARUS_REGISTRY[kind]
}
