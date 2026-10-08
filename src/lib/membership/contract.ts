/**
 * Shared constants of the GET /api/membership response contract
 * (docs/pantry-contract.md). Used by the endpoint, the client store and tests.
 */

/** Response header listing pubkeys the server could not resolve (comma-separated hex). */
export const UNRESOLVED_HEADER = 'X-Membership-Unresolved';
/** Parallel pantry lookups per request. */
export const LOOKUP_CONCURRENCY = 25;
/** After this, pubkeys not yet started are reported unresolved rather than looked up. */
export const REQUEST_BUDGET_MS = 8000;
