/**
 * Shared error-code vocabulary for the recipe-extraction endpoints
 * (/api/extract-recipe and /api/extract-recipe/public).
 *
 * The server returns { success: false, error, code } where `code` is one
 * of these stable identifiers and `error` is short, audience-neutral,
 * leak-safe copy. For URL-fetch failures `error` is exactly the
 * EXTRACT_ERROR_FALLBACK entry below; some request-validation paths
 * return a more specific message (e.g. "URL is required for URL
 * extraction" under INVALID_REQUEST), so treat the map as the canonical
 * fallback, not a guarantee that error === EXTRACT_ERROR_FALLBACK[code].
 * Copy ownership lives in each client: the landing hero
 * (anon audience) and Sous Chef (signed-in audience) map the same code to
 * different recovery text, and native apps (Android/iOS) that predate the
 * field keep rendering `error` untouched — `code` is strictly additive.
 *
 * HTTP statuses are part of the mobile contract (Android branches on the
 * numeric status and only body-parses in its 400 branch) and MUST NOT
 * change when codes are added or remapped. A status re-taxonomy is a
 * separate, mobile-coordinated change.
 *
 * This module is imported by both server and client code — keep it free
 * of server-only dependencies.
 */

export type ExtractErrorCode =
  | 'INVALID_REQUEST' // malformed body / missing or invalid fields
  | 'INVALID_URL' // unparseable or over-long URL
  | 'UNSUPPORTED_URL' // non-http(s) scheme, private/internal address
  | 'TEXT_TOO_LONG' // pasted text over the input cap
  | 'SOURCE_BLOCKED' // target site refused automated access (401/403/406/451)
  | 'SOURCE_NOT_FOUND' // target page missing (404/410)
  | 'SOURCE_UNAVAILABLE' // target unreachable: 5xx, network/DNS, broken redirect, upstream 429
  | 'SOURCE_TOO_LARGE' // response over the fetch size cap
  | 'TOO_MANY_REDIRECTS' // redirect chain exceeded the hop limit
  | 'AI_UNAVAILABLE' // extraction model failed or returned unusable output
  | 'INTERNAL'; // unexpected server error

/**
 * Audience-neutral fallback copy, the typical value of `error`. Written
 * for clients that render it verbatim (native apps, unknown callers);
 * web clients override per-code with their own audience-specific copy.
 */
export const EXTRACT_ERROR_FALLBACK: Record<ExtractErrorCode, string> = {
  INVALID_REQUEST: 'That request could not be processed. Refresh and try again.',
  INVALID_URL: 'That does not look like a valid web address.',
  UNSUPPORTED_URL: 'That address cannot be imported. Only public websites are supported.',
  TEXT_TOO_LONG: 'That text is too long to import (max 10,000 characters).',
  SOURCE_BLOCKED: 'That site does not allow automatic imports.',
  SOURCE_NOT_FOUND: 'No page was found at that link.',
  SOURCE_UNAVAILABLE: 'That site could not be reached. Try again in a few minutes.',
  SOURCE_TOO_LARGE: 'That page is too large to import.',
  TOO_MANY_REDIRECTS: 'That link redirected too many times.',
  AI_UNAVAILABLE: 'Recipe extraction is temporarily unavailable. Try again shortly.',
  INTERNAL: 'Something went wrong. Please try again.'
};
