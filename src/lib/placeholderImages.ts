/**
 * Placeholder images for recipes and articles that are missing hero/gallery images.
 * These are randomly selected to add visual variety.
 */

const PLACEHOLDER_IMAGES = [
  'https://image.nostr.build/87c3e4e4c3e24c268106e7352eaa94538815fab6d4104903b9d82fbe4464e7d5.jpg',
  'https://image.nostr.build/a84c0743f50c51b8956f28350da73ba06106529219d33aead1cbb8b96ac3554f.jpg',
  'https://image.nostr.build/2e967f1520054c91b0320b73e665ad1b685dcc0626883fc0654889463d56e7ac.jpg',
  'https://image.nostr.build/0dc0f817ea420b9fc7fc7a5ce83a01f3cf52ba8e8c26edc121a1d8d496189291.jpg'
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

// URL patterns that never render real content — pages or error art served in
// place of the image (some hosts' error pages get captured into an event's
// image tag by the publishing client).
export const KNOWN_BROKEN_IMAGE_URL_PATTERNS = [
  /^https?:\/\/[^/]*\/Ooops/i,
  /placeholder\.(com|net)/i,
  /via\.placeholder/i,
  /placehold\.it/i
];

/**
 * nostr.build redirects dead uploads (deleted / purged files) to its CDN's
 * "404 image not found" artwork with HTTP 200, so an <img> load succeeds and
 * the error art renders as if it were the photo. Both redirect hops carry CORS
 * headers, so fetch() can follow them and expose response.url — letting us
 * detect the substitution.
 */
const NOSTR_BUILD_IMAGE_URL_RE = /^https?:\/\/(image|cdn)\.nostr\.build\//i;
const NOSTR_BUILD_404_ART_URL_RE = /\/\/cdn\.nostr\.build\/404\//i;

export function isNostrBuildImageUrl(url: string): boolean {
  return NOSTR_BUILD_IMAGE_URL_RE.test(url);
}

/** True when a fetched nostr.build URL landed on the CDN's 404 error art. */
export function isNostrBuildDeadUrl(finalUrl: string): boolean {
  return NOSTR_BUILD_404_ART_URL_RE.test(finalUrl);
}

/**
 * Check if an image URL is valid (non-empty and not a known-broken pattern)
 */
export function isValidImageUrl(url: string | undefined | null): boolean {
  if (!url || url.trim().length === 0) return false;
  for (const pattern of KNOWN_BROKEN_IMAGE_URL_PATTERNS) {
    if (pattern.test(url)) return false;
  }
  return true;
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
