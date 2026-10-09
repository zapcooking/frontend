/**
 * Test stand-in for SvelteKit's `$env/dynamic/public` virtual module, the
 * public-side twin of envMock.ts: a single mutable object client modules
 * read PUBLIC_* flags from under test. Tests should reset what they touch.
 */
export const env: Record<string, string | undefined> = {};
