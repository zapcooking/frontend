/**
 * Article Utilities for "The Table" magazine feature
 * Handles article processing, cover curation, and content extraction
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import { RECIPE_TAGS } from './consts';
import { validateMarkdownTemplate } from './parser';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ArticleData {
  event: NDKEvent;
  id: string;
  title: string;
  content: string;
  preview: string;
  author: {
    pubkey: string;
    npub: string;
  };
  imageUrl: string | null;
  tags: string[];
  publishedAt: number;
  readTimeMinutes: number;
  articleUrl: string;
}

export interface CuratedCover {
  hero: ArticleData;
  secondary: ArticleData[];
  tertiary: ArticleData[];
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Expanded food-related hashtags for longform content (not recipes)
export const FOOD_LONGFORM_HASHTAGS = [
  // Original food tags
  'foodstr', 'cook', 'cookstr', 'cooking', 'drinkstr', 'foodies',
  'carnivor', 'carnivorediet', 'soup', 'soupstr', 'drink', 'eat',
  'burger', 'steak', 'steakstr', 'dine', 'dinner', 'lunch',
  'breakfast', 'supper', 'yum', 'snack', 'snackstr', 'dessert',
  'beef', 'chicken', 'bbq', 'coffee', 'mealprep', 'meal',
  'recipe', 'recipestr', 'recipes', 'food', 'foodie', 'foodporn',
  'instafood', 'foodstagram', 'foodblogger', 'homecooking',
  'fromscratch', 'baking', 'baker', 'pastry', 'chef', 'chefs',
  'cuisine', 'gourmet', 'restaurant', 'restaurants', 'pasta',
  'pizza', 'sushi', 'tacos', 'taco', 'burrito', 'sandwich',
  'salad', 'stew', 'curry', 'stirfry', 'grill', 'grilled',
  'roast', 'roasted', 'fried', 'baked', 'smoked', 'fermented',
  'pickled', 'preserved', 'homemade', 'vegan', 'vegetarian',
  'keto', 'paleo', 'glutenfree', 'dairyfree', 'healthy',
  'nutrition', 'nutritionist', 'dietitian', 'mealplan', 'batchcooking',
  // Farming and agriculture
  'farming', 'farm', 'farmer', 'farmers', 'agriculture', 'ag',
  'agrarian', 'sustainablefarming', 'organicfarming', 'regenerative',
  'regenerativeagriculture', 'permaculture', 'biodynamic', 'crops',
  'harvest', 'harvesting', 'growing', 'growyourown', 'growfood',
  'foodproduction', 'foodsystem', 'foodsystems',
  // Homesteading
  'homesteading', 'homestead', 'homesteader', 'homesteaders',
  'selfsufficient', 'selfsufficiency', 'offgrid', 'ruralliving',
  'countryliving', 'simpleliving', 'backyardfarming', 'urbanfarming',
  'urbanhomestead', 'urbanhomesteading',
  // Gardening
  'gardening', 'garden', 'gardener', 'growyourownfood',
  'vegetablegarden', 'herbgarden', 'kitchengarden', 'raisedbeds',
  'containergardening', 'composting', 'compost', 'soilhealth',
  // Livestock and animals
  'livestock', 'chickens', 'chickenkeeping', 'goats', 'goatkeeping',
  'beekeeping', 'bees', 'honey', 'eggs', 'dairy', 'milking',
  // Food preservation
  'canning', 'preserving', 'fermentation', 'fermenting', 'dehydrating',
  'dehydration', 'freezing', 'curing', 'smoking', 'cheesemaking', 'cheese',
  // Food sourcing and sustainability
  'localfood', 'locavore', 'farmtotable', 'farmtofork', 'seasonal',
  'seasonaleating', 'sustainable', 'sustainability', 'foodsecurity',
  'foodsovereignty', 'foodjustice',
  // Traditional foodways
  'traditional', 'traditionalfood', 'foodculture', 'culinaryheritage',
  'foodhistory', 'foodtraditions',
  // Health & wellness
  'health', 'wellness', 'wholefood', 'realfood', 'cleaneating',
  // Bitcoin/culture crossover
  'bitcoin', 'carnivore', 'meatmafia', 'rawmilk'
];

// Tag categories for filtering (ordered for UI display)
// Food category is comprehensive to match FOOD_LONGFORM_HASHTAGS
export const ARTICLE_TAG_CATEGORIES: Record<string, string[]> = {
  'All': [],
  'Food': [
    // Core food tags
    'food', 'foodie', 'foodstr', 'foodporn', 'instafood', 'foodstagram', 'foodblogger',
    // Cooking & baking
    'cooking', 'cook', 'cookstr', 'homecooking', 'fromscratch', 'baking', 'baker', 'pastry',
    'chef', 'chefs', 'cuisine', 'gourmet', 'recipe', 'recipes', 'recipestr',
    // Meals
    'breakfast', 'lunch', 'dinner', 'supper', 'dessert', 'snack', 'snackstr', 'mealprep', 'meal',
    // Specific foods
    'pasta', 'pizza', 'sushi', 'tacos', 'taco', 'burrito', 'sandwich', 'salad', 'soup', 'soupstr',
    'stew', 'curry', 'burger', 'steak', 'steakstr', 'bbq', 'coffee',
    // Proteins
    'beef', 'chicken', 'pork', 'seafood', 'fish',
    // Drinks
    'drink', 'drinks', 'drinkstr', 'cocktail', 'wine', 'beer',
    // Methods
    'grill', 'grilled', 'roast', 'roasted', 'fried', 'baked', 'smoked', 'fermented', 'pickled',
    // Diets
    'vegan', 'vegetarian', 'keto', 'paleo', 'glutenfree', 'dairyfree', 'carnivore', 'carnivor', 'carnivorediet',
    // Restaurant
    'restaurant', 'restaurants', 'dine', 'dining'
  ],
  'Farming': [
    'farming', 'farm', 'farmer', 'farmers', 'agriculture', 'ag', 'agrarian',
    'homesteading', 'homestead', 'homesteader', 'gardening', 'garden', 'gardener',
    'permaculture', 'regenerative', 'regenerativeagriculture', 'biodynamic',
    'harvest', 'harvesting', 'growing', 'growyourown', 'growfood',
    'livestock', 'chickens', 'goats', 'beekeeping', 'bees', 'honey',
    'urbanfarming', 'backyardfarming', 'selfsufficient'
  ],
  'Bitcoin': ['bitcoin', 'btc', 'lightning', 'sats', 'satoshi', 'nostr'],
  'Nostr': ['nostr', 'nostrdev', 'grownostr', 'nostrich', 'zap', 'relay', 'nip', 'decentralized'],
  'Travel': ['travel', 'adventure', 'wanderlust', 'roadtrip', 'explore', 'destination', 'tourism', 'backpacking', 'vacation'],
  'Philosophy': ['philosophy', 'stoicism', 'ethics', 'wisdom', 'mindfulness', 'meditation', 'consciousness', 'thinking', 'ideas'],
  'Health': ['health', 'wellness', 'nutrition', 'healthy', 'dietitian', 'nutritionist', 'fitness', 'exercise', 'wholefood', 'realfood']
};

// Category display order
export const ARTICLE_CATEGORY_ORDER = ['All', 'Food', 'Farming', 'Bitcoin', 'Nostr', 'Travel', 'Philosophy', 'Health'];

// Food + Farming tags combined (for "Only Food" cover filter)
export const FOOD_AND_FARMING_TAGS: string[] = [
  ...ARTICLE_TAG_CATEGORIES['Food'],
  ...ARTICLE_TAG_CATEGORIES['Farming']
];

// Food keyword matching (similar to foodstr feed)
// Hard words = very low false-positive risk (1 hit is enough)
const HARD_FOOD_WORDS = [
  // Recipes & cooking intent
  'recipe', 'recipes', 'recipestr', 'cooking', 'baking', 'bake', 'chef', 'chefs', 'kitchen',
  'ingredient', 'ingredients', 'seasoned', 'seasoning', 'marinated', 'saute', 'sauteed',
  'simmer', 'braised', 'fermented', 'pickled', 'smoked', 'slow cooked', 'air fried',
  // Meals
  'breakfast', 'lunch', 'dinner', 'dessert', 'mealprep', 'meal prep', 'homecooking',
  'home cooked', 'fromscratch', 'homemade',
  // Food items & dishes
  'pasta', 'pizza', 'sushi', 'taco', 'tacos', 'burrito', 'sandwich', 'salad', 'soup',
  'stew', 'curry', 'burger', 'steak', 'bbq', 'coffee',
  // Ingredients & staples
  'garlic', 'onion', 'tomato', 'cheese', 'butter', 'olive oil', 'rice', 'beans', 'eggs', 'flour',
  // Diets & preferences
  'vegan', 'vegetarian', 'keto', 'paleo', 'glutenfree', 'gluten free', 'dairyfree', 'dairy free',
  // Restaurants
  'restaurant', 'restaurants'
];

// Soft words = common in metaphor/news/etc (require 2 hits)
const SOFT_FOOD_WORDS = [
  'food', 'meal', 'supper', 'spicy', 'sweet', 'flavor', 'healthy', 'organic',
  'grill', 'grilled', 'roast', 'roasted',
  'italian', 'mexican', 'thai', 'indian', 'mediterranean', 'japanese', 'korean'
];

// Helper to escape special regex characters
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Convert term to regex pattern (supports multi-word phrases)
function termToPattern(term: string): string {
  const parts = term.trim().split(/\s+/).map(escapeRegex);
  if (parts.length === 1) return `\\b${parts[0]}\\b`;
  return `\\b${parts.join('\\s+')}\\b`;
}

// Build precompiled regexes for food keyword matching
const HARD_FOOD_REGEX = new RegExp(HARD_FOOD_WORDS.map(termToPattern).join('|'), 'i');
const SOFT_FOOD_REGEX = new RegExp(SOFT_FOOD_WORDS.map(termToPattern).join('|'), 'i');

/**
 * Check if article title contains food keywords
 * Returns true if:
 * - Has >= 1 HARD food word, OR
 * - Has >= 2 SOFT food words
 */
