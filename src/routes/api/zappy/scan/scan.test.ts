/**
 * Unit tests for POST /api/zappy/scan.
 *
 * Collaborators (NIP-98 verifier, membership API, rate limiter, OpenAI
 * fetch) are mocked at the module boundary; the endpoint's own
 * validation, gating, and response-shaping logic runs for real. Mirrors
 * the harness in ../ask-photo/askPhoto.test.ts.
 *
 * The point of the rate-limit cases is the *ordering*: the cap has to
 * sit below the membership gate (a 403 must not spend a member's quota)
 * and above the OpenAI call (a 429 must not cost anything).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SCAN_RATE_LIMIT_LINE } from '$lib/cheffy';
import { POST } from './+server';

const mocks = vi.hoisted(() => ({
  verifyNip98: vi.fn(),
  hasActiveMembership: vi.fn(),
  checkPerIpRateLimit: vi.fn()
}));

vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verifyNip98 }));
vi.mock('$lib/membershipApi.server', () => ({ hasActiveMembership: mocks.hasActiveMembership }));
vi.mock('$lib/ipRateLimit.server', () => ({ checkPerIpRateLimit: mocks.checkPerIpRateLimit }));

const PUBKEY = 'a'.repeat(64);
const CLIENT_IP = '203.0.113.7';
const ENDPOINT = 'https://zap.cooking/api/zappy/scan';
/** Minimal base64 whose prefix makes the endpoint detect a JPEG. */
const IMAGE = '/9j/' + 'A'.repeat(64);

const fetchMock = vi.fn();

