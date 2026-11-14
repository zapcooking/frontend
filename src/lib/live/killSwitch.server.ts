/**
 * Go live — the global off flag.
 *
 * One key in the general-purpose GATED_CONTENT KV namespace. While it is
 * set, create, publish and join all refuse. It is flipped by an admin
 * through /api/admin/live, with no deploy.
 *
 * KV is eventually consistent: a change can take up to about a minute to
 * be seen everywhere. Turning Go live off therefore also ends every open
 * session in the database and deletes its input (see the admin route);
 * that part takes effect at once.
 *
 * If the namespace is not bound, or a read fails, the flag reads as "not
 * off": a KV outage must not take the whole feature down. The failure is
 * logged, and the admin route reports whether it could write the flag.
 */
import { LIVE_OFF_KEY } from './config';

type FlagStore = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

const store = (platform: Readonly<App.Platform> | undefined): FlagStore | undefined =>
  platform?.env?.GATED_CONTENT as FlagStore | undefined;

/** True while Go live is switched off for everyone. Never throws. */
export async function isLiveOff(platform: Readonly<App.Platform> | undefined): Promise<boolean> {
  const kv = store(platform);
  if (!kv) return false;
  try {
    return (await kv.get(LIVE_OFF_KEY)) === '1';
  } catch (err) {
    console.error(`[Live] off flag unreadable: ${(err as Error)?.name ?? 'error'}`);
    return false;
  }
}

/** Set or clear the flag. Returns false when it could not be written. */
export async function setLiveOff(
  platform: Readonly<App.Platform> | undefined,
  off: boolean
): Promise<boolean> {
  const kv = store(platform);
  if (!kv) return false;
  try {
    if (off) await kv.put(LIVE_OFF_KEY, '1');
    else await kv.delete(LIVE_OFF_KEY);
    return true;
  } catch (err) {
    console.error(`[Live] off flag not written: ${(err as Error)?.name ?? 'error'}`);
    return false;
  }
}
