/**
 * URL shortener for zap.cooking recipe and Nostr long-form article links.
 * Use /api/shorten to create, /s/:code to redirect, /api/stats/:code for analytics.
 */

export * from './types';
export { generateShortCode, isValidShortCode, normalizeShortCode } from './code';
