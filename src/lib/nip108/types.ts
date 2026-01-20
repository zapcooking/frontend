/**
 * NIP-108 Type Definitions
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';

/**
 * Gated Note (kind 55) - Contains encrypted recipe content
 */
export interface GatedNoteEvent extends NDKEvent {
  kind: 55;
  content: string; // JSON stringified encrypted recipe event
  tags: Array<[string, string, ...string[]]>;
}

/**
 * Key Note (kind 56) - Contains NIP-04 encrypted secret for a specific user
 */
export interface KeyNoteEvent extends NDKEvent {
  kind: 56;
  content: string; // NIP-04 encrypted secret
  tags: Array<[string, string, ...string[]]>;
}

/**
 * Announcement Note (kind 54) - Preview/announcement of gated content
 */
export interface AnnouncementNoteEvent extends NDKEvent {
  kind: 54;
  content: string; // Preview text
  tags: Array<[string, string, ...string[]]>;
}

/**
 * Gated recipe metadata
 */
export interface GatedRecipeMetadata {
  gatedNoteId: string; // Event ID of kind:55 or server-side gated ID
  announcementNoteId: string; // Event ID of kind:54 or same as gatedNoteId
  cost: number; // Cost in sats (whole satoshis)
  endpoint: string; // Payment endpoint URL
  iv: string; // Initialization vector (hex)
  preview?: string; // Preview text from announcement
  authorPubkey?: string; // Author's public key for ownership check
}

/**
 * Payment request response (402 Payment Required)
 */
export interface PaymentRequest {
  pr: string; // Lightning invoice (bolt11)
  routes: unknown[]; // Lightning routes (empty for now)
  paid?: boolean; // If true, user already has access
  successAction?: {
    tag: string; // Usually "url"
    url: string; // URL to fetch secret after payment
    description?: string;
  };
}

/**
 * Secret response (after payment)
 */
export interface SecretResponse {
  secret: string; // Hex-encoded secret key
}