function openaiOk(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

type EventOpts = {
  env?: Record<string, unknown> | null;
  /** Throw from getClientAddress, as SvelteKit does without CF headers. */
  noClientAddress?: boolean;
  rawBody?: string;
};

function makeEvent(body: unknown, opts: EventOpts = {}) {
  const request = new Request(new URL(ENDPOINT), {
    method: 'POST',
    body: opts.rawBody ?? JSON.stringify(body)
  });
  const env =
    opts.env === null
      ? {}
      : (opts.env ?? {
          OPENAI_API_KEY: 'test-key',
          MEMBERSHIP_ENABLED: 'true',
          RELAY_API_SECRET: 'secret',
          NOURISH_FLAGS: { kv: true }
        });
  return {
    request,
    platform: { env },
    getClientAddress: () => {
      if (opts.noClientAddress) throw new Error('no client address');
      return CLIENT_IP;
    }
  } as any;
}

async function call(body: unknown, opts: EventOpts = {}) {
  const res = await POST(makeEvent(body, opts));
  return { res, data: await res.json() };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { image: IMAGE, ...overrides };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  mocks.verifyNip98.mockReset().mockResolvedValue({ ok: true, pubkey: PUBKEY });
  mocks.hasActiveMembership.mockReset().mockResolvedValue(true);
  mocks.checkPerIpRateLimit.mockReset().mockResolvedValue({ limited: false, ipHash: 'h' });
  fetchMock.mockReset().mockResolvedValue(openaiOk('["eggs", "milk"]'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('under the rate limit', () => {
  it('200s and returns ingredients, unchanged', async () => {
    const { res, data } = await call(validBody());
    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true, ingredients: ['eggs', 'milk'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('NIP-98 authentication', () => {
  it('401s when the header is missing or bad, and spends nothing', async () => {
    for (const reason of ['missing-header', 'invalid-signature', 'payload-mismatch']) {
      mocks.checkPerIpRateLimit.mockClear();
      mocks.hasActiveMembership.mockClear();
      fetchMock.mockClear();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mocks.verifyNip98.mockResolvedValue({ ok: false, reason });

      const { res, data } = await call(validBody());

      expect(res.status).toBe(401);
      expect(data.ok).toBe(false);
      // The 401 sits ABOVE the membership call, the limiter and OpenAI —
      // an unauthenticated caller costs us nothing and burns nobody's
      // allowance.
      expect(mocks.hasActiveMembership).not.toHaveBeenCalled();
      expect(mocks.checkPerIpRateLimit).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      // Reason is logged, never returned — uniform 401, no info leak.
      expect(String(data.error)).not.toContain(reason);
      expect(String(warn.mock.calls[0][0])).toContain(reason);
      warn.mockRestore();
    }
  });

  it('binds the header to this exact body', async () => {
    await call(validBody());
    const [, opts] = mocks.verifyNip98.mock.calls[0];
    // Without the body bytes the verifier cannot check the payload tag,
    // so a header signed for one photo would replay against another.
    expect(opts.bodyBytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(opts.bodyBytes)).toBe(JSON.stringify(validBody()));
  });

  it('gates membership on the verified pubkey, not on anything in the body', async () => {
    await call(validBody({ pubkey: 'b'.repeat(64) }));
    expect(mocks.hasActiveMembership).toHaveBeenCalledTimes(1);
    expect(mocks.hasActiveMembership.mock.calls[0][0]).toBe(PUBKEY);
  });

  it('400s on a body that is not JSON, before authenticating', async () => {
    const { res } = await call(null, { rawBody: 'not json' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('rate limiting', () => {
  it('keys the bucket on the client address, not the verified pubkey', async () => {
    await call(validBody());
    expect(mocks.checkPerIpRateLimit).toHaveBeenCalledTimes(1);
    const [kv, params] = mocks.checkPerIpRateLimit.mock.calls[0];
    expect(kv).toEqual({ kv: true });
    expect(params.ip).toBe(CLIENT_IP);
    expect(params.ip).not.toBe(PUBKEY);
    expect(params.scope).toBe('zappy-scan');
    expect(params.perHour).toBe(8);
    expect(params.perDay).toBe(30);
  });

  it('does not let a different pubkey reset the bucket', async () => {
    // Verified now, but still free to mint — this endpoint fails OPEN on
    // membership problems and has no gate at all when MEMBERSHIP_ENABLED
    // is off, so the IP bucket is the only surviving cost ceiling.
    mocks.verifyNip98.mockResolvedValueOnce({ ok: true, pubkey: 'b'.repeat(64) });
    await call(validBody());
    mocks.verifyNip98.mockResolvedValueOnce({ ok: true, pubkey: 'c'.repeat(64) });
    await call(validBody());
    const ips = mocks.checkPerIpRateLimit.mock.calls.map((c: any[]) => c[1].ip);
    expect(ips).toEqual([CLIENT_IP, CLIENT_IP]);
  });

  it('falls back to a loopback IP when getClientAddress throws', async () => {
    const { res } = await call(validBody(), { noClientAddress: true });
    expect(res.status).toBe(200);
    expect(mocks.checkPerIpRateLimit.mock.calls[0][1].ip).toBe('127.0.0.1');
  });

  it('429s over the limit WITHOUT calling OpenAI', async () => {
    mocks.checkPerIpRateLimit.mockResolvedValue({
      limited: true,
      ipHash: 'h',
      body: { error: 'rate_limited', retryAfter: 3600, scope: 'per-hour' }
    });
    const { res, data } = await call(validBody());
    expect(res.status).toBe(429);
    expect(data.ok).toBe(false);
    expect(data.code).toBe('RATE_LIMITED');
    expect(data.retryAfter).toBe(3600);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a human error line, never the raw rate_limited token', async () => {
    // Both callers render `data.error` straight into the scan error UI.
    mocks.checkPerIpRateLimit.mockResolvedValue({
      limited: true,
      ipHash: 'h',
      body: { error: 'rate_limited', retryAfter: 3600, scope: 'per-hour' }
    });
    const { data } = await call(validBody());
    expect(data.error).toBe(SCAN_RATE_LIMIT_LINE);
    expect(data.error).not.toMatch(/rate_limited/);
  });

  it('warns loudly when no KV is bound instead of silently unmetering', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await call(validBody(), {
      env: { OPENAI_API_KEY: 'test-key', MEMBERSHIP_ENABLED: 'false' }
    });
    expect(mocks.checkPerIpRateLimit.mock.calls[0][0]).toBeUndefined();
    // Asserted on the call args rather than expect.stringContaining —
    // the asymmetric matchers do not typecheck under svelte-check in
    // this repo (same limitation as it.each; see noteReview.test.ts).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('NOURISH_FLAGS');
  });
});

describe('membership gate is not regressed', () => {
  it('403s for a non-member and spends no quota', async () => {
    mocks.hasActiveMembership.mockResolvedValue(false);
    const { res } = await call(validBody());
    expect(res.status).toBe(403);
    expect(mocks.checkPerIpRateLimit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still fails OPEN when the membership service throws', async () => {
    // Unchanged by adding NIP-98, and deliberately unlike note-review /
    // ask-photo. Tracked in issue #512; pinned here so the divergence is
    // a decision rather than a drift.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.hasActiveMembership.mockRejectedValue(new Error('membership service down'));
    const { res } = await call(validBody());
    expect(res.status).toBe(200);
    error.mockRestore();
  });

  it('still rate limits when membership gating is off', async () => {
    const { res } = await call(validBody(), {
      env: {
        OPENAI_API_KEY: 'test-key',
        MEMBERSHIP_ENABLED: 'false',
        NOURISH_FLAGS: { kv: true }
      }
    });
    expect(res.status).toBe(200);
    expect(mocks.checkPerIpRateLimit).toHaveBeenCalledTimes(1);
  });
});

describe('validation still precedes the limiter', () => {
  it('400s on a missing image without spending quota', async () => {
    const { res } = await call(validBody({ image: undefined }));
    expect(res.status).toBe(400);
    expect(mocks.checkPerIpRateLimit).not.toHaveBeenCalled();
  });

  it('500s without an OpenAI key without spending quota', async () => {
    const { res } = await call(validBody(), { env: null });
    expect(res.status).toBe(500);
    expect(mocks.checkPerIpRateLimit).not.toHaveBeenCalled();
  });
});
