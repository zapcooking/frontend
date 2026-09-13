/**
 * Auth posture on POST /api/zappy (Cheffy chat).
 *
 * The membership gate used to key off a body `pubkey`, so anyone could
 * name a known member and spend our OpenAI budget on their membership.
 * Identity now comes from NIP-98 — but the header stays OPTIONAL, because
 * the anonymous once-per-device preview has no signer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyNip98: vi.fn(),
  hasActiveMembership: vi.fn()
}));

vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verifyNip98 }));
vi.mock('$lib/membershipApi.server', () => ({ hasActiveMembership: mocks.hasActiveMembership }));

import { POST } from './+server';

const MEMBER = 'a'.repeat(64);
const ENDPOINT = 'https://zap.cooking/api/zappy';
const fetchMock = vi.fn();

function makeEvent(body: unknown, opts: { signed?: boolean; cookies?: Record<string, string> } = {}) {
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
  mocks.verifyNip98.mockReset().mockResolvedValue({ ok: true, pubkey: MEMBER });
  mocks.hasActiveMembership.mockReset().mockResolvedValue(true);
});

describe('membership identity', () => {
  it('checks membership against the VERIFIED pubkey', async () => {
    const res = await POST(makeEvent({ prompt: 'hi', mode: 'chat' }, { signed: true }));

    expect(res.status).toBe(200);
    expect(mocks.hasActiveMembership).toHaveBeenCalledWith(MEMBER, 'secret');
  });

  it('ignores a body pubkey entirely — an unsigned caller is not a member', async () => {
    // The old bypass: name a known member in the body and get free compute.
    const res = await POST(makeEvent({ prompt: 'hi', mode: 'chat', pubkey: MEMBER }));

    expect(mocks.hasActiveMembership).not.toHaveBeenCalled();
    // Non-member without the experience flag is refused.
    expect(res.status).toBe(403);
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

describe('anonymous preview stays open', () => {
  it('serves an unsigned experience request without any auth', async () => {
    const res = await POST(makeEvent({ prompt: 'hi', mode: 'chat', experience: true }));

    // No Authorization header at all — must NOT 401.
    expect(res.status).toBe(200);
    expect(mocks.verifyNip98).not.toHaveBeenCalled();
  });

  it('does not fail open for an unsigned caller during a membership outage', async () => {
    // Outage fail-open must require proven key control; previously any
    // pubkey-shaped string qualified.
    mocks.hasActiveMembership.mockRejectedValue(new Error('membership api down'));

    const res = await POST(makeEvent({ prompt: 'hi', mode: 'chat', pubkey: MEMBER }));

    expect(res.status).toBe(403);
  });

  it('fails open for a VERIFIED caller during a membership outage', async () => {
    mocks.hasActiveMembership.mockRejectedValue(new Error('membership api down'));

    const res = await POST(makeEvent({ prompt: 'hi', mode: 'chat' }, { signed: true }));

    expect(res.status).toBe(200);
  });
});
