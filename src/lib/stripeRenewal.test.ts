import { describe, it, expect } from 'vitest';
import { planRenewalFromInvoice, renewalPaymentId, monthsForPeriod } from './stripeRenewal';

const PUBKEY = 'a'.repeat(64);

/**
 * An `invoice.paid` event body, shaped the way Stripe sends it on API version
 * 2025-12-15.clover: the subscription's metadata snapshot lives under
 * `parent.subscription_details.metadata`, not on the invoice itself.
 */
function invoice(
  overrides: {
    billing_reason?: string;
    metadata?: Record<string, string> | null;
    id?: string;
  } = {}
) {
  const { billing_reason = 'subscription_cycle', id = 'in_test123' } = overrides;
  const metadata =
    'metadata' in overrides
      ? overrides.metadata
      : { pubkey: PUBKEY, tier: 'cook', period: 'annual' };

  return {
    id,
    billing_reason,
    customer: 'cus_test123',
    parent: {
      type: 'subscription_details',
      subscription_details: {
        subscription: 'sub_test123',
        metadata
      }
    }
  };
}

describe('planRenewalFromInvoice', () => {
  it('renews on a recurring cycle', () => {
    const decision = planRenewalFromInvoice(invoice());

    expect(decision).toEqual({
      action: 'renew',
      pubkey: PUBKEY,
      subscriptionMonths: 12,
      paymentId: 'stripe_renewal_in_test123',
      period: 'annual',
      tier: 'cook'
    });
  });

  it('extends a monthly subscription by one month', () => {
    const decision = planRenewalFromInvoice(
      invoice({ metadata: { pubkey: PUBKEY, tier: 'cook', period: 'monthly' } })
    );

    expect(decision.action).toBe('renew');
    expect((decision as any).subscriptionMonths).toBe(1);
  });

  it('treats the legacy 2year period as twelve months, matching registerMember', () => {
    const decision = planRenewalFromInvoice(
      invoice({ metadata: { pubkey: PUBKEY, tier: 'cook', period: '2year' } })
    );

    expect(decision.action).toBe('renew');
    expect((decision as any).subscriptionMonths).toBe(12);
  });

  // The sharp one. Stripe fires invoice.paid for the FIRST invoice of a
  // subscription too, with billing_reason 'subscription_create' — the same
  // payment checkout.session.completed already registered. If this ever starts
  // returning 'renew', every new card member silently gets double the term they
  // paid for, and it reads as generosity rather than as a bug.
  it('does not renew on the first invoice of a subscription', () => {
    const decision = planRenewalFromInvoice(invoice({ billing_reason: 'subscription_create' }));

    expect(decision).toEqual({
      action: 'skip',
      reason: 'not-a-renewal-cycle',
      value: 'subscription_create'
    });
  });

  it('does not renew on a proration from a plan change', () => {
    const decision = planRenewalFromInvoice(invoice({ billing_reason: 'subscription_update' }));

    expect(decision.action).toBe('skip');
    expect((decision as any).reason).toBe('not-a-renewal-cycle');
  });

  it('does not renew on a manual invoice', () => {
    const decision = planRenewalFromInvoice(invoice({ billing_reason: 'manual' }));

    expect(decision.action).toBe('skip');
    expect((decision as any).reason).toBe('not-a-renewal-cycle');
  });

  // A subscription created before subscription_data.metadata was added. Nothing
  // in the codebase can recover whose membership this is; the handler logs it
  // for manual reconciliation. It must never guess.
  it('skips with no-pubkey when the subscription carries no metadata', () => {
    const decision = planRenewalFromInvoice(invoice({ metadata: null }));

    expect(decision).toEqual({ action: 'skip', reason: 'no-pubkey' });
  });

  it('skips with no-pubkey when parent is absent entirely', () => {
    const decision = planRenewalFromInvoice({
      id: 'in_test123',
      billing_reason: 'subscription_cycle'
    });

    expect(decision).toEqual({ action: 'skip', reason: 'no-pubkey' });
  });

  it('rejects a malformed pubkey rather than passing it to the relay', () => {
    const decision = planRenewalFromInvoice(
      invoice({ metadata: { pubkey: 'not-a-pubkey', tier: 'cook', period: 'annual' } })
    );

    expect(decision).toEqual({
      action: 'skip',
      reason: 'invalid-pubkey',
      value: 'not-a-pubkey'
    });
  });

  // Refused, not defaulted: guessing 12 gives away a year, guessing 1 strands an
  // annual member eleven months early.
  it('refuses an unrecognized period instead of defaulting', () => {
    const decision = planRenewalFromInvoice(
      invoice({ metadata: { pubkey: PUBKEY, tier: 'cook', period: 'weekly' } })
    );

    expect(decision).toEqual({
      action: 'skip',
      reason: 'invalid-period',
      value: 'weekly'
    });
  });

  it('refuses a missing period', () => {
    const decision = planRenewalFromInvoice(
      invoice({ metadata: { pubkey: PUBKEY, tier: 'cook' } })
    );

    expect(decision.action).toBe('skip');
    expect((decision as any).reason).toBe('invalid-period');
  });
});

describe('renewalPaymentId', () => {
  // The relay dedupes redeliveries on payment_id, so this must depend on the
  // invoice and nothing else. A timestamp or counter here would make every
  // Stripe retry look like a new payment and add a term the member never bought.
  it('is stable across calls for the same invoice', () => {
    expect(renewalPaymentId('in_abc')).toBe(renewalPaymentId('in_abc'));
  });

  it('differs between invoices', () => {
    expect(renewalPaymentId('in_abc')).not.toBe(renewalPaymentId('in_def'));
  });

  it('is distinguishable from a first-purchase payment_id', () => {
    // registerMember writes `${tier}_${method}_${Date.now()}`.
    expect(renewalPaymentId('in_abc').startsWith('stripe_renewal_')).toBe(true);
  });
});

describe('monthsForPeriod', () => {
  it('agrees with registerMember on every period the checkout can write', () => {
    // registerMember: `period === 'annual' ? 12 : 1`, after handleCheckoutCompleted
    // normalizes '2year' to 'annual'.
    expect(monthsForPeriod('annual')).toBe(12);
    expect(monthsForPeriod('2year')).toBe(12);
    expect(monthsForPeriod('monthly')).toBe(1);
  });
});
