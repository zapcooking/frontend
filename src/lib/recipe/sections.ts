/**
 * The parts of a recipe's markdown that are shown as interactive lists:
 * the ingredients and the directions. Shared by the recipe page and the
 * Go live recipe panel, so both read a recipe the same way.
 */
import { extractAndGroupDirections, type DirectionPhase } from '$lib/parser';

const INGREDIENTS_SECTION = /## Ingredients\s*\n([\s\S]*?)(?=\n## |$)/i;

/**
 * The markdown before the `## Directions` heading (all of it when there is
 * no such heading). Ingredients always sit in this part.
 */
export function markdownBeforeDirections(content: string): string {
  const at = content.indexOf('## Directions');
  return at === -1 ? content : content.slice(0, at);
}

/**
 * The ingredient lines of a `## Ingredients` section, as the recipe page
 * shows them: list markers removed, blank lines and sub-headings skipped.
 * Empty when there is no such section.
 */
export function extractIngredientItems(markdown: string): string[] {
  const match = markdown.match(INGREDIENTS_SECTION);
  if (!match) return [];
  const items: string[] = [];
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) items.push(trimmed.substring(2).trim());
    else if (trimmed.startsWith('* ')) items.push(trimmed.substring(2).trim());
    else if (trimmed && !trimmed.startsWith('#')) items.push(trimmed);
  }
  return items;
}

/** Remove the `## Ingredients` section from a chunk of markdown. */
export function withoutIngredientsSection(markdown: string): string {
  return markdown.replace(INGREDIENTS_SECTION, '').trim();
}

export interface RecipeSections {
  ingredients: string[];
  directions: DirectionPhase[];
}

/** Ingredients and directions of a recipe's markdown. */
export function recipeSections(content: string): RecipeSections {
  return {
    ingredients: extractIngredientItems(markdownBeforeDirections(content)),
    directions: extractAndGroupDirections(content).directions
  };
}
