/**
 * Read a server variable or secret for the Go live routes.
 *
 * Values are trimmed: a secret pasted into the Cloudflare dashboard can
 * carry a trailing newline or spaces, and an untrimmed bearer or key then
 * fails in ways that look like a wrong value. An empty or whitespace-only
 * value reads as "not configured".
 */
import { env } from '$env/dynamic/private';
import { liveKvKey } from './config';

export function readLiveEnv(
  platform: Readonly<App.Platform> | undefined,
  name: string
): string | undefined {
  const raw =
    (platform?.env as Record<string, unknown> | undefined)?.[name] ??
    (env as Record<string, string | undefined>)[name];
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

/** The KV key of a Go live value in this deployment's environment (see liveKvKey). */
export function liveKv(platform: Readonly<App.Platform> | undefined, name: string): string {
  return liveKvKey(readLiveEnv(platform, 'LIVE_INPUT_PREFIX'), name);
}
