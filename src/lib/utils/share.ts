import { browser } from '$app/environment';

// Production site URL
const SITE_URL = 'https://zap.cooking';

/**
 * Tracking parameters to strip from URLs
 */
const TRACKING_PARAMS = [
  'fbclid',
  'gclid',
  'msclkid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'source'
];

/**
 * Get the site origin for building URLs
 * In dev, returns localhost for display purposes
 * In production, returns the production URL
 */
export function getSiteOrigin(): string {
  if (browser && window?.location?.origin) {
    // In production, use the production URL; in dev, use localhost
    if (!window.location.origin.includes('localhost')) {
      return SITE_URL;
    }
    return window.location.origin;
  }
  // SSR fallback
  return SITE_URL;
}

/**
 * Get the production site origin (always returns production URL)
 * Use this for social sharing - social platforms reject localhost URLs
 */
export function getProductionOrigin(): string {
  return SITE_URL;
}

/**
 * Strip tracking parameters from a URL
 */
export function stripTrackingParams(url: string): string {
  try {
    const urlObj = new URL(url);
    TRACKING_PARAMS.forEach(param => {
      urlObj.searchParams.delete(param);
    });
    // Remove empty search string
    if (urlObj.search === '') {
      return urlObj.origin + urlObj.pathname + urlObj.hash;
    }
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * Build a canonical recipe share URL for display
 * Uses the short /r/ route format
 * In dev, shows localhost; in production, shows production URL
 */
export function buildCanonicalRecipeShareUrl(naddr: string): string {
  const origin = getSiteOrigin();
  // Use short /r/ route for cleaner URLs
  return `${origin}/r/${naddr}`;
}

/**
 * Build a production recipe share URL (always uses production domain)
 * Use this for social sharing - social platforms reject localhost URLs
 */
export function buildProductionRecipeShareUrl(naddr: string): string {
  const origin = getProductionOrigin();
  return `${origin}/r/${naddr}`;
}

/**
 * Build the full recipe URL (backwards compatible)
 */
export function buildFullRecipeUrl(naddr: string): string {
  const origin = getSiteOrigin();
  return `${origin}/recipe/${naddr}`;
}

/**
 * Build rich text for clipboard (title + source + URL)
 * Always uses production URL for sharing
 */
export function buildRichShareText(title: string, url: string): string {
  const prodUrl = url.includes('localhost') 
    ? url.replace(/https?:\/\/localhost:\d+/, SITE_URL)
    : url;
  return `${title}\nShared on Zap Cooking\n${prodUrl}`;
}

/**
 * Convert a URL to always use production domain for social sharing
 * Social platforms reject localhost URLs
 */
function ensureProductionUrl(url: string): string {
  if (!url) return url;
  // If it's a localhost URL, replace with production
  if (url.includes('localhost')) {
    return url.replace(/https?:\/\/localhost:\d+/, SITE_URL);
  }
  return url;
}

/**
 * Social share URL builders
 * Always use production URLs for social sharing (localhost won't work)
 */
export const socialShareUrls = {
  x: (url: string, title?: string): string => {
    const prodUrl = ensureProductionUrl(url);
    const params = new URLSearchParams({
      url: prodUrl,
      ...(title && { text: title })
    });
    return `https://twitter.com/intent/tweet?${params.toString()}`;
  },

  facebook: (url: string): string => {
    const prodUrl = ensureProductionUrl(url);
    const params = new URLSearchParams({ u: prodUrl });
    return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
  },

  linkedin: (url: string): string => {
    const prodUrl = ensureProductionUrl(url);
    const params = new URLSearchParams({ url: prodUrl });
    return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`;
  },

  reddit: (url: string, title?: string): string => {
    const prodUrl = ensureProductionUrl(url);
    const params = new URLSearchParams({
      url: prodUrl,
      ...(title && { title })
    });
    return `https://reddit.com/submit?${params.toString()}`;
  },

  pinterest: (url: string, description?: string, imageUrl?: string): string => {
    const prodUrl = ensureProductionUrl(url);
    const params = new URLSearchParams({
      url: prodUrl,
      ...(description && { description }),
      ...(imageUrl && { media: imageUrl })
    });
    return `https://pinterest.com/pin/create/button/?${params.toString()}`;
  },

  tiktok: (): string => {
    // TikTok doesn't support direct URL sharing, open upload page
    return 'https://www.tiktok.com/upload';
  },

  bluesky: (url: string, title?: string): string => {
    const prodUrl = ensureProductionUrl(url);
    const text = title ? `${title}: ${prodUrl}` : prodUrl;
    const params = new URLSearchParams({ text });
    return `https://bsky.app/intent/compose?${params.toString()}`;
  },

  sms: (url: string, title?: string): string => {
    const prodUrl = ensureProductionUrl(url);
    const body = title ? `Check out this recipe: ${title} - ${prodUrl}` : `Check out this recipe: ${prodUrl}`;
    const params = new URLSearchParams({ body });
    return `sms:?${params.toString()}`;
  },

  whatsapp: (url: string, title?: string): string => {
    const prodUrl = ensureProductionUrl(url);
    const text = title ? `${title}\n\nFound on zap.cooking ⚡\n${prodUrl}` : `Found on zap.cooking ⚡\n${prodUrl}`;
    const params = new URLSearchParams({ text });
    return `https://api.whatsapp.com/send?${params.toString()}`;
  },

  telegram: (url: string, title?: string): string => {
    const prodUrl = ensureProductionUrl(url);
    const text = title ? `${title} - Found on zap.cooking ⚡` : 'Found on zap.cooking ⚡';
    const params = new URLSearchParams({ url: prodUrl, text });
    return `https://t.me/share/url?${params.toString()}`;
  },

  instagram: (): string => {
    // Instagram doesn't support web sharing - open the app/website
    return 'https://instagram.com';
  }
};

/**
 * Check if native share is available
 */
export function canUseNativeShare(): boolean {
  return browser && typeof navigator !== 'undefined' && !!navigator.share;
}

/**
 * Use native share API
 * Always uses production URL for sharing
 */
export async function nativeShare(options: {
  title: string;
  text?: string;
  url: string;
}): Promise<boolean> {
  if (!canUseNativeShare()) {
    return false;
  }
  
  // Always use production URL for sharing
  const prodUrl = options.url.includes('localhost')
    ? options.url.replace(/https?:\/\/localhost:\d+/, SITE_URL)
    : options.url;
  
  try {
    await navigator.share({
      title: options.title,
      text: options.text || 'Shared on Zap Cooking',
      url: prodUrl
    });
    return true;
  } catch (err) {
    // User cancelled or share failed
    console.log('Native share cancelled or failed:', err);
    return false;
  }
}

/**
 * Copy text to clipboard with fallback
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!browser) return false;
  
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    } catch {
      return false;
    }
  }
}

