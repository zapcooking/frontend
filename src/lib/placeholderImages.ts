/**
 * Placeholder images for recipes and articles that are missing hero/gallery images.
 * These are randomly selected to add visual variety.
 */

const PLACEHOLDER_IMAGES = [
  'https://image.nostr.build/87c3e4e4c3e24c268106e7352eaa94538815fab6d4104903b9d82fbe4464e7d5.jpg'
  // Add more placeholder images here as needed
];

/**
 * Get a random placeholder image URL.
 * Uses a deterministic seed if provided (e.g., event ID) for consistent results.
 */
export function getPlaceholderImage(seed?: string): string {
  if (seed) {
    // Use seed to get consistent placeholder for the same content
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    const index = Math.abs(hash) % PLACEHOLDER_IMAGES.length;
    return PLACEHOLDER_IMAGES[index];
  }
  // Random selection if no seed
  return PLACEHOLDER_IMAGES[Math.floor(Math.random() * PLACEHOLDER_IMAGES.length)];
}

/**
 * Check if an image URL is valid (not empty, undefined, or whitespace-only)
 */
export function isValidImageUrl(url: string | undefined | null): boolean {
  return Boolean(url && url.trim().length > 0);
}

/**
 * Get an image URL, falling back to a placeholder if the provided URL is invalid.
 * @param imageUrl - The original image URL
 * @param seed - Optional seed for consistent placeholder selection (e.g., event ID)
 */
export function getImageOrPlaceholder(imageUrl: string | undefined | null, seed?: string): string {
  if (isValidImageUrl(imageUrl)) {
    return imageUrl!;
  }
  return getPlaceholderImage(seed);
}
