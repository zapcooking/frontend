import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

// Types
export type Tier = 'open' | 'cook' | 'pro';
export type PricingPeriod = 'annual' | 'monthly';
export type PaymentMethod = 'bitcoin' | 'card';
export type PaymentStep = 'closed' | 'selection' | 'bitcoin' | 'stripe' | 'success';

export interface TierPricing {
  name: string;
  description: string;
  annual: { sats: number; usd: number };
  monthly: { sats: number; usd: number };
}

export interface PaymentState {
  step: PaymentStep;
  selectedTier: Tier | null;
  selectedPeriod: PricingPeriod;
  selectedMethod: PaymentMethod | null;
  invoiceId: string | null;
  lightningInvoice: string | null;
  stripeSessionUrl: string | null;
  paymentComplete: boolean;
  membershipDetails: {
    tier: string;
    expiresAt: string;
    method: string;
    nip05?: string;
    nip05Username?: string;
  } | null;
}

// Pricing configuration
export const tierPricing: Record<Exclude<Tier, 'open'>, TierPricing> = {
  cook: {
    name: 'Cook+',
    description: 'For supporters and active members',
    annual: { sats: 44100, usd: 49 },
    monthly: { sats: 4490, usd: 4.99 }
  },
  pro: {
    name: 'Pro Kitchen',
    description: 'For serious creators and founders',
    annual: { sats: 80100, usd: 89 },
    monthly: { sats: 8090, usd: 8.99 }
  }
};

// Calculate savings percentage (annual vs monthly)
export function calculateSavings(tier: Exclude<Tier, 'open'>): number {
  const monthly = tierPricing[tier].monthly;
  const annual = tierPricing[tier].annual;
  const monthlyAnnualized = monthly.usd * 12;
  return Math.round(((monthlyAnnualized - annual.usd) / monthlyAnnualized) * 100);
}

// Initial state
const initialState: PaymentState = {
  step: 'closed',
  selectedTier: null,
  selectedPeriod: 'annual',
  selectedMethod: null,
  invoiceId: null,
  lightningInvoice: null,
  stripeSessionUrl: null,
  paymentComplete: false,
  membershipDetails: null
};

// Create the store
function createPaymentStore() {
  const { subscribe, set, update } = writable<PaymentState>(initialState);

  return {
    subscribe,
    
    // Open payment modal for a tier
    openPayment: (tier: Tier, period: PricingPeriod) => {
      if (tier === 'open') {
        // Free tier - just redirect to explore (browser only)
        if (browser) {
          window.location.href = '/explore';
        }
        return;
      }
      update(state => ({
        ...state,
        step: 'selection',
        selectedTier: tier,
        selectedPeriod: period,
        selectedMethod: null,
        paymentComplete: false
      }));
    },

    // Select payment method
    selectMethod: (method: PaymentMethod) => {
      update(state => ({
        ...state,
        selectedMethod: method
      }));
    },

    // Proceed to Bitcoin payment
    proceedToBitcoin: async (pubkey: string) => {
      update(state => ({ ...state, step: 'bitcoin' }));

      // Create real Lightning invoice via backend API
      const invoice = await createLightningInvoice(pubkey);
      update(state => ({
        ...state,
        invoiceId: invoice.receiveRequestId,
        lightningInvoice: invoice.invoice,
      }));
    },

    // Proceed to Stripe checkout
    proceedToStripe: async (tier: Exclude<Tier, 'open'>, period: PricingPeriod) => {
      if (!browser) {
        throw new Error('Stripe checkout requires browser environment');
      }
      
      // Store tier/period in localStorage in case page reloads after Stripe redirect
      try {
        localStorage.setItem('pending_stripe_payment', JSON.stringify({ tier, period }));
      } catch (e) {
        console.warn('Failed to store payment info in localStorage:', e);
      }
      
      // Update step to stripe
      update(state => ({ ...state, step: 'stripe', selectedTier: tier, selectedPeriod: period }));
      
      try {
        // Build success and cancel URLs
        const baseUrl = window.location.origin;
        const successUrl = `${baseUrl}/membership?payment=success&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${baseUrl}/membership?payment=canceled`;
        
        // Create real Stripe checkout session via API
        const session = await createStripeSession({
          tier,
          period,
          successUrl,
          cancelUrl,
        });
        
        update(state => ({
          ...state,
          stripeSessionUrl: session.url,
          invoiceId: session.sessionId // Store session ID for reference
        }));
      } catch (error) {
        console.error('Failed to create Stripe session:', error);
        // Clean up localStorage on error
        try {
          localStorage.removeItem('pending_stripe_payment');
        } catch (e) {
          // localStorage may be unavailable in some contexts (e.g., private browsing)
        }
        // Reset to selection step on error
        update(state => ({ ...state, step: 'selection' }));
        throw error;
      }
    },

    // Complete payment (called after successful payment)
    completePayment: async (
      method: PaymentMethod, 
      userPubkey: string | null,
      nip05Info?: { nip05?: string; nip05Username?: string }
    ) => {
      update(state => {
        const tier = state.selectedTier;
        const period = state.selectedPeriod;
        const expiresAt = new Date();
        if (period === 'monthly') {
          expiresAt.setMonth(expiresAt.getMonth() + 1);
        } else {
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
        }

        // Save membership to store if user is authenticated
        if (userPubkey && tier !== 'open') {
          import('$lib/membershipStore').then(({ membershipStore }) => {
            membershipStore.setMembership({
              pubkey: userPubkey,
              tier: tier as 'cook' | 'pro',
              expiresAt: expiresAt.getTime(),
              purchasedAt: Date.now(),
              paymentMethod: method,
              invoiceId: state.invoiceId || undefined
            });
          });
        }

        return {
          ...state,
          step: 'success',
          paymentComplete: true,
          membershipDetails: {
            tier: tier === 'cook' ? 'Cook+' : 'Pro Kitchen',
            expiresAt: expiresAt.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            }),
            method: method === 'bitcoin' ? 'Lightning Network' : 'Credit Card',
            nip05: nip05Info?.nip05,
            nip05Username: nip05Info?.nip05Username
          }
        };
      });
    },

    // Go back one step
    goBack: () => {
      update(state => {
        if (state.step === 'bitcoin' || state.step === 'stripe') {
          return { ...state, step: 'selection', selectedMethod: null };
        }
        return state;
      });
    },

    // Close modal and reset
    close: () => {
      set(initialState);
    },

    // Reset store
    reset: () => {
      set(initialState);
    }
  };
}

