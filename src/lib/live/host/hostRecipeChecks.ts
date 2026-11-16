/**
 * The host's recipe check marks while live: kept on this device only, and
 * fresh for each stream. The shared recipe panel stores its ingredient and
 * step checks (and the serving scale) in localStorage under a per-recipe
 * key; the host page passes a per-session scope instead, so a new stream
 * starts unticked and the recipe page's own checks are left alone.
 */

/** The localStorage prefixes the recipe components write under. */
export const RECIPE_CHECK_PREFIXES = [
  'recipe_ingredients_checked:',
  'recipe_ingredients_scale:',
  'recipe_directions_checked:'
] as const;

const SCOPE_PREFIX = 'live:';

/** The scope for one stream's checks: `live:<sessionId>`. */
export function hostCheckScope(sessionId: string): string {
  return `${SCOPE_PREFIX}${sessionId}`;
}

/** The id the recipe components key their storage by, for one stream. */
export function hostCheckRecipeId(sessionId: string, recipeId: string): string {
  return `${hostCheckScope(sessionId)}:${recipeId}`;
}

type KeyStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

/**
 * Remove check marks left by earlier streams, keeping `keepSessionId`'s.
 * Only keys this page wrote (the `live:` scope) are touched. Never throws:
 * storage can be missing or locked in a private window.
 */
export function pruneHostChecks(storage: KeyStorage | null, keepSessionId: string | null): number {
  if (!storage) return 0;
  const keep = keepSessionId ? `${hostCheckScope(keepSessionId)}:` : null;
  try {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key) continue;
      const prefix = RECIPE_CHECK_PREFIXES.find((p) => key.startsWith(p));
      if (!prefix) continue;
      const rest = key.slice(prefix.length);
      if (!rest.startsWith(SCOPE_PREFIX)) continue;
      if (keep && rest.startsWith(keep)) continue;
      stale.push(key);
    }
    stale.forEach((key) => storage.removeItem(key));
    return stale.length;
  } catch {
    return 0;
  }
}
