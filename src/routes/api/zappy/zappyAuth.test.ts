/**
 * Auth posture on POST /api/zappy (Cheffy chat).
 *
 * The membership gate used to key off a body `pubkey`, so anyone could
 * name a known member and spend our OpenAI budget on their membership.
 * Identity now comes from NIP-98 for members and the account-bound free sample.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyNip98: vi.fn(),
  checkMembership: vi.fn()
}));

vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verifyNip98 }));
vi.mock('$lib/membershipApi.server', () => ({ checkMembership: mocks.checkMembership }));

import { POST } from './+server';

const MEMBER = 'a'.repeat(64);
const ENDPOINT = 'https://zap.cooking/api/zappy';
const fetchMock = vi.fn();

function makeEvent(
  body: unknown,
  opts: { signed?: boolean; cookies?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.signed) headers.Authorization = 'Nostr fake';
  const jar = { ...(opts.cookies ?? {}) };
  return {
    request: new Request(new URL(ENDPOINT), {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    cookies: { get: (n: string) => jar[n], set: () => {} },
    url: new URL(ENDPOINT),
    platform: {
      env: {
        OPENAI_API_KEY: 'test-key',
        MEMBERSHIP_ENABLED: 'true',
        RELAY_API_SECRET: 'secret'
      }
    }
  } as any;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'Hello from Cheffy' } }] })
  });
  mocks.verifyNip98
    .mockReset()
    .mockImplementation(async (request: Request) =>
      request.headers.has('authorization')
        ? { ok: true, pubkey: MEMBER }
        : { ok: false, reason: 'missing-header' }
    );
  mocks.checkMembership.mockReset().mockResolvedValue({ state: 'active' });
});

describe('membership identity', () => {
  it('checks membership against the VERIFIED pubkey', async () => {
    const res = await POST(makeEvent({ prompt: 'hi', mode: 'chat' }, { signed: true }));

    expect(res.status).toBe(200);
    expect(mocks.checkMembership).toHaveBeenCalledWith(MEMBER, 'secret');
  });

  it('ignores a body pubkey entirely — an unsigned caller is not a member', async () => {
    // The old bypass: name a known member in the body and get free compute.
    const res = await POST(makeEvent({ prompt: 'hi', mode: 'chat', pubkey: MEMBER }));

    expect(mocks.checkMembership).not.toHaveBeenCalled();
    // Non-member without the experience flag is refused.
    expect(res.status).toBe(401);
  });

  it('rejects a PRESENT but invalid signature with 401', async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'invalid-signature' });

    const res = await POST(makeEvent({ prompt: 'hi', mode: 'chat' }, { signed: true }));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies over the exact body bytes', async () => {
    await POST(makeEvent({ prompt: 'hi', mode: 'chat' }, { signed: true }));

    const [, opts] = mocks.verifyNip98.mock.calls[0];
    expect(opts.bodyBytes).toBeInstanceOf(Uint8Array);
  });
});

describe('account-only samples and access errors', () => {
  it('refuses anonymous preview requests', async () => {
    mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'missing-header' });
    const res = await POST(makeEvent({ prompt: 'hi', mode: 'chat', experience: true }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed during a membership outage without spending quota', async () => {
    mocks.checkMembership.mockResolvedValue({ state: 'unknown', reason: 'membership api down' });
    const res = await POST(
      makeEvent({ prompt: 'hi', mode: 'chat', experience: true }, { signed: true })
    );
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const enabled of ['false', undefined]) {
    it(`refuses requests with membership disabled or missing (${enabled})`, async () => {
      const event = makeEvent({ prompt: 'hi', mode: 'chat', experience: true }, { signed: true });
      event.platform.env.MEMBERSHIP_ENABLED = enabled;
      const res = await POST(event);
      expect(res.status).toBe(503);
      expect(mocks.checkMembership).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('refuses requests without a membership service credential', async () => {
    const event = makeEvent({ prompt: 'hi', mode: 'chat', experience: true }, { signed: true });
    delete event.platform.env.RELAY_API_SECRET;
    const res = await POST(event);
    expect(res.status).toBe(503);
    expect(mocks.checkMembership).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