export const paymentStore = createPaymentStore();

// Derived store for current pricing
export const currentPricing = derived(
  paymentStore,
  ($payment) => {
    if (!$payment.selectedTier || $payment.selectedTier === 'open') {
      return null;
    }
    const tier = $payment.selectedTier as Exclude<Tier, 'open'>;
    const period = $payment.selectedPeriod;
    const pricing = tierPricing[tier];
    const priceData = period === 'annual' ? pricing.annual : pricing.monthly;
    const savings = calculateSavings(tier);

    return {
      tierName: pricing.name,
      period: period === 'annual' ? '1 year' : '1 month',
      periodLabel: period === 'annual' ? '/year' : '/mo',
      sats: priceData.sats,
      usd: priceData.usd,
      savings
    };
  }
);

// ============================================
// API FUNCTIONS
// ============================================

export interface LightningInvoiceResponse {
  invoice: string;
  paymentHash: string;
  receiveRequestId: string;
  expiresAt: number;
  amountSats: number;
  usdAmount: number;
  discountedUsdAmount: number;
  btcPrice: number;
  discountPercent: number;
  tier: string;
  period: string;
}

/**
 * Create a Lightning invoice via backend API (Strike)
 */
export async function createLightningInvoice(pubkey: string): Promise<LightningInvoiceResponse> {
  if (!browser) {
    throw new Error('Lightning invoice creation requires browser environment');
  }

  // Read current store state for tier/period
  let tier: string = '';
  let period: string = '';
  paymentStore.subscribe(s => { tier = s.selectedTier || ''; period = s.selectedPeriod; })();

  if (!tier || tier === 'open') {
    throw new Error('No tier selected');
  }

  const response = await fetch('/api/membership/create-lightning-invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey, tier, period }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create Lightning invoice' }));
    throw new Error(error.error || `HTTP ${response.status}: Failed to create Lightning invoice`);
  }

  return await response.json();
}

/**
 * Create a Stripe checkout session via backend API
 */
export async function createStripeSession(params: {
  tier: 'cook' | 'pro';
  period: 'annual' | 'monthly';
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  pubkey?: string;
}): Promise<{ sessionId: string; url: string }> {
  if (!browser) {
    throw new Error('Stripe session creation requires browser environment');
  }

  const response = await fetch('/api/stripe/create-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create Stripe session' }));
    throw new Error(error.error || `HTTP ${response.status}: Failed to create Stripe session`);
  }

  const data = await response.json();
  return { sessionId: data.sessionId, url: data.url };
}

// Format sats with commas
export function formatSats(sats: number): string {
  return sats.toLocaleString('en-US');
}

// Format USD
export function formatUSD(usd: number): string {
  return `$${usd}`;
}

