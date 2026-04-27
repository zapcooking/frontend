/**
 * Friendly anonymous-author name generator.
 *
 * Recipes published to Nostr stay published forever, but the author's
 * kind:0 metadata can disappear: account abandoned, profile relays
 * garbage-collected the metadata, kind:5 deletion request, etc. Until
 * now, recipes from those authors rendered as "@Anonymous" or a
 * truncated pubkey hex like `a1b2c3d4...e5f6` — neither communicates
 * that there's a real human behind the recipe.
 *
 * This helper returns a stable, friendly fallback name keyed off the
 * pubkey hash, so the same author always shows the same name across
 * pages and sessions. Stability matters more than randomness here: a
 * user re-encountering a recipe on the discover feed and clicking
 * through to the recipe page should see the same name in both
 * places. We intentionally do NOT randomize per render.
 *
 * Pool mixes:
 *   - Nostr-native references (Nostrich, Sat Chef)
 *   - Zap Cooking nods (Zap Cooking Helper, Kitchen Sprite)
 *   - Friendly cooking archetypes (Sous Chef, Pantry Pal, …)
 *
 * Adding entries is safe — the hash modulo means new names just
 * shift the distribution. Existing pubkey → name mappings won't
 * survive pool reordering, but that's fine: the names are entirely
 * decorative and there's no persisted state tied to them.
 */

const ANON_COOK_NAMES = [
  // Nostr-native
  'Nostrich',
  'Sat Chef',
  'Stacker Sous',

  // Zap Cooking nods
  'Zap Cooking Helper',
  'Kitchen Sprite',
  'Pantry Pal',

  // Friendly cooking archetypes
  'Anon Chef',
  'Sous Chef',
  'Whisk Wizard',
  'Sourdough Stranger',
  'Bread Baron',
  'Soup Sage',
  'Sauce Sage',
  'Stew Steward',
  'Knife Knave',
  'Pan Wanderer',
  'Hearth Helper',
  'Garlic Guardian',
  'Tomato Traveler',
  'Mystery Mixer',
  'Backyard Baker',
  'Cottage Cook',
  'Skillet Sage',
  'Lentil Lord',
  'Honey Hunter',
  'Olive Oracle',
  'Brisket Bard',
  'Charcoal Chef',
  'Fermentation Friend',
  'Roast Ranger',
  'Herb Hermit',
  'Spice Spirit',
  'Salt Sentinel',
  'Pepper Pixie'
] as const;

export type AnonCookName = (typeof ANON_COOK_NAMES)[number];

/**
 * djb2-style string hash — small, deterministic, no dependencies.
 * The XOR variant gives reasonable distribution for short hex inputs
 * (which all 64-char nostr pubkeys are). `Math.abs` covers the case
 * where bitwise ops in JS produce a negative int32 result.
 */
function hashStringToIndex(input: string, mod: number): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  // Coerce to non-negative via abs; mod gives a stable index regardless
  // of sign in the underlying int32.
  return Math.abs(h) % mod;
}

/**
 * Resolve the friendly fallback name for an author whose profile is
 * missing or has no `name` / `displayName` set.
 *
 * @param pubkey hex pubkey (or any stable identifier). When falsy /
 *   undefined / empty, returns the generic 'Anon Chef' so callers
 *   don't have to handle null themselves.
 */
export function getAnonChefName(pubkey?: string | null): AnonCookName | 'Anon Chef' {
  if (!pubkey) return 'Anon Chef';
  return ANON_COOK_NAMES[hashStringToIndex(pubkey, ANON_COOK_NAMES.length)];
}

/** Exposed for tests + consumers that want to inspect the pool. */
export const ANON_COOK_NAME_POOL: readonly AnonCookName[] = ANON_COOK_NAMES;
