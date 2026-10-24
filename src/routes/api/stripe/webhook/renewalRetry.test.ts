/**
 * What the renewal path answers Stripe, and why the answer matters.
 *
 * Stripe redelivers on any non-2xx and on timeout, and STOPS on a 2xx. So the
 * status code is the whole retry policy: a 200 on a renewal that did not happen
 * drops it permanently, and the member is billed and locked out with nothing but
 * a log line. The handler therefore has to split two cases that look alike from
 * inside a `catch`:
 *
 *  - it CANNOT ever work (absent/invalid metadata) → 200, because a redelivery
 *    carries the same absent metadata.
 *  - it could work later (misconfigured secret, relay down) → non-2xx, because a
 *    redelivery over Stripe's ~3-day window can outlive the outage.
 *
 * These tests pin that split. They exist because the missing-`RELAY_API_SECRET`
 * branch was on the wrong side of it, and no test in this repo reached the
 * handler at all — `stripeRenewal.test.ts` covers the decision, and
 * `memberRegistration.renew.test.ts` covers the relay call, but neither sees
 * which status the endpoint returns.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from '$env/dynamic/private';

const mocks = vi.hoisted(() => ({
  renewMember: vi.fn(),
  registerMember: vi.fn()
}));

vi.mock('$lib/memberRegistration.server', () => ({
  renewMember: mocks.renewMember,
  registerMember: mocks.registerMember
}));

// The handler dynamically imports `stripe` and only uses it to verify the
// signature, so the stub hands the parsed body straight back as the event.
vi.mock('stripe', () => {
  class StripeStub {
    webhooks = {
      constructEvent: (rawBody: string) => JSON.parse(rawBody)
    };
  }
  return { default: StripeStub };
});

import { POST } from './+server';

const PUBKEY = 'a'.repeat(64);

/** A renewal invoice that `planRenewalFromInvoice` accepts outright. */
function renewalInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_renewal_1',
    customer: 'cus_1',
    billing_reason: 'subscription_cycle',
    parent: {
      subscription_details: {
        subscription: 'sub_1',
        metadata: { pubkey: PUBKEY, tier: 'cook', period: 'monthly' }
      }
    },
    ...overrides
  };
}

function post(invoice: unknown, platformEnv: Record<string, string> = {}) {
  const request = new Request('https://zap.cooking/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: invoice } })
  });
  return POST({
    request,
    platform: {
      env: {
        MEMBERSHIP_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
        ...platformEnv
      }
    }
  } as never);
}

beforeEach(() => {
  mocks.renewMember.mockReset().mockResolvedValue({
    renewed: true,
    alreadyApplied: false,
    notFound: false,
    subscriptionEnd: '2026-09-01T00:00:00Z'
  });
  mocks.registerMember.mockReset();
  // envMock is shared and mutable; RELAY_API_SECRET must be absent unless a test
  // puts it there, or the misconfiguration case silently stops being one.
  delete env.RELAY_API_SECRET;
});

describe('invoice.paid retry semantics', () => {
  it('500s without RELAY_API_SECRET so Stripe redelivers once it is bound', async () => {
    const res = await post(renewalInvoice());

    expect(res.status).toBe(500);
    // Nothing was attempted, so nothing to reconcile — only the retry is owed.
    expect(mocks.renewMember).not.toHaveBeenCalled();
  });

  it('reads RELAY_API_SECRET from process env when platform has none', async () => {
    env.RELAY_API_SECRET = 'from-env';

    const res = await post(renewalInvoice());

    expect(res.status).toBe(200);
    expect(mocks.renewMember.mock.calls[0][0].apiSecret).toBe('from-env');
  });

  it('200s and applies the renewal when the secret is bound', async () => {
    const res = await post(renewalInvoice(), { RELAY_API_SECRET: 'shh' });

    expect(res.status).toBe(200);
    expect(mocks.renewMember).toHaveBeenCalledWith({
      pubkey: PUBKEY,
      subscriptionMonths: 1,
      paymentId: 'stripe_renewal_in_renewal_1',
      apiSecret: 'shh'
    });
  });

  it('200s on a metadata skip even with no secret — the secret check is downstream', async () => {
    // The discrimination the fix turns on: this invoice can never be renewed by
    // any redelivery, so it must NOT be dragged into the 500 path. If the secret
    // check ran before the decision, this would 500 forever on every unrelated
    // pre-metadata subscription's renewal.
    const res = await post(
      renewalInvoice({ parent: { subscription_details: { subscription: 'sub_old' } } })
    );

    expect(res.status).toBe(200);
    expect(mocks.renewMember).not.toHaveBeenCalled();
  });

  it('200s on the first invoice of a subscription without touching the relay', async () => {
    const res = await post(renewalInvoice({ billing_reason: 'subscription_create' }), {
      RELAY_API_SECRET: 'shh'
    });

    expect(res.status).toBe(200);
    expect(mocks.renewMember).not.toHaveBeenCalled();
  });

  it('500s when the relay call throws, so the renewal is redelivered', async () => {
    mocks.renewMember.mockRejectedValue(new Error('Failed to renew member: 503 upstream'));

    const res = await post(renewalInvoice(), { RELAY_API_SECRET: 'shh' });

    expect(res.status).toBe(500);
  });

  it('200s when the relay says the member does not exist — terminal, not retryable', async () => {
    mocks.renewMember.mockResolvedValue({
      renewed: false,
      alreadyApplied: false,
      notFound: true,
      subscriptionEnd: null
    });

    const res = await post(renewalInvoice(), { RELAY_API_SECRET: 'shh' });

    expect(res.status).toBe(200);
  });

  it('200s on a redelivery the relay has already applied', async () => {
    mocks.renewMember.mockResolvedValue({
      renewed: false,
      alreadyApplied: true,
      notFound: false,
      subscriptionEnd: '2026-09-01T00:00:00Z'
    });

    const res = await post(renewalInvoice(), { RELAY_API_SECRET: 'shh' });

    expect(res.status).toBe(200);
  });
});
