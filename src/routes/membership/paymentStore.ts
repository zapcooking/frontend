import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

// Types
export type Tier = 'open' | 'cook' | 'pro';
export type PricingPeriod = 'annual' | '2year';
export type PaymentMethod = 'bitcoin' | 'card';
export type PaymentStep = 'closed' | 'selection' | 'bitcoin' | 'stripe' | 'success';

export interface TierPricing {
  name: string;
  description: string;
  annual: { sats: number; usd: number };
  twoYear: { sats: number; usd: number };
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
    twoYear: { sats: 75460, usd: 83.30 }
  },
  pro: {
    name: 'Pro Kitchen',
    description: 'For serious creators and founders',
    annual: { sats: 80100, usd: 89 },
    twoYear: { sats: 137160, usd: 152.40 }
  }
};

// Calculate savings
export function calculateSavings(tier: Exclude<Tier, 'open'>, period: PricingPeriod): number {
  const pricing = tierPricing[tier][period === 'annual' ? 'annual' : 'twoYear'];
  // Approximate sats to USD conversion (assuming ~2000 sats = $1 for display purposes)
  const btcUsdEquivalent = Math.round(pricing.sats / 2000);
  return pricing.usd - btcUsdEquivalent;
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
    proceedToBitcoin: async () => {
      update(state => ({ ...state, step: 'bitcoin' }));
      
      // Create mock Lightning invoice
      const invoice = await createStrikeInvoice();
      update(state => ({
        ...state,
        invoiceId: invoice.id,
        lightningInvoice: invoice.lnInvoice
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
        const years = period === 'annual' ? 1 : 2;
        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + years);

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
    const priceData = period === 'annual' ? pricing.annual : pricing.twoYear;
    const savings = calculateSavings(tier, period);

    return {
      tierName: pricing.name,
      period: period === 'annual' ? '1 year' : '2 years',
      periodLabel: period === 'annual' ? '/year' : ' for 2 years',
      sats: priceData.sats,
      usd: priceData.usd,
      savings
    };
  }
);

// ============================================
// MOCK API FUNCTIONS
// (Replace these with real API calls later)
// ============================================

interface MockInvoice {
  id: string;
  lnInvoice: string;
  amountSats: number;
  expiresAt: number;
}

interface MockStripeSession {
  id: string;
  url: string;
}

// Generate a fake Lightning invoice (looks realistic)
function generateFakeLightningInvoice(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let invoice = 'lnbc';
  // Add amount indicator
    invoice += '441000n'; // 44100 sats
  // Add timestamp
  invoice += '1p';
  // Add random data
  for (let i = 0; i < 200; i++) {
    invoice += chars[Math.floor(Math.random() * chars.length)];
  }
  return invoice;
}

// Mock: Create a Strike/Lightning invoice
export async function createStrikeInvoice(): Promise<MockInvoice> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  return {
    id: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    lnInvoice: generateFakeLightningInvoice(),
    amountSats: 44100,
    expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutes
  };
}

/**
 * Create a Stripe checkout session
 * Calls the backend API to create a real Stripe checkout session
 */
export async function createStripeSession(params: {
  tier: 'cook' | 'pro';
  period: 'annual' | '2year';
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}): Promise<{ sessionId: string; url: string }> {
  if (!browser) {
    throw new Error('Stripe session creation requires browser environment');
  }
  
  const response = await fetch('/api/stripe/create-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Failed to create Stripe session' }));
    throw new Error(error.error || `HTTP ${response.status}: Failed to create Stripe session`);
  }
  
  const data = await response.json();
  return {
    sessionId: data.sessionId,
    url: data.url,
  };
}

// Mock: Check payment status (simulates polling)
export async function checkPaymentStatus(invoiceId: string): Promise<'pending' | 'paid' | 'expired'> {
  // In real implementation, this would poll the backend
  // For mock, we'll just return 'pending' - the auto-complete handles success
  await new Promise(resolve => setTimeout(resolve, 200));
  return 'pending';
}

// Format sats with commas
export function formatSats(sats: number): string {
  return sats.toLocaleString('en-US');
}

// Format USD
export function formatUSD(usd: number): string {
  return `$${usd}`;
}

