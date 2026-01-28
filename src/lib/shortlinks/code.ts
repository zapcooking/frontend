/**
 * Collision-resistant short code generation for URL shortener.
 * Uses base62 (0-9, a-z, A-Z) for compact, URL-safe codes.
 */

const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DEFAULT_LENGTH = 6;

/**
 * Generate a random base62 string of given length.
 * 6 chars ≈ 56 billion combos; 7 chars ≈ 3.5 trillion.
 */
export function generateShortCode(length: number = DEFAULT_LENGTH): string {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE62[bytes[i] % 62];
  }
  return result;
}

/**
 * Validate short code: alphanumeric, length 4–12.
 */
export function isValidShortCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;
  const cleaned = code.trim().toLowerCase();
  return /^[0-9a-z]{4,12}$/.test(cleaned);
}

/**
 * Normalize short code for storage/lookup (lowercase, trim).
 */
export function normalizeShortCode(code: string): string {
  return code.trim().toLowerCase();
}
