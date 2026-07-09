/**
 * createInvoice expiryInSeconds guard: only valid positive numbers
 * reach Strike's receive-request body (0/NaN/negative/omitted → field
 * absent, Strike's 24h default applies).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env } from '$env/dynamic/private';
import { createInvoice } from './strikeService.server';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  env.STRIKE_API_KEY = 'test-key';
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ receiveRequestId: 'rr', bolt11: { invoice: 'lnbc...' } })
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete env.STRIKE_API_KEY;
});

async function bolt11BodyFor(expiry?: number) {
  await createInvoice('0.00000021', 'BTC', 'test', undefined, expiry);
  return JSON.parse(fetchMock.mock.calls.at(-1)[1].body).bolt11;
}

describe('createInvoice expiryInSeconds', () => {
  it('includes a valid positive expiry', async () => {
    expect((await bolt11BodyFor(600)).expiryInSeconds).toBe(600);
  });

  it('omits the field when not provided (Strike default applies)', async () => {
    expect('expiryInSeconds' in (await bolt11BodyFor())).toBe(false);
  });

  it('omits 0, NaN, and negatives', async () => {
    for (const bad of [0, NaN, -60]) {
      expect('expiryInSeconds' in (await bolt11BodyFor(bad)), String(bad)).toBe(false);
    }
  });
});
