/**
 * Cook+ pricing and CTA helpers.
 *
 * One place for the numbers and the copy derived from them, so the
 * membership page, the sticky mobile CTA and the discovery modal can never
 * disagree about what Cook+ costs or what the button says.
 *
 * Prices here are display values only. What is actually charged is decided
 * by the checkout page and the server (Stripe session / Lightning quote),
 * which read the period from the `?period=` query parameter this module
 * builds. Changing a number here without changing the server changes the
 * pitch, not the price.
 */

export type BillingPeriod = 'annual' | 'monthly';

export const COOK_PLUS_ANNUAL_USD = 49;
export const COOK_PLUS_MONTHLY_USD = 4.99;
export const DEFAULT_BILLING_PERIOD: BillingPeriod = 'annual';
export const CHEFFY_MONTHLY_MESSAGES = 300;
export const COOK_PLUS_CHECKOUT_PATH = '/membership/cook-plus-checkout';
export const MEMBERSHIP_PATH = '/membership';

/** Percentage saved by paying yearly instead of twelve monthly payments. */
export function annualSavingsPercent(): number {
  const yearOfMonthly = COOK_PLUS_MONTHLY_USD * 12;
  return Math.round(((yearOfMonthly - COOK_PLUS_ANNUAL_USD) / yearOfMonthly) * 100);
}

/** The annual price expressed per month, two decimals ("4.08"). */
export function annualMonthlyEquivalent(): string {
  return (COOK_PLUS_ANNUAL_USD / 12).toFixed(2);
}

/** Accepts the raw `?period=` value and falls back to the default. */
export function parseBillingPeriod(value: string | null | undefined): BillingPeriod {
  return value === 'monthly' ? 'monthly' : DEFAULT_BILLING_PERIOD;
}

/** "$49/year" or "$4.99/month". */
export function formatPlanPrice(period: BillingPeriod): string {
  return period === 'annual'
    ? `$${COOK_PLUS_ANNUAL_USD}/year`
    : `$${COOK_PLUS_MONTHLY_USD.toFixed(2)}/month`;
}

/** Primary purchase CTA with the selected price baked in. */
export function cookPlusCtaLabel(period: BillingPeriod): string {
  return `Unlock Cook+ · ${formatPlanPrice(period)}`;
}

/** Checkout route carrying the selected period. */
export function cookPlusCheckoutHref(period: BillingPeriod): string {
  return `${COOK_PLUS_CHECKOUT_PATH}?period=${period}`;
}

/**
 * The sticky mobile CTA exists to keep the purchase action reachable once
 * the on-page CTAs have scrolled away. It must never double up with a CTA
 * that is already visible, and it is a mobile affordance only.
 */
export function computeStickyCtaVisible(input: {
  salesVisible: boolean;
  heroCtaInView: boolean;
  pricingCtaInView: boolean;
  isMobileViewport: boolean;
}): boolean {
  return (
    input.salesVisible && input.isMobileViewport && !input.heroCtaInView && !input.pricingCtaInView
  );
}
