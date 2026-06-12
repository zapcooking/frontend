/**
 * Pure event-id validation with ZERO imports.
 *
 * This module must stay dependency-free: it is imported by server API
 * endpoints (e.g. /api/counts/*) whose worker bundles must not pull in
 * the NDK module graph. $lib/nostr constructs NDK at module scope, which
 * crashes during module init in the Cloudflare worker runtime
 * ("debug.extend is not a function") and 500s every request to any
 * endpoint that transitively imports it.
 */

/**
 * Validate that eventId is exactly 64 hex characters (Nostr event ID format)
 */
const EVENT_ID_PATTERN = /^[a-f0-9]{64}$/i;

export function isValidEventId(id: unknown): id is string {
  return typeof id === 'string' && EVENT_ID_PATTERN.test(id);
}