function hasFoodKeywordsInTitle(title: string): boolean {
  const titleLower = title.toLowerCase();
  
  // Count hard word matches
  const hardMatches = (titleLower.match(HARD_FOOD_REGEX) || []).length;
  if (hardMatches >= 1) return true;
  
  // Count soft word matches
  const softMatches = (titleLower.match(SOFT_FOOD_REGEX) || []).length;
  if (softMatches >= 2) return true;
  
  return false;
}

// All category hashtags combined (for search)
export const ALL_ARTICLE_HASHTAGS: string[] = [
  ...new Set(
    Object.values(ARTICLE_TAG_CATEGORIES)
      .flat()
      .filter(tag => tag.length > 0)
  )
];

// Image patterns
const IMAGE_URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^\[\]`]+\.(jpg|jpeg|png|gif|webp|avif)(\?[^\s<>"{}|\\^\[\]`]*)?)/gi;

// Fallback gradients
export const FALLBACK_GRADIENTS = [
  'linear-gradient(135deg, #ff6b35 0%, #f7931a 100%)', // Warm: orange to bitcoin orange
  'linear-gradient(135deg, #52b788 0%, #40916c 100%)', // Fresh: green tones
  'linear-gradient(135deg, #bc4749 0%, #f2cc8f 100%)', // Rich: red to cream
  'linear-gradient(135deg, #2d3142 0%, #4f5d75 100%)'  // Deep: slate tones
];

