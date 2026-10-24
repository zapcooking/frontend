/**
 * Rate limiting and record TTL on POST /api/shorten.
 *
 * This is an unauthenticated KV write: without a cap anyone can mint
 * short links in a loop, and without a TTL every record lives forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkPerIpRateLimit: vi.fn()
}));

vi.mock('$lib/ipRateLimit.server', () => ({ checkPerIpRateLimit: mocks.checkPerIpRateLimit }));

import { POST } from './+server';

const NADDR =
  'naddr1qvzqqqr4gupzpz36jgmdp6hxhjfwk9mc94t7s29qrupu62xnc6pf03lpn5m5h9qeqy88wumn8ghj7mn0wvhxcmmv9uqpxcn9v9ez6mtpwf4k2apdwdk82er8v5ksd0uvd6';

function makeEvent(body: unknown, kvOverrides: Record<string, any> = {}) {
  const store = new Map<string, string>();
  const puts: { key: string; value: string; opts: any }[] = [];
  const kv = {
    get: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    put: async (k: string, v: string, opts?: any) => {
      puts.push({ key: k, value: v, opts });
      store.set(k, v);
    },
    ...kvOverrides
  };
  return {
    event: {
      request: new Request('https://zap.cooking/api/shorten', {
        method: 'POST',
        body: JSON.stringify(body)
      }),
      platform: { env: { SHORTLINKS: kv, NOURISH_FLAGS: { kv: true } } },
      getClientAddress: () => '203.0.113.7'
    } as any,
    puts
  };
}

beforeEach(() => {
  mocks.checkPerIpRateLimit.mockReset().mockResolvedValue({ limited: false, ipHash: 'h' });
});

describe('rate limiting', () => {
  it('applies a per-IP cap using the caller address', async () => {
    const { event } = makeEvent({ url: NADDR });

    await POST(event);

    const [, params] = mocks.checkPerIpRateLimit.mock.calls[0];
    expect(params).toMatchObject({ ip: '203.0.113.7', scope: 'shorten', perHour: 10, perDay: 50 });
  });

  it('returns 429 and writes nothing when limited', async () => {
    mocks.checkPerIpRateLimit.mockResolvedValue({
      limited: true,
      ipHash: 'h',
      body: { error: 'rate_limited', retryAfter: 3600, scope: 'per-hour' }
    });
    const { event, puts } = makeEvent({ url: NADDR });

    const res = await POST(event);

    expect(res.status).toBe(429);
    expect(puts).toHaveLength(0);
  });

  it('still succeeds when no rate-limit KV is bound (helper fails open)', async () => {
    mocks.checkPerIpRateLimit.mockResolvedValue({ limited: false, ipHash: 'no-kv' });
    const { event } = makeEvent({ url: NADDR });

    const res = await POST(event);

    expect(res.status).toBe(200);
  });
});

describe('record TTL', () => {
  it('writes new records with a one-year expirationTtl', async () => {
    const { event, puts } = makeEvent({ url: NADDR });

    const res = await POST(event);
    expect(res.status).toBe(200);

    expect(puts).toHaveLength(1);
    expect(puts[0].opts?.expirationTtl).toBe(365 * 24 * 60 * 60);
  });
});
