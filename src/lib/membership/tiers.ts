import type { MembershipTier } from '$lib/stores/membershipStatus';

export type TierSlug = 'cook-plus' | 'genesis' | 'pro-kitchen';

export type SuccessTierInternalId = Extract<
  MembershipTier,
  'cook_plus' | 'pro_kitchen' | 'founders'
>;

export type PaymentData = {
  subscriptionEnd: string | null;
  founderNumber: number | null;
  nip05: string | null;
  nip05Username: string | null;
};

export type HeroExtra =
  | { kind: 'none' }
  | { kind: 'subscription-date' }
  | { kind: 'founder-badge' };

export type TierConfig = {
  slug: TierSlug;
  internalId: SuccessTierInternalId;

  pageTitle: string;
  heading: (data: PaymentData) => string;
  successMessage: string;

  features: readonly string[];

  heroExtra: HeroExtra;

  successGuard: 'always' | ((data: PaymentData) => boolean);

  completePaymentEndpoint: string;
  parsePaymentResponse: (json: unknown) => Partial<PaymentData>;
  parseLightningParams: (params: URLSearchParams) => Partial<PaymentData>;

  defaultPaymentMethodToStripe: boolean;

  parseErrorFallback: (status: number, statusText: string) => string;

  logPrefix: string;
};

const cookPlusConfig: TierConfig = {
  slug: 'cook-plus',
  internalId: 'cook_plus',

  pageTitle: 'Welcome to Cook+! - zap.cooking',
  heading: () => 'Welcome to Cook+!',
  successMessage: 'Your Cook+ membership is now active.',

  features: [
    '✓ Custom Lightning address (you@zap.cooking)',
    '✓ Verified NIP-05 identity',
    '✓ Access to pantry.zap.cooking relay',
    '✓ Recipe collections',
    '✓ Member badge',
    '✓ Vote on features'
  ],

  heroExtra: { kind: 'subscription-date' },
  successGuard: 'always',

  completePaymentEndpoint: '/api/membership/complete-payment',
  parsePaymentResponse: (json) => {
    const data = json as { subscriptionEnd?: string; nip05?: string; nip05Username?: string };
    return {
      subscriptionEnd: data.subscriptionEnd ?? null,
      nip05: data.nip05 ?? null,
      nip05Username: data.nip05Username ?? null
    };
  },
  parseLightningParams: (params) => ({
    nip05: params.get('nip05'),
    nip05Username: params.get('nip05_username')
  }),

  defaultPaymentMethodToStripe: true,
  parseErrorFallback: (status, statusText) =>
    `Failed to complete payment (${status} ${statusText})`,

  logPrefix: '[Cook+ Success]'
};

const genesisConfig: TierConfig = {
  slug: 'genesis',
  internalId: 'founders',

  pageTitle: 'Welcome, Founders Club Member! - zap.cooking',
  heading: (data) => `Welcome, Founders Club #${data.founderNumber}!`,
  successMessage:
    'Your lifetime membership is now active. Thank you for being one of our founding members!',

  features: [
    '✓ Lifetime Pro Kitchen access',
    '✓ Verified @zap.cooking NIP-05 identity',
    '✓ Founders Club badge',
    '✓ Access to pantry.zap.cooking relay',
    '✓ Your name permanently displayed as a Founder',
    '✓ All future Pro Kitchen features'
  ],

  heroExtra: { kind: 'founder-badge' },
  successGuard: (data) => !!data.founderNumber,

  completePaymentEndpoint: '/api/genesis/complete-payment',
  parsePaymentResponse: (json) => {
    const data = json as { founderNumber?: number; nip05?: string; nip05Username?: string };
    return {
      founderNumber: data.founderNumber ?? null,
      nip05: data.nip05 ?? null,
      nip05Username: data.nip05Username ?? null
    };
  },
  parseLightningParams: (params) => {
    const founderParam = params.get('founder_number');
    return {
      founderNumber: founderParam ? parseInt(founderParam, 10) : null,
      nip05: params.get('nip05'),
      nip05Username: params.get('nip05_username')
    };
  },

  defaultPaymentMethodToStripe: false,
  parseErrorFallback: (status, statusText) => `Server error: ${status} ${statusText}`,

  logPrefix: '[Genesis Success]'
};

const proKitchenConfig: TierConfig = {
  slug: 'pro-kitchen',
  internalId: 'pro_kitchen',

  pageTitle: 'Welcome to Pro Kitchen! - zap.cooking',
  heading: () => 'Welcome to Pro Kitchen!',
  successMessage: 'Your Pro Kitchen membership is now active.',

  features: [
    '✓ Everything in Cook+',
    '✓ Verified @zap.cooking NIP-05 identity',
    '✓ Creator analytics',
    '✓ Gated recipes (coming soon)',
    '✓ AI recipe tools',
    '✓ Priority support'
  ],

  heroExtra: { kind: 'subscription-date' },
  successGuard: 'always',

  completePaymentEndpoint: '/api/membership/complete-payment',
  parsePaymentResponse: (json) => {
    const data = json as { subscriptionEnd?: string; nip05?: string; nip05Username?: string };
    return {
      subscriptionEnd: data.subscriptionEnd ?? null,
      nip05: data.nip05 ?? null,
      nip05Username: data.nip05Username ?? null
    };
  },
  parseLightningParams: (params) => ({
    nip05: params.get('nip05'),
    nip05Username: params.get('nip05_username')
  }),

  defaultPaymentMethodToStripe: true,
  parseErrorFallback: (status, statusText) =>
    `Failed to complete payment (${status} ${statusText})`,

  logPrefix: '[Pro Kitchen Success]'
};

export const TIER_CONFIGS: Record<TierSlug, TierConfig> = {
  'cook-plus': cookPlusConfig,
  genesis: genesisConfig,
  'pro-kitchen': proKitchenConfig
};

export function isTierSlug(value: string): value is TierSlug {
  return value === 'cook-plus' || value === 'genesis' || value === 'pro-kitchen';
}