// ═══════════════════════════════════════════════════════════════
// IMAGE EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extract the best image from an event
 * Priority: image tag → first content image → null
 */
export function extractImage(event: NDKEvent): string | null {
  const content = event.content || '';
  
  // Check for featured image tag
  const imageTag = event.tags.find((t) => t[0] === 'image' || t[0] === 'picture' || t[0] === 'thumb');
  if (imageTag && imageTag[1]) {
    return imageTag[1];
  }

  // Extract first image URL from content
  const imageMatches = content.match(IMAGE_URL_REGEX);
  if (imageMatches && imageMatches.length > 0) {
    return imageMatches[0];
  }

  return null;
}

/**
 * Get a consistent gradient index based on event ID
 */
export function getGradientIndex(eventId: string): number {
  return parseInt(eventId.slice(0, 8), 16) % FALLBACK_GRADIENTS.length;
}

// ═══════════════════════════════════════════════════════════════
// READ TIME CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate estimated read time in minutes
 * Uses 200-250 words per minute average reading speed
 */
export function calculateReadTime(content: string): number {
  // Remove markdown syntax for accurate word count
  const text = content
    .replace(/#+\s+/g, '') // Headers
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Links to text
    .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '') // Remove images
    .replace(/```[\s\S]*?```/g, '') // Code blocks
    .replace(/`[^`]+`/g, '') // Inline code
    .replace(/\*\*([^\*]+)\*\*/g, '$1') // Bold
    .replace(/\*([^\*]+)\*/g, '$1') // Italic
    .replace(/~~([^~]+)~~/g, '$1') // Strikethrough
    .replace(/>\s+/g, '') // Blockquotes
    .replace(/https?:\/\/[^\s]+/g, '') // URLs
    .trim();

  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const minutes = Math.ceil(words.length / 225); // 225 wpm average
  return Math.max(1, minutes); // Minimum 1 minute
}

// ═══════════════════════════════════════════════════════════════
// CONTENT EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Get article title from event
 */
export function getTitle(event: NDKEvent): string {
  // Try title tag first
  const titleTag = event.tags.find((t) => t[0] === 'title');
  if (titleTag && titleTag[1]) {
    return titleTag[1];
  }
  
  // Fallback: extract from content
  const content = event.content || '';
  const lines = content.split('\n').filter((line) => line.trim());
  
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    // Check if first line is a heading
    if (firstLine.startsWith('# ')) {
      return firstLine.substring(2).trim();
    }
    // Return first line if short enough
    if (firstLine.length < 100) {
      return firstLine;
    }
  }
  
  return 'Untitled Article';
}

/**
 * Clean content and generate preview text
 */
export function generatePreview(content: string, maxLength: number = 180): string {
  let cleaned = content;

  // Remove nostr.news format URLs
  cleaned = cleaned.replace(/https?:\/\/nostr\.news\/[^\s]+\s*/gi, '');

  // Remove URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');

  // Remove markdown images
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

  // Remove markdown links but keep text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

  // Remove markdown headers
  cleaned = cleaned.replace(/^#+\s+/gm, '');

  // Remove code blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

  // Remove markdown formatting
  cleaned = cleaned.replace(/\*\*([^\*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/\*([^\*]+)\*/g, '$1');
  cleaned = cleaned.replace(/`[^`]+`/g, '');
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');
  cleaned = cleaned.replace(/>\s+/gm, '');

  // Get first meaningful paragraph
  const lines = cleaned.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length > 0) {
    const preview = lines[0].trim();
    return preview.length > maxLength 
      ? preview.substring(0, maxLength).trim() + '...' 
      : preview;
  }

  return cleaned.trim().substring(0, maxLength);
}

