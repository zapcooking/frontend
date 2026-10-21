/**
 * Counterpart of genesis/verify-lightning-payment/productScope.test.ts:
 * the membership verifier must not redeem a Genesis Founder invoice as a
 * membership (the two share the `inv:` metadata store), while entries
 * written before `product` existed still verify as membership.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';

const PUBKEY = 'b'.repeat(64);

const mocks = vi.hoisted(() => ({
  getReceiveRequestReceives: vi.fn(),
  registerMember: vi.fn(),
  getInvoiceMetadata: vi.fn(),
  getInvoiceMetadataByPaymentHash: vi.fn()
}));

vi.mock('$lib/strikeService.server', () => ({
  getReceiveRequestReceives: mocks.getReceiveRequestReceives
}));
vi.mock('$lib/memberRegistration.server', () => ({ registerMember: mocks.registerMember }));
vi.mock('$lib/invoiceMetadataStore.server', () => ({
  getInvoiceMetadata: mocks.getInvoiceMetadata,
  getInvoiceMetadataByPaymentHash: mocks.getInvoiceMetadataByPaymentHash
}));

function makeEvent(body: unknown) {
  const request = new Request('https://zap.cooking/api/membership/verify-lightning-payment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return {
    request,
    platform: { env: { MEMBERSHIP_ENABLED: 'true', RELAY_API_SECRET: 'test-secret' } }
  } as never;
}

beforeEach(() => {
  mocks.getReceiveRequestReceives.mockReset().mockResolvedValue([{ state: 'COMPLETED' }]);
  mocks.registerMember.mockReset().mockResolvedValue({
    subscriptionEnd: '2027-01-01T00:00:00Z',
    nip05: null,
    nip05Username: null,
    alreadyExists: false
  });
  mocks.getInvoiceMetadata.mockReset();
  mocks.getInvoiceMetadataByPaymentHash.mockReset().mockResolvedValue(null);
});

describe('membership verify-lightning-payment product scope', () => {
  it('refuses a Genesis Founder invoice', async () => {
    mocks.getInvoiceMetadata.mockResolvedValue({
      pubkey: PUBKEY,
      tier: 'pro',
      period: 'annual',
      product: 'genesis',
      receiveRequestId: 'rr-genesis',
      createdAt: Date.now()
    });

    const res = await POST(
      makeEvent({ receiveRequestId: 'rr-genesis', pubkey: PUBKEY, tier: 'pro', period: 'annual' })
    );

    expect(res.status).toBe(403);
    expect(mocks.registerMember).not.toHaveBeenCalled();
  });

  it('still verifies a legacy membership entry with no product field', async () => {
    mocks.getInvoiceMetadata.mockResolvedValue({
      pubkey: PUBKEY,
      tier: 'cook',
      period: 'monthly',
      receiveRequestId: 'rr-legacy',
      createdAt: Date.now()
    });

    const res = await POST(
      makeEvent({ receiveRequestId: 'rr-legacy', pubkey: PUBKEY, tier: 'cook', period: 'monthly' })
    );

    expect(res.status).toBe(200);
    expect(mocks.registerMember).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: PUBKEY, tier: 'cook', period: 'monthly' })
    );
  });
});
