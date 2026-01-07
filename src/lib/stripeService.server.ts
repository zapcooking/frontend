/**
 * Stripe Service
 * 
 * Minimal backend service for Stripe integration.
 * 
 * IMPORTANT: The Stripe secret key is expected to be provided via environment variable:
 * - Environment variable: STRIPE_SECRET_KEY
 * - This should be your TEST/SANDBOX key for development
 * - For production, swap to live keys by updating the environment variable
 * 
 * The key is intentionally NOT hardcoded and must be set in your environment.
 * Example in .env file: STRIPE_SECRET_KEY=sk_test_...
 * 
 * NOTE: This file is server-only and uses SvelteKit's $env system.
 * Using dynamic/private so build doesn't fail when key isn't set.
 */

import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

// Initialize Stripe with secret key from environment variable
// This will throw an error at runtime if STRIPE_SECRET_KEY is not set
const getStripeInstance = (): Stripe => {
  const stripeKey = env.STRIPE_SECRET_KEY;
  
  if (!stripeKey) {
    throw new Error(
      'STRIPE_SECRET_KEY environment variable is not set. ' +
      'Please set it in your .env file (e.g., STRIPE_SECRET_KEY=sk_test_...) ' +
      'or in your hosting provider\'s environment variables.'
    );
  }
  
  // Initialize Stripe with the secret key from environment variable
  // Using API version 2024-12-18.acacia (latest stable)
  return new Stripe(stripeKey, {
    apiVersion: '2024-12-18.acacia',
    typescript: true,
  });
};

/**
 * Create a Stripe checkout session
 * 
 * @param params - Checkout session parameters
 * @returns Stripe checkout session with URL
 */
export async function createCheckoutSession(params: {
  tier: 'cook' | 'pro';
  period: 'annual' | '2year';
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}): Promise<{ sessionId: string; url: string }> {
  const stripe = getStripeInstance();
  
  // Pricing configuration (in cents for Stripe)
  const pricing = {
    cook: {
      annual: 4900, // $49.00
      '2year': 8330, // $83.30
    },
    pro: {
      annual: 8900, // $89.00
      '2year': 15240, // $152.40
    },
  };
  
  const amount = pricing[params.tier][params.period];
  const tierName = params.tier === 'cook' ? 'Cook+' : 'Pro Kitchen';
  const periodLabel = params.period === 'annual' ? '1 year' : '2 years';
  
  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Zap Cooking ${tierName} - ${periodLabel}`,
            description: `Membership subscription for ${periodLabel}`,
          },
          unit_amount: amount,
          recurring: params.period === 'annual' 
            ? { interval: 'year' }
            : { interval: 'year', interval_count: 2 },
        },
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    customer_email: params.customerEmail,
    metadata: {
      tier: params.tier,
      period: params.period,
    },
  });
  
  if (!session.url) {
    throw new Error('Stripe session created but no URL returned');
  }
  
  return {
    sessionId: session.id,
    url: session.url,
  };
}

