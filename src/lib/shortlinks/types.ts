/**
 * URL shortener types for zap.cooking recipe and Nostr long-form article links.
 * Short links use format: zap.cooking/s/:code
 */

export type ShortLinkType = 'recipe' | 'article';

export interface ShortenedURL {
  shortCode: string;
  naddr: string;
  createdAt: number;
  createdBy?: string;
  clicks?: number;
  type: ShortLinkType;
  /** Optional custom slug for vanity URLs */
  customSlug?: string;
}

export interface CreateShortLinkBody {
  /** Full naddr string (naddr1...) or full zap.cooking URL */
  url: string;
  type: ShortLinkType;
  /** Optional custom slug; must be safe and unique */
  customSlug?: string;
}

export interface CreateShortLinkResponse {
  success: boolean;
  shortCode?: string;
  shortUrl?: string;
  error?: string;
}

export interface ShortLinkStatsResponse {
  shortCode: string;
  naddr: string;
  type: ShortLinkType;
  createdAt: number;
  clicks: number;
  createdBy?: string;
}