/**
 * Get relevant tags from event
 * @param event - The NDK event
 * @param allTags - If true, return all tags (not just food-related)
 */
export function getArticleTags(event: NDKEvent, allTags: boolean = false): string[] {
  const tags = event.tags
    .filter((t) => t[0] === 't' && t[1])
    .map((t) => t[1].toLowerCase())
    .filter((tag) => !RECIPE_TAGS.includes(tag)); // Always exclude recipe tags

  if (allTags) {
    return tags.slice(0, 5); // Return all non-recipe tags
  }

  // Filter to only food-related tags
  return tags
    .filter((tag) => FOOD_LONGFORM_HASHTAGS.includes(tag))
    .slice(0, 5);
}

/**
 * Generate article URL (naddr)
 */
export function getArticleUrl(event: NDKEvent): string | null {
  if (!event || event.kind !== 30023) return null;
  
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
  const pubkey = event.author?.hexpubkey || event.pubkey;
  
  if (dTag && pubkey) {
    try {
      const naddr = nip19.naddrEncode({
        identifier: dTag,
        kind: 30023,
        pubkey: pubkey
      });
      return `/r/${naddr}`;
    } catch (e) {
      console.warn('Failed to encode naddr:', e);
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════
// ARTICLE FILTERING & QUALITY CONTROLS
// ═══════════════════════════════════════════════════════════════

// Quality thresholds
const MIN_CONTENT_LENGTH = 300; // Minimum characters for articles
const MIN_READ_TIME_CATEGORY = 1; // 1 minute for category-specific tabs
const MIN_READ_TIME_ALL = 3; // 3 minutes for "All" tab (true longform)
const MIN_READ_TIME_COVER = 2; // 2 minutes for cover articles
const MAX_ARTICLES_PER_AUTHOR = 3; // Limit articles per author in feed

// Spam title patterns (case-insensitive)
const SPAM_TITLE_PATTERNS = [
  /^new\s+.*merchants/i,           // "New X merchants"
  /^\d{4}-\d{2}-\d{2}\s+at\s+\d{2}:\d{2}/i, // Timestamps as titles
  /^ATR:/i,                         // "ATR:" prefix (automated reports)
  /merchant.*list/i,                // Merchant lists
  /^daily\s+/i,                     // "Daily X" automated posts
  /^weekly\s+/i,                    // "Weekly X" automated posts
  /bank-exit/i,                     // Bank-exit spam
  /podcast/i,                       // Podcast episodes
];

// Spam content patterns
const SPAM_CONTENT_PATTERNS = [
  /newly listed.*merchants/i,
  /^discover \d+ newly listed/i,
];

/**
 * Check if content passes quality filters
 * @param event - The NDK event
 * @param minReadTime - Minimum read time in minutes
 */
function passesQualityFilters(event: NDKEvent, minReadTime: number): boolean {
  const content = event.content || '';
  const title = getTitle(event);
  
  // Check minimum content length
  if (content.trim().length < MIN_CONTENT_LENGTH) {
    return false;
  }
  
  // Check minimum read time
  const readTime = calculateReadTime(content);
  if (readTime < minReadTime) {
    return false;
  }
  
  // Check spam title patterns
  for (const pattern of SPAM_TITLE_PATTERNS) {
    if (pattern.test(title)) {
      return false;
    }
  }
  
  // Check spam content patterns
  for (const pattern of SPAM_CONTENT_PATTERNS) {
    if (pattern.test(content.substring(0, 500))) {
      return false;
    }
  }
  
  return true;
}

/**
 * Check if an event is a valid longform article (not a recipe) - requires food hashtags
 * Used for COVER section only - 2-minute minimum read time
 */
export function isValidLongformArticle(event: NDKEvent): boolean {
  // Must be kind 30023
  if (event.kind !== 30023) return false;
  
  // Exclude recipes: check for zapcooking/nostrcooking tags
  const hasRecipeTag = event.tags.some(
    (tag) =>
      Array.isArray(tag) &&
      tag[0] === 't' &&
      RECIPE_TAGS.includes(tag[1]?.toLowerCase() || '')
  );
  
  if (hasRecipeTag) return false;

  // Exclude events that match recipe format
  const content = event.content || '';
  const recipeValidation = validateMarkdownTemplate(content);
  if (typeof recipeValidation !== 'string') {
    // Valid recipe format - exclude it
    return false;
  }

  // Quality filters - 2 min for cover articles
  if (!passesQualityFilters(event, MIN_READ_TIME_COVER)) {
    return false;
  }

  // Check for Food or Farming hashtags (used for "Only Food" cover filter)
  const hasFoodOrFarmingTag = event.tags.some(
    (tag) =>
      Array.isArray(tag) && 
      tag[0] === 't' && 
      FOOD_AND_FARMING_TAGS.includes(tag[1]?.toLowerCase() || '')
  );

  if (hasFoodOrFarmingTag) return true;
  
  // Also check title for food keywords (wider variety of articles)
  const title = getTitle(event);
  if (hasFoodKeywordsInTitle(title)) return true;

  return false;
}

/**
 * Check if an event is a valid longform article (not a recipe) - no food hashtag requirement
 * Used for FEED section - 1-minute minimum (category filtering done separately)
 */
export function isValidLongformArticleNoFoodFilter(event: NDKEvent): boolean {
  // Must be kind 30023
  if (event.kind !== 30023) return false;
  
  // Exclude recipes: check for zapcooking/nostrcooking tags
  const hasRecipeTag = event.tags.some(
    (tag) =>
      Array.isArray(tag) &&
      tag[0] === 't' &&
      RECIPE_TAGS.includes(tag[1]?.toLowerCase() || '')
  );
  
  if (hasRecipeTag) return false;

  // Exclude events that match recipe format
  const content = event.content || '';
  const recipeValidation = validateMarkdownTemplate(content);
  if (typeof recipeValidation !== 'string') {
    // Valid recipe format - exclude it
    return false;
  }

  // Quality filters - 1 min minimum for feed articles
  if (!passesQualityFilters(event, MIN_READ_TIME_CATEGORY)) {
    return false;
  }

  return true;
}

/**
 * Limit articles per author to prevent spam dominance
 * Returns filtered array with max N articles per author
 */
export function limitArticlesPerAuthor(articles: ArticleData[], maxPerAuthor: number = MAX_ARTICLES_PER_AUTHOR): ArticleData[] {
  const authorCounts = new Map<string, number>();
  
  return articles.filter((article) => {
    const pubkey = article.author.pubkey;
    const currentCount = authorCounts.get(pubkey) || 0;
    
    if (currentCount >= maxPerAuthor) {
      return false;
    }
    
    authorCounts.set(pubkey, currentCount + 1);
    return true;
  });
}

/**
 * Filter articles by category
 * "All" tab requires 3+ minute read time, other categories allow 1+ minute
 * Food category includes keyword matching in titles (similar to foodstr feed)
 */
export function filterByCategory(articles: ArticleData[], category: string): ArticleData[] {
  if (category === 'All' || !ARTICLE_TAG_CATEGORIES[category]) {
    // "All" tab: filter to 3+ minute articles only
    return articles.filter((article) => article.readTimeMinutes >= MIN_READ_TIME_ALL);
  }
  
  const categoryTags = ARTICLE_TAG_CATEGORIES[category];
  
  // Special handling for Food category: include keyword matching in titles
  if (category === 'Food') {
    return articles.filter((article) => {
      // Check tags first (strong signal)
      const hasTag = article.tags.some((tag) => categoryTags.includes(tag.toLowerCase()));
      if (hasTag) return true;
      
      // Also check title keywords (wider variety)
      return hasFoodKeywordsInTitle(article.title);
    });
  }
  
  // Other categories: tag-based filtering only
  return articles.filter((article) =>
    article.tags.some((tag) => categoryTags.includes(tag.toLowerCase()))
  );
}

// ═══════════════════════════════════════════════════════════════
// ARTICLE DATA CONVERSION
// ═══════════════════════════════════════════════════════════════

/**
 * Convert NDKEvent to ArticleData
 * @param event - The NDK event
 * @param skipFoodValidation - If true, skip food hashtag validation (for "All Topics" mode)
 */
export function eventToArticleData(event: NDKEvent, skipFoodValidation: boolean = false): ArticleData | null {
  // Validate based on mode
  const isValid = skipFoodValidation 
    ? isValidLongformArticleNoFoodFilter(event)
    : isValidLongformArticle(event);
  
  if (!isValid) return null;
  
  const articleUrl = getArticleUrl(event);
  if (!articleUrl) return null;
  
  const pubkey = event.author?.hexpubkey || event.pubkey;
  
  return {
    event,
    id: event.id,
    title: getTitle(event),
    content: event.content || '',
    preview: generatePreview(event.content || ''),
    author: {
      pubkey,
      npub: nip19.npubEncode(pubkey)
    },
    imageUrl: extractImage(event),
    tags: getArticleTags(event, skipFoodValidation),
    publishedAt: event.created_at || 0,
    readTimeMinutes: calculateReadTime(event.content || ''),
    articleUrl
  };
}

// ═══════════════════════════════════════════════════════════════
// COVER CURATION ALGORITHM
// ═══════════════════════════════════════════════════════════════

const COVER_CACHE_KEY = 'zapcooking_reads_cover';
const COVER_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface CoverCache {
  timestamp: number;
  articleIds: string[];
}

/**
 * Get cached cover article IDs
 */
function getCachedCoverIds(): string[] | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const cached = localStorage.getItem(COVER_CACHE_KEY);
    if (!cached) return null;
    
    const data: CoverCache = JSON.parse(cached);
    const now = Date.now();
    
    // Check if cache is still valid (24 hours)
    if (now - data.timestamp < COVER_CACHE_DURATION) {
      return data.articleIds;
    }
  } catch (e) {
    console.warn('Failed to read cover cache:', e);
  }
  
  return null;
}

/**
 * Save cover article IDs to cache
 */
function saveCoverCache(articleIds: string[]): void {
  if (typeof window === 'undefined') return;
  
  try {
    const data: CoverCache = {
      timestamp: Date.now(),
      articleIds
    };
    localStorage.setItem(COVER_CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save cover cache:', e);
  }
}

/**
 * Clear cover cache (call on manual refresh)
 */
export function clearCoverCache(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(COVER_CACHE_KEY);
}

/**
 * Score an article for hero selection
 * Higher score = better hero candidate
 */
function scoreForHero(article: ArticleData): number {
  let score = 0;
  
  // Longer articles are better for hero (more substantial)
  score += article.readTimeMinutes * 10;
  
  // Articles with images are preferred
  if (article.imageUrl) score += 50;
  
  // More tags indicate more categorization effort
  score += article.tags.length * 5;
  
  // Slight preference for recent articles
  const ageInDays = (Date.now() / 1000 - article.publishedAt) / 86400;
  if (ageInDays < 7) score += 20;
  else if (ageInDays < 30) score += 10;
  
  return score;
}

/**
 * Score an article for visual appeal (secondary/tertiary)
 */
function scoreForVisual(article: ArticleData): number {
  let score = 0;
  
  // Image is crucial for visual appeal
  if (article.imageUrl) score += 100;
  
  // Good title length (not too short, not too long)
  const titleLen = article.title.length;
  if (titleLen > 20 && titleLen < 80) score += 30;
  
  // Has preview text
  if (article.preview.length > 50) score += 20;
  
  // Recent articles
  const ageInDays = (Date.now() / 1000 - article.publishedAt) / 86400;
  if (ageInDays < 14) score += 15;
  
  return score;
}

/**
 * Curate cover articles ensuring author diversity
 * Returns 6 unique authors: 1 hero, 3 secondary, 2 tertiary
 */
export function curateCover(articles: ArticleData[], forceRefresh: boolean = false): CuratedCover | null {
  if (articles.length < 6) {
    // Not enough articles for full cover
    if (articles.length === 0) return null;
    
    // Partial cover
    return {
      hero: articles[0],
      secondary: articles.slice(1, Math.min(4, articles.length)),
      tertiary: articles.slice(4, Math.min(6, articles.length))
    };
  }
  
  // Check for cached cover
  if (!forceRefresh) {
    const cachedIds = getCachedCoverIds();
    if (cachedIds && cachedIds.length === 6) {
      const cachedArticles = cachedIds
        .map((id) => articles.find((a) => a.id === id))
        .filter((a): a is ArticleData => a !== undefined);
      
      if (cachedArticles.length === 6) {
        return {
          hero: cachedArticles[0],
          secondary: cachedArticles.slice(1, 4),
          tertiary: cachedArticles.slice(4, 6)
        };
      }
    }
  }
  
  // Curate new cover with author diversity
  const usedPubkeys = new Set<string>();
  const selectedArticles: ArticleData[] = [];
  
  // Sort articles by hero score for initial selection
  const sortedByHero = [...articles].sort((a, b) => scoreForHero(b) - scoreForHero(a));
  
  // Select hero (best scoring article)
  for (const article of sortedByHero) {
    if (!usedPubkeys.has(article.author.pubkey)) {
      selectedArticles.push(article);
      usedPubkeys.add(article.author.pubkey);
      break;
    }
  }
  
  // Sort remaining by visual appeal for secondary/tertiary
  const sortedByVisual = [...articles]
    .filter((a) => !usedPubkeys.has(a.author.pubkey))
    .sort((a, b) => scoreForVisual(b) - scoreForVisual(a));
  
  // Select secondary (3 articles)
  for (const article of sortedByVisual) {
    if (selectedArticles.length >= 4) break;
    if (!usedPubkeys.has(article.author.pubkey)) {
      selectedArticles.push(article);
      usedPubkeys.add(article.author.pubkey);
    }
  }
  
  // Select tertiary (2 articles) - can include older/diverse content
  const remaining = articles
    .filter((a) => !usedPubkeys.has(a.author.pubkey))
    .sort((a, b) => b.publishedAt - a.publishedAt); // Most recent first
  
  for (const article of remaining) {
    if (selectedArticles.length >= 6) break;
    if (!usedPubkeys.has(article.author.pubkey)) {
      selectedArticles.push(article);
      usedPubkeys.add(article.author.pubkey);
    }
  }
  
  // If we still don't have 6 unique authors, fill with any remaining
  if (selectedArticles.length < 6) {
    const anyRemaining = articles.filter((a) => !selectedArticles.includes(a));
    for (const article of anyRemaining) {
      if (selectedArticles.length >= 6) break;
      selectedArticles.push(article);
    }
  }
  
  // Cache the selection
  saveCoverCache(selectedArticles.map((a) => a.id));
  
  return {
    hero: selectedArticles[0],
    secondary: selectedArticles.slice(1, 4),
    tertiary: selectedArticles.slice(4, 6)
  };
}

// ═══════════════════════════════════════════════════════════════
// SORTING
// ═══════════════════════════════════════════════════════════════

export type SortOption = 'newest' | 'oldest' | 'longest' | 'shortest';

/**
 * Sort articles by criteria
 */
export function sortArticles(articles: ArticleData[], sortBy: SortOption): ArticleData[] {
  const sorted = [...articles];
  
  switch (sortBy) {
    case 'newest':
      return sorted.sort((a, b) => b.publishedAt - a.publishedAt);
    case 'oldest':
      return sorted.sort((a, b) => a.publishedAt - b.publishedAt);
    case 'longest':
      return sorted.sort((a, b) => b.readTimeMinutes - a.readTimeMinutes);
    case 'shortest':
      return sorted.sort((a, b) => a.readTimeMinutes - b.readTimeMinutes);
    default:
      return sorted;
  }
}
