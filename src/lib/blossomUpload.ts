import { browser } from '$app/environment';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';

const BLOSSOM_AUTH_KIND = 24242;
const SERVER_LIST_KIND = 10063;
const SERVER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const UPLOAD_TIMEOUT_MS = 30_000;

interface CacheEntry {
  servers: string[];
  expiresAt: number;
}

const serverCache = new Map<string, CacheEntry>();

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildAuthHeader(ndk: NDK, fileHash: string): Promise<string> {
  const event = new NDKEvent(ndk);
  event.kind = BLOSSOM_AUTH_KIND;
  event.content = 'Upload file';
  event.created_at = Math.floor(Date.now() / 1000);
  event.tags = [
    ['t', 'upload'],
    ['x', fileHash],
    ['expiration', String(event.created_at + 300)]
  ];

  await Promise.race([
    event.sign(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Signing timed out — approve the request in your signer.')),
        60_000
      )
    )
  ]);

  return `Nostr ${btoa(JSON.stringify(event.rawEvent()))}`;
}

/**
 * Fetch the user's Blossom server list from their kind:10063 event.
 * Results are cached per pubkey for 5 minutes to avoid redundant relay queries.
 */
export async function fetchBlossomServers(ndk: NDK, pubkey: string): Promise<string[]> {
  if (!browser) return [];

  const cached = serverCache.get(pubkey);
  if (cached && cached.expiresAt > Date.now()) return cached.servers;

  try {
    const event = await ndk.fetchEvent({
      kinds: [SERVER_LIST_KIND as any],
      authors: [pubkey]
    });
    const servers = (event?.tags ?? [])
      .filter((t) => t[0] === 'server' && t[1]?.startsWith('https://'))
      .map((t) => t[1].replace(/\/$/, ''));
    serverCache.set(pubkey, { servers, expiresAt: Date.now() + SERVER_CACHE_TTL_MS });
    return servers;
  } catch {
    return [];
  }
}

/**
 * Upload a file to the first responding Blossom server (BUD-01).
 * Tries each server in order; throws if all fail.
 */
export async function uploadWithBlossom(ndk: NDK, file: File, servers: string[]): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);

  let lastError: unknown;
  for (const server of servers) {
    try {
      const authorization = await buildAuthHeader(ndk, hash);

      const response = await Promise.race([
        fetch(`${server}/upload`, {
          method: 'PUT',
          body: file,
          headers: { Authorization: authorization, 'Content-Type': file.type }
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Upload timed out')), UPLOAD_TIMEOUT_MS)
        )
      ]);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = await response.json();
      if (data?.url) return data.url;
      throw new Error('No URL in Blossom response');
    } catch (e) {
      console.warn(`[Blossom] Upload to ${server} failed:`, e);
      lastError = e;
    }
  }

  throw lastError ?? new Error('All Blossom servers failed');
}
