import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type NDK from '@nostr-dev-kit/ndk';

vi.mock('./nip98', () => ({ signNip98AuthHeader: vi.fn() }));
import { signNip98AuthHeader } from './nip98';
import { loadCheffyTrial } from './cheffyTrialClient';

const fetchMock = vi.fn();
const ndk = {} as NDK;
beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'https://zap.cooking' } });
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(signNip98AuthHeader).mockReset().mockResolvedValue('Nostr signed');
  fetchMock
    .mockReset()
    .mockResolvedValue({ ok: true, json: async () => ({ remaining: 2, limit: 3 }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('account trial status', () => {
  it('signs the exact status request and prevents cached account allowances', async () => {
    expect(await loadCheffyTrial(ndk)).toBe(2);
    expect(signNip98AuthHeader).toHaveBeenCalledWith(ndk, {
      method: 'POST',
      url: 'https://zap.cooking/api/zappy/trial-status',
      bodyString: '{}'
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/zappy/trial-status', {
      method: 'POST',
      cache: 'no-store',
      body: '{}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Nostr signed' }
    });
  });

  for (const remaining of [-1, 4, 1.5, '3', undefined]) {
    it(`rejects an invalid remaining allowance: ${remaining}`, async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ remaining }) });
      await expect(loadCheffyTrial(ndk)).rejects.toThrow('could not be checked');
    });
  }

  it('does not infer allowance from a service failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'unavailable' }) });
    await expect(loadCheffyTrial(ndk)).rejects.toThrow('could not be checked');
  });

  it('never sends an unsigned fallback when signing is rejected', async () => {
    vi.mocked(signNip98AuthHeader).mockRejectedValue(new Error('Signing declined'));
    await expect(loadCheffyTrial(ndk)).rejects.toThrow('Signing declined');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
