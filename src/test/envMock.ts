/**
 * Test stand-in for SvelteKit's `$env/dynamic/private` virtual module.
 *
 * The standalone vitest config (which does not load the SvelteKit Vite
 * plugin) aliases `$env/dynamic/private` to this file, so server modules
 * that read env flags resolve cleanly under test. It's a single mutable
 * object — tests set/delete keys on it to exercise env-driven behaviour
 * (e.g. promo kill-switches) and should reset what they touch.
 */
export const env: Record<string, string | undefined> = {};
