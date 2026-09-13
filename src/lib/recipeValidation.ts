/**
 * The five fields a recipe must have before it can be published.
 * Shared by /create and /create/gated so both forms gate (and explain)
 * the publish button the same way.
 */
export interface RecipeRequiredFields {
  title: string;
  tags: readonly unknown[];
  ingredients: readonly unknown[];
  directions: readonly unknown[];
  images: readonly unknown[];
}

/**
 * Returns human-readable names of the required fields that are still
 * empty, in a stable order suitable for a "Still needed: ..." hint.
 * A whitespace-only title counts as missing — it would otherwise
 * produce a `d` tag of pure dashes.
 */
export function getMissingFields(fields: RecipeRequiredFields): string[] {
  const { title, tags, ingredients, directions, images } = fields;
  return [
    !title.trim() && 'a title',
    tags.length === 0 && 'at least one tag',
    ingredients.length === 0 && 'ingredients',
    directions.length === 0 && 'directions',
    images.length === 0 && 'a photo'
  ].filter((f): f is string => Boolean(f));
}
