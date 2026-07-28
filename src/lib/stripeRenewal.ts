/**
 * Deciding whether a Stripe `invoice.paid` extends a membership, and by how much.
 *
 * Split out of the webhook handler so the decision can be tested without a
 * Stripe account, a relay, or a network. Everything here is pure: it takes an
 * invoice-shaped object and returns either a plan or a reason for declining.
 * The handler does the logging and the relay call.
 *
 * Background: `checkout.session.completed` is the only event that ever wrote a
 * membership, and Stripe fires it on the initial checkout only. Renewals arrive
 * as invoices, so without this path a card renews at Stripe and the membership
 * record never moves — the member is billed and locked out.
 */

/** Periods `createCheckoutSession` has ever written into metadata. */
const KNOWN_PERIODS = ['annual', '2year', 'monthly'] as const;

export type RenewalSkipReason =
  /** Not a recurring cycle — the first invoice, a manual one, or a proration. */
  | 'not-a-renewal-cycle'
  /** Subscription predates `subscription_data.metadata`. Needs a human. */
  | 'no-pubkey'
  | 'invalid-pubkey'
  | 'invalid-period';

export interface RenewalPlan {
  action: 'renew';
  pubkey: string;
  subscriptionMonths: number;
  /** Written to the relay's `payment_id`; the relay dedupes redeliveries on it. */
  paymentId: string;
  period: string;
  tier: string | undefined;
}

export interface RenewalSkip {
  action: 'skip';
  reason: RenewalSkipReason;
  /** The offending value, for the log line. Never a secret. */
  value?: string;
}

export type RenewalDecision = RenewalPlan | RenewalSkip;

/**
 * The idempotency key for a renewal.
 *
 * Stripe redelivers a webhook on any non-2xx response and on timeout. The relay
 * refuses to apply a `payment_id` it already holds, so this must be derived
 * from the invoice and nothing else — no timestamp, no counter. Prefixed to stay
 * distinguishable from the `{tier}_{method}_{Date.now()}` ids `registerMember`
 * writes on first purchase.
 */
export function renewalPaymentId(invoiceId: string): string {
  return `stripe_renewal_${invoiceId}`;
}

/**
 * Months to extend for a metadata `period`.
 *
 * Mirrors `registerMember`, which is `period === 'annual' ? 12 : 1` after
 * `handleCheckoutCompleted` normalizes the legacy `'2year'` to `'annual'`. The
 * two must agree: a member who bought a year and renews should get a year.
 */
export function monthsForPeriod(period: string): number {
  return period === 'monthly' ? 1 : 12;
}

/**
 * Decide what an `invoice.paid` event should do.
 *
 * Takes the raw event object rather than a Stripe type because the webhook
 * handler receives untyped JSON — every field here is treated as absent-until-
 * proven, which is also what makes the skip cases testable.
 */
export function planRenewalFromInvoice(invoice: any): RenewalDecision {
  // Only a recurring cycle extends a membership.
  //
  // The first invoice of a subscription carries `subscription_create` and is
  // already covered by `checkout.session.completed`. Extending on that too
  // would silently give every new card member double the term they paid for —
  // and it would look like generosity rather than a bug, so nothing would
  // report it. `subscription_update` (proration on a plan change) is excluded
  // for the same reason: money moved, but not for another full period.
  if (invoice?.billing_reason !== 'subscription_cycle') {
    return {
      action: 'skip',
      reason: 'not-a-renewal-cycle',
      value: invoice?.billing_reason
    };
  }

  // `invoice.parent.subscription_details.metadata` is an immutable snapshot of
  // the subscription's metadata taken when the invoice was finalized. It is NOT
  // the checkout session's metadata — Stripe does not copy that onto the
  // subscription, which is why `subscription_data.metadata` has to be set at
  // checkout for any of this to resolve.
  const metadata = invoice?.parent?.subscription_details?.metadata || {};
  const { pubkey, tier, period } = metadata;

  if (!pubkey) {
    return { action: 'skip', reason: 'no-pubkey' };
  }

  if (typeof pubkey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(pubkey)) {
    return { action: 'skip', reason: 'invalid-pubkey', value: String(pubkey) };
  }

  // An unrecognized period is refused rather than defaulted. Guessing 12 gives
  // away a year; guessing 1 strands an annual member eleven months early.
  if (!period || !KNOWN_PERIODS.includes(period)) {
    return { action: 'skip', reason: 'invalid-period', value: String(period) };
  }

  return {
    action: 'renew',
    pubkey,
    subscriptionMonths: monthsForPeriod(period),
    paymentId: renewalPaymentId(invoice.id),
    period,
    tier
  };
}
