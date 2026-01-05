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
 */

import Stripe from 'stripe';
import { STRIPE_SECRET_KEY } from '$env/static/private';

// Initialize Stripe with secret key from environment variable
// This will throw an error if STRIPE_SECRET_KEY is not set
const getStripeInstance = (): Stripe => {
  if (!STRIPE_SECRET_KEY) {
    throw new Error(
      'STRIPE_SECRET_KEY environment variable is not set. ' +
      'Please set it in your .env file (e.g., STRIPE_SECRET_KEY=sk_test_...)'
    );
  }
  
  // Initialize Stripe with the secret key from environment variable
  // Using API version 2024-12-18.acacia (latest stable)
  return new Stripe(STRIPE_SECRET_KEY, {
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
      annual: 5000, // $50.00
      '2year': 8500, // $85.00
    },
    pro: {
      annual: 15000, // $150.00
      '2year': 25000, // $250.00
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

