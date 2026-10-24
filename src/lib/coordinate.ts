/**
 * NIP-01 addressable-event coordinates: the `kind:pubkey:identifier` value
 * of an `a` tag.
 *
 * Only the first two colons separate fields. The identifier (the event's
 * `d` tag) may itself contain colons: recipes imported from a URL use the
 * URL, and the create form used to keep a title's colon ("Pasta: Weeknight"
 * → `pasta:-weeknight`). Splitting on every colon and expecting three parts
 * silently drops those recipes from lists, packs, plans and grocery runs, so
 * every coordinate in the app is read with `parseCoordinate` (a test fails
 * on any new `split(':')`, see coordinate.guard.test.ts).
 */

export interface Coordinate {
  kind: number;
  /** As written in the tag (hex, any case). */
  pubkey: string;
  /** Everything after the second colon; may be empty, may contain colons. */
  identifier: string;
}

const KIND = /^\d+$/;
const PUBKEY = /^[0-9a-f]{64}$/i;

/**
 * `kind:pubkey:identifier` → its parts, or null unless the kind is a
 * non-negative integer and the pubkey 64 hex characters. An empty
 * identifier is valid NIP-01; callers that need a `d` tag check it.
 */
export function parseCoordinate(a: unknown): Coordinate | null {
  if (typeof a !== 'string') return null;
  const first = a.indexOf(':');
  const second = first < 0 ? -1 : a.indexOf(':', first + 1);
  if (second < 0) return null;
  const kind = a.slice(0, first);
  const pubkey = a.slice(first + 1, second);
  if (!KIND.test(kind) || !PUBKEY.test(pubkey)) return null;
  return { kind: Number(kind), pubkey, identifier: a.slice(second + 1) };
}

export function formatCoordinate(c: { kind: number | string; pubkey: string; identifier: string }): string {
  return `${c.kind}:${c.pubkey}:${c.identifier}`;
}

/**
 * The `d` tag a NEW recipe gets from its title. Colons are stripped so new
 * coordinates stay readable by parsers outside the app that split on every
 * colon. Never applied to an existing recipe: changing its `d` would orphan
 * every list, pack, plan, zap and comment that points at the old address.
 */
export function newRecipeIdentifier(title: string): string {
  return title.toLowerCase().replaceAll(' ', '-').replaceAll(':', '');
}
