import { describe, it, expect } from 'vitest';
import {
  COOK_PLUS_ANNUAL_USD,
  COOK_PLUS_MONTHLY_USD,
  DEFAULT_BILLING_PERIOD,
  annualSavingsPercent,
  annualMonthlyEquivalent,
  parseBillingPeriod,
  formatPlanPrice,
  cookPlusCtaLabel,
  cookPlusCheckoutHref,
  computeStickyCtaVisible
} from './cookPlusPricing';

describe('cookPlusPricing', () => {
  it('keeps the established prices', () => {
    expect(COOK_PLUS_ANNUAL_USD).toBe(49);
    expect(COOK_PLUS_MONTHLY_USD).toBe(4.99);
  });

  it('defaults to annual', () => {
    expect(DEFAULT_BILLING_PERIOD).toBe('annual');
    expect(parseBillingPeriod(null)).toBe('annual');
    expect(parseBillingPeriod(undefined)).toBe('annual');
    expect(parseBillingPeriod('')).toBe('annual');
    expect(parseBillingPeriod('yearly')).toBe('annual');
    expect(parseBillingPeriod('MONTHLY')).toBe('annual');
  });

  it('selects monthly only for the exact value', () => {
    expect(parseBillingPeriod('monthly')).toBe('monthly');
  });

  it('preserves the existing savings figure and monthly equivalent', () => {
    expect(annualSavingsPercent()).toBe(18);
    expect(annualMonthlyEquivalent()).toBe('4.08');
  });

  it('formats plan prices', () => {
    expect(formatPlanPrice('annual')).toBe('$49/year');
    expect(formatPlanPrice('monthly')).toBe('$4.99/month');
  });

  it('bakes the selected price into the CTA label', () => {
    expect(cookPlusCtaLabel('annual')).toBe('Unlock Cook+ · $49/year');
    expect(cookPlusCtaLabel('monthly')).toBe('Unlock Cook+ · $4.99/month');
  });

  it('routes checkout with the selected period', () => {
    expect(cookPlusCheckoutHref('annual')).toBe('/membership/cook-plus-checkout?period=annual');
    expect(cookPlusCheckoutHref('monthly')).toBe('/membership/cook-plus-checkout?period=monthly');
  });

  describe('computeStickyCtaVisible', () => {
    const base = {
      salesVisible: true,
      heroCtaInView: false,
      pricingCtaInView: false,
      isMobileViewport: true
    };

    it('shows once both on-page CTAs have left the viewport on mobile', () => {
      expect(computeStickyCtaVisible(base)).toBe(true);
    });

    it('never shows on desktop', () => {
      expect(computeStickyCtaVisible({ ...base, isMobileViewport: false })).toBe(false);
    });

    it('hides while the hero CTA is on screen', () => {
      expect(computeStickyCtaVisible({ ...base, heroCtaInView: true })).toBe(false);
    });

    it('hides while the pricing CTA is on screen', () => {
      expect(computeStickyCtaVisible({ ...base, pricingCtaInView: true })).toBe(false);
    });

    it('hides for members who are not looking at sales content', () => {
      expect(computeStickyCtaVisible({ ...base, salesVisible: false })).toBe(false);
    });
  });
});
