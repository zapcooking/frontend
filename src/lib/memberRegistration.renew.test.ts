/**
 * `renewMember`'s 404 handling.
 *
 * A renewal has no client-side fallback — a swallowed error is a lost renewal
 * and a member billed but locked out — so the only 404 that may end the attempt
 * is the relay's own "no such member" answer. Every other 404 has to be rethrown
 * so the webhook returns non-2xx and Stripe redelivers. The case that makes this
 * concrete is deploying the relay's `api` container: the proxy stays up and can
 * answer 404 while the API is restarting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renewMember } from './memberRegistration.server';

const fetchMock = vi.fn();

/** The relay's /renew handler returns exactly this on a missing member. */
const MEMBER_NOT_FOUND = JSON.stringify({ error: 'Member not found' });

function response(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body)
  };
}

function renew() {
  return renewMember({
    pubkey: 'a'.repeat(64),
    subscriptionMonths: 12,
    paymentId: 'stripe_renewal_in_test123',
    apiSecret: 'test-secret'
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renewMember 404 handling', () => {
  it("reports notFound for the relay's own missing-member answer", async () => {
    fetchMock.mockResolvedValue(response(404, MEMBER_NOT_FOUND));

    await expect(renew()).resolves.toEqual({
      renewed: false,
      alreadyApplied: false,
      notFound: true,
      subscriptionEnd: null
    });
  });

  // The sharp one. A 404 from anything other than the relay handler means we do
  // not know whether the membership exists, so ending the attempt here would
  // drop a renewal the member paid for.
  it('throws on a 404 that is not the relay handler answering', async () => {
    const foreign404s = [
      '<html><head><title>404 Not Found</title></head></html>',
      '',
      JSON.stringify({ error: 'Not Found' }),
      JSON.stringify({ message: 'Member not found' }),
      'Member not found'
    ];

    for (const body of foreign404s) {
      fetchMock.mockResolvedValue(response(404, body));
      await expect(renew(), JSON.stringify(body)).rejects.toThrow('Failed to renew member: 404');
    }
  });

  it('throws on any other non-2xx', async () => {
    fetchMock.mockResolvedValue(response(500, JSON.stringify({ error: 'Internal server error' })));

    await expect(renew()).rejects.toThrow('Failed to renew member: 500');
  });
});

describe('renewMember success paths', () => {
  it('reports a renewal with the new subscription_end', async () => {
    fetchMock.mockResolvedValue(
      response(
        200,
        JSON.stringify({
          success: true,
          action: 'renewed',
          member: { subscription_end: '2027-07-30T00:00:00.000Z' }
        })
      )
    );

    await expect(renew()).resolves.toEqual({
      renewed: true,
      alreadyApplied: false,
      notFound: false,
      subscriptionEnd: '2027-07-30T00:00:00.000Z'
    });
  });

  // member-relay's idempotency guard answers 200, not an error, so that Stripe
  // does not retry a delivery it just declined.
  it('reports alreadyApplied on a repeat delivery', async () => {
    fetchMock.mockResolvedValue(
      response(
        200,
        JSON.stringify({
          success: true,
          action: 'already_applied',
          member: { subscription_end: '2027-07-30T00:00:00.000Z' }
        })
      )
    );

    const result = await renew();

    expect(result.alreadyApplied).toBe(true);
    expect(result.renewed).toBe(false);
    expect(result.subscriptionEnd).toBe('2027-07-30T00:00:00.000Z');
  });

  it('sends only subscription_months and payment_id to the relay', async () => {
    fetchMock.mockResolvedValue(
      response(200, JSON.stringify({ success: true, action: 'renewed', member: {} }))
    );

    await renew();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://pantry.zap.cooking/api/members/${'a'.repeat(64)}/renew`);
    expect(JSON.parse(init.body)).toEqual({
      subscription_months: 12,
      payment_id: 'stripe_renewal_in_test123'
    });
  });
});
