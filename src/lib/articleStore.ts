/**
 * Shared article store — single source of truth for articles across reads and explore pages.
 * Articles are fetched once and cached in this store + IndexedDB.
 */
import { writable, derived, get } from 'svelte/store';
import type { ArticleData, CuratedCover } from './articleUtils';
import { isValidLongformArticle, curateCover } from './articleUtils';

// All articles (any topic)
export const articleStore = writable<ArticleData[]>([]);

// Cover (food-editorial, always curated from food articles)
export const coverStore = writable<CuratedCover | null>(null);

// Derived: food-only articles for cover and Food/Farming categories
export const foodArticles = derived(articleStore, ($articles) =>
  $articles.filter((a) => isValidLongformArticle(a.event))
);

/**
 * Add articles to the shared store (deduplicates by ID)
 */
export function addArticles(newArticles: ArticleData[]) {
  articleStore.update((existing) => {
    const ids = new Set(existing.map((a) => a.id));
    const unique = newArticles.filter((a) => !ids.has(a.id));
    if (unique.length === 0) return existing;
    return [...existing, ...unique].sort((a, b) => b.publishedAt - a.publishedAt);
  });
}

/**
 * Refresh the cover from current food articles
 */
export function refreshCover(forceRefresh: boolean = false) {
  const food = get(foodArticles);
  if (food.length >= 1) {
    coverStore.set(curateCover(food, forceRefresh));
  }
}

/**
 * Clear the store (e.g. on manual refresh)
 */
export function clearArticleStore() {
  articleStore.set([]);
  coverStore.set(null);
}
