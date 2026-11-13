/**
 * Unit tests for GET /api/nip05/check-availability — reserved names only.
 * Reserved names are refused before any Pantry lookup, so fetch is stubbed
 * to fail the test if it is reached.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from '../../../../test/envMock';
import { GET } from './+server';

const fetchMock = vi.fn();

async function check(username: string) {
  const url = new URL('https://zap.cooking/api/nip05/check-availability');
  url.searchParams.set('username', username);
  const res = await GET({ url, platform: { env: {} } } as any);
  return { res, data: await res.json() };
}

beforeEach(() => {
  env.MEMBERSHIP_ENABLED = 'true';
  env.RELAY_API_SECRET = 'test-secret';
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('GET /api/nip05/check-availability', () => {
  for (const name of ['live', 'watch', 'Live', 'admin']) {
    it(`reports the reserved name ${name} as unavailable`, async () => {
      const { res, data } = await check(name);
      expect(res.status).toBe(200);
      expect(data).toEqual({
        available: false,
        username: name.toLowerCase(),
        error: 'This username is reserved'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});
