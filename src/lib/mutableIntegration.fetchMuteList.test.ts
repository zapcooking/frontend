import { describe, it, expect, vi, beforeEach } from 'vitest';
/**
 * The NIP-51 mute list is fetched after NDK has a connected relay, through
 * the explicit pool relay set with a timeout. On a cold signed-in load it
 * used to go out before any relay was connected: outbox routing found no
 * relay for the author filter ("No relays found for filter"), the request
 * never resolved, and the feed ran without the reader's mutes.
 */
const calls: string[] = [];
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable({ fake: true }),
    userPublickey: writable('me'),
    ensureNdkConnected: vi.fn(async () => {
      calls.push('connect');
    })
  };
});
vi.mock('$lib/muteToggle', () => ({
  fetchMuteListStrict: vi.fn(async () => {
    calls.push('fetch');
    return { status: 'found', event: { id: 'mutes', kind: 10000 } };
  })
}));
vi.mock('$lib/encryptionService', () => ({ encrypt: vi.fn(), decrypt: vi.fn(), detectEncryptionMethod: vi.fn() }));
vi.mock('$lib/outboxPublish', () => ({ outboxRelaySet: vi.fn() }));
import { fetchMuteList } from './mutableIntegration';
import { fetchMuteListStrict } from '$lib/muteToggle';

beforeEach(() => {
  calls.length = 0;
  vi.mocked(fetchMuteListStrict).mockClear();
});

describe('fetchMuteList', () => {
  it('waits for a connected relay, then asks the pool relays explicitly', async () => {
    const e = await fetchMuteList('a'.repeat(64));
    expect(calls).toEqual(['connect', 'fetch']);
    expect(e).toMatchObject({ id: 'mutes' });
  });

  it('absent or unavailable is null (no event), never a hang', async () => {
    vi.mocked(fetchMuteListStrict).mockResolvedValueOnce({ status: 'absent' });
    expect(await fetchMuteList('a'.repeat(64))).toBeNull();
    vi.mocked(fetchMuteListStrict).mockResolvedValueOnce({ status: 'unavailable' });
    expect(await fetchMuteList('a'.repeat(64))).toBeNull();
  });
});
